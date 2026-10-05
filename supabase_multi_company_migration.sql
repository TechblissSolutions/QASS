-- Sparrow multi-company hardening migration
-- Run ONCE in Supabase SQL Editor after the current user_id migration.
-- This preserves generation history by moving jobs from duplicate project rows
-- onto one canonical company row before deleting duplicate company rows.

begin;

-- Safety backups. Re-running this migration does not duplicate backup rows.
create table if not exists public.sparrow_projects_backup_20260930 (like public.projects including all);
create table if not exists public.sparrow_jobs_backup_20260930 (like public.jobs including all);
insert into public.sparrow_projects_backup_20260930 select * from public.projects on conflict (id) do nothing;
insert into public.sparrow_jobs_backup_20260930 select * from public.jobs on conflict (id) do nothing;

alter table public.projects
  add column if not exists normalized_url text;

-- Canonicalize website identity for existing rows.
update public.projects
set normalized_url = regexp_replace(
  regexp_replace(
    regexp_replace(lower(trim(url)), '^https?://(www\.)?', '', 'i'),
    '[?#].*$', '', 'g'
  ),
  '/+$', '', 'g'
)
where normalized_url is null or normalized_url = '';

-- Keep one project per user + normalized website.
-- The oldest row becomes the stable company identity; the newest duplicate's
-- profile/preferences/theme are copied onto it so the latest analysis wins.
do $$
declare
  dup record;
  canonical uuid;
  newest uuid;
begin
  for dup in
    select user_id, normalized_url
    from public.projects
    where user_id is not null and normalized_url is not null and normalized_url <> ''
    group by user_id, normalized_url
    having count(*) > 1
  loop
    select id into canonical
    from public.projects
    where user_id = dup.user_id and normalized_url = dup.normalized_url
    order by created_at asc, id asc
    limit 1;

    select id into newest
    from public.projects
    where user_id = dup.user_id and normalized_url = dup.normalized_url
    order by created_at desc, id desc
    limit 1;

    update public.projects c
    set url = n.url,
        profile = coalesce(n.profile, c.profile),
        prefs = coalesce(n.prefs, c.prefs),
        brand_theme = coalesce(n.brand_theme, c.brand_theme)
    from public.projects n
    where c.id = canonical and n.id = newest;

    update public.jobs
    set project_id = canonical
    where project_id in (
      select p.id
      from public.projects p
      where p.user_id = dup.user_id
        and p.normalized_url = dup.normalized_url
        and p.id <> canonical
    );

    delete from public.projects
    where user_id = dup.user_id
      and normalized_url = dup.normalized_url
      and id <> canonical;
  end loop;
end $$;

create unique index if not exists projects_user_normalized_url_uidx
  on public.projects(user_id, normalized_url)
  where user_id is not null and normalized_url is not null;

-- Keep the transactional entitlement function authoritative while making it
-- duplicate-safe for canonicalized URLs.
create or replace function public.create_project_for_user(
  p_user_id uuid,
  p_url text,
  p_profile jsonb,
  p_prefs jsonb,
  p_brand_theme jsonb,
  p_max_companies integer,
  p_unlimited boolean default false
)
returns setof public.projects
language plpgsql
security definer
set search_path = public
as $$
declare
  current_count integer;
  existing_project_id uuid;
  normalized text;
begin
  if p_user_id is null then raise exception 'USER_NOT_FOUND'; end if;

  perform 1 from public.profiles where id = p_user_id for update;
  if not found then raise exception 'USER_NOT_FOUND'; end if;

  normalized := regexp_replace(
    regexp_replace(
      regexp_replace(lower(trim(p_url)), '^https?://(www\.)?', '', 'i'),
      '[?#].*$', '', 'g'
    ),
    '/+$', '', 'g'
  );

  select id into existing_project_id
  from public.projects
  where user_id = p_user_id and normalized_url = normalized
  order by created_at asc, id asc
  limit 1;

  if existing_project_id is not null then
    update public.projects
    set url = p_url,
        profile = coalesce(p_profile, profile),
        prefs = coalesce(p_prefs, prefs),
        brand_theme = coalesce(p_brand_theme, brand_theme)
    where id = existing_project_id;
    return query select * from public.projects where id = existing_project_id;
    return;
  end if;

  if not coalesce(p_unlimited, false) then
    select count(*)::integer into current_count from public.projects where user_id = p_user_id;
    if p_max_companies is null or current_count >= p_max_companies then
      raise exception 'PLAN_LIMIT: company limit reached';
    end if;
  end if;

  return query
  insert into public.projects(user_id, url, normalized_url, profile, prefs, brand_theme)
  values (p_user_id, p_url, normalized, p_profile, p_prefs, p_brand_theme)
  returning *;
end;
$$;

revoke all on function public.create_project_for_user(uuid, text, jsonb, jsonb, jsonb, integer, boolean) from public, anon, authenticated;
grant execute on function public.create_project_for_user(uuid, text, jsonb, jsonb, jsonb, integer, boolean) to service_role;

commit;
