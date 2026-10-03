-- Sparrow production hardening. Run after the base schema/multi-company migration.
-- Safe to re-run.

-- Client browsers never create projects directly. Creation goes through the
-- server-only create_project_for_user RPC, which enforces plan limits under a row lock.
revoke insert on public.projects from authenticated;

-- Fix URL canonicalization and backfill existing rows. The canonical form
-- lowercases only the host, strips www/default ports/query/hash/trailing slash,
-- and preserves path case like the TypeScript normalizer.
create or replace function public.normalize_project_url(p_url text)
returns text
language plpgsql
immutable
strict
as $$
declare
  value text := trim(p_url);
  authority text;
  path text := '';
  slash_pos integer;
begin
  value := regexp_replace(value, '^https?://', '', 1, 1, 'i');
  value := split_part(split_part(value, '#', 1), '?', 1);
  value := regexp_replace(value, '/+$', '', 'g');
  slash_pos := position('/' in value);
  if slash_pos > 0 then
    authority := left(value, slash_pos - 1);
    path := substr(value, slash_pos);
  else
    authority := value;
  end if;
  authority := lower(regexp_replace(authority, '^www\.', '', 1, 1, 'i'));
  authority := regexp_replace(authority, ':443$', '', 1, 1, 'i');
  authority := regexp_replace(authority, ':80$', '', 1, 1, 'i');
  return authority || path;
end;
$$;

update public.projects
set normalized_url = public.normalize_project_url(url)
where url is not null;

-- If older migrations left duplicates behind, preserve the oldest project and
-- move the duplicate generation history to it before rebuilding the unique index.
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
    set url = n.url, profile = coalesce(n.profile, c.profile), prefs = coalesce(n.prefs, c.prefs), brand_theme = coalesce(n.brand_theme, c.brand_theme)
    from public.projects n
    where c.id = canonical and n.id = newest;

    update public.jobs
    set project_id = canonical
    where project_id in (
      select p.id from public.projects p
      where p.user_id = dup.user_id and p.normalized_url = dup.normalized_url and p.id <> canonical
    );

    delete from public.projects
    where user_id = dup.user_id and normalized_url = dup.normalized_url and id <> canonical;
  end loop;
end $$;

-- Keep the RPC canonicalization in sync with the backfill above.
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
  normalized := public.normalize_project_url(p_url);
  select id into existing_project_id from public.projects where user_id = p_user_id and normalized_url = normalized order by created_at asc limit 1;
  if existing_project_id is not null then
    update public.projects set url = p_url, profile = coalesce(p_profile, profile), prefs = coalesce(p_prefs, prefs), brand_theme = coalesce(p_brand_theme, brand_theme) where id = existing_project_id;
    return query select * from public.projects where id = existing_project_id;
    return;
  end if;
  if not coalesce(p_unlimited, false) then
    select count(*)::integer into current_count from public.projects where user_id = p_user_id;
    if p_max_companies is null or current_count >= p_max_companies then raise exception 'PLAN_LIMIT: company limit reached'; end if;
  end if;
  return query insert into public.projects(user_id, url, normalized_url, profile, prefs, brand_theme) values (p_user_id, p_url, normalized, p_profile, p_prefs, p_brand_theme) returning *;
end;
$$;

revoke all on function public.create_project_for_user(uuid, text, jsonb, jsonb, jsonb, integer, boolean) from public, anon, authenticated;
grant execute on function public.create_project_for_user(uuid, text, jsonb, jsonb, jsonb, integer, boolean) to service_role;

-- Ensure the unique company identity index is present after canonicalization.
create unique index if not exists projects_user_normalized_url_uidx
  on public.projects(user_id, normalized_url)
  where user_id is not null and normalized_url is not null;
