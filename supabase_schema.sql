-- Sparrow Content Generation Agent
-- Supabase schema for Sparrow.
-- This file is intended to leave the database in its production multi-user state.
-- Analysis and generation require an authenticated user. Project creation is server-side through the service-role RPC.

create extension if not exists pgcrypto;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  url text not null check (char_length(url) between 1 and 2048),
  profile jsonb,
  prefs jsonb,
  brand_theme jsonb,
  normalized_url text
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  job_id text,
  status text not null default 'starting' check (status in ('starting','running','partial','completed','failed','cancelled')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  request_id text,
  last_error text,
  sections jsonb not null default '{}'::jsonb,
  schedule jsonb not null default '{}'::jsonb
);

create index if not exists projects_created_at_idx on public.projects(created_at desc);
create index if not exists projects_url_idx on public.projects(url);
create index if not exists projects_normalized_url_idx on public.projects(normalized_url);
create index if not exists jobs_project_id_idx on public.jobs(project_id);
create index if not exists jobs_job_id_idx on public.jobs(job_id);
create index if not exists jobs_started_at_idx on public.jobs(started_at desc);
create index if not exists jobs_request_id_idx on public.jobs(request_id);

-- Safe migration for an existing Sparrow database.
alter table public.jobs add column if not exists finished_at timestamptz;
alter table public.jobs add column if not exists request_id text;
alter table public.jobs add column if not exists last_error text;
alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs add constraint jobs_status_check check (status in ('starting','running','partial','completed','failed','cancelled'));


alter table public.projects disable row level security;
alter table public.jobs disable row level security;

grant select, insert, update, delete on public.projects to anon;
grant select, insert, update, delete on public.jobs to anon;

-- ============================================================
-- Production multi-user / plans / ownership migration
-- Run this section after the base schema above.
-- ============================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  plan text not null default 'free' check (plan in ('free','pro')),
  role text not null default 'user' check (role in ('user','owner')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  plan text not null check (plan in ('free','pro')),
  status text not null default 'inactive',
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  project_id uuid references public.projects(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists profiles_plan_idx on public.profiles(plan);
create index if not exists subscriptions_user_idx on public.subscriptions(user_id);
create index if not exists audit_logs_user_created_idx on public.audit_logs(user_id, created_at desc);

-- Attach projects to authenticated users. Existing anonymous rows remain NULL.
alter table public.projects add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.projects add column if not exists normalized_url text;
create index if not exists projects_user_created_idx on public.projects(user_id, created_at desc);
create unique index if not exists projects_user_normalized_url_uidx on public.projects(user_id, normalized_url) where user_id is not null and normalized_url is not null;

-- Automatically create a free profile for every new Supabase Auth user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles(id, email, full_name)
  values (new.id, new.email, nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), ''))
  on conflict (id) do update set email = excluded.email, full_name = coalesce(public.profiles.full_name, excluded.full_name), updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

-- Keep the project owner attached automatically for authenticated inserts.
alter table public.projects alter column user_id set default auth.uid();

alter table public.projects enable row level security;
alter table public.jobs enable row level security;
alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;
alter table public.audit_logs enable row level security;

-- Remove old broad anon policies/grants from the pre-auth prototype.
revoke all on public.projects from anon;
revoke all on public.jobs from anon;
revoke all on public.profiles from anon;
revoke all on public.subscriptions from anon;
revoke all on public.audit_logs from anon;

grant select, update, delete on public.projects to authenticated;
revoke insert on public.projects from authenticated;
grant select, insert, update, delete on public.jobs to authenticated;
grant select on public.profiles to authenticated;
grant select on public.subscriptions to authenticated;
grant insert on public.audit_logs to authenticated;

drop policy if exists projects_select_own on public.projects;
drop policy if exists projects_insert_own on public.projects;
drop policy if exists projects_update_own on public.projects;
drop policy if exists projects_delete_own on public.projects;
create policy projects_select_own on public.projects for select to authenticated using (user_id = auth.uid());
create policy projects_insert_own on public.projects for insert to authenticated with check (user_id = auth.uid());
create policy projects_update_own on public.projects for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy projects_delete_own on public.projects for delete to authenticated using (user_id = auth.uid());

drop policy if exists jobs_select_own on public.jobs;
drop policy if exists jobs_insert_own on public.jobs;
drop policy if exists jobs_update_own on public.jobs;
drop policy if exists jobs_delete_own on public.jobs;
create policy jobs_select_own on public.jobs for select to authenticated using (exists (select 1 from public.projects p where p.id = jobs.project_id and p.user_id = auth.uid()));
create policy jobs_insert_own on public.jobs for insert to authenticated with check (exists (select 1 from public.projects p where p.id = jobs.project_id and p.user_id = auth.uid()));
create policy jobs_update_own on public.jobs for update to authenticated using (exists (select 1 from public.projects p where p.id = jobs.project_id and p.user_id = auth.uid())) with check (exists (select 1 from public.projects p where p.id = jobs.project_id and p.user_id = auth.uid()));
create policy jobs_delete_own on public.jobs for delete to authenticated using (exists (select 1 from public.projects p where p.id = jobs.project_id and p.user_id = auth.uid()));

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles for select to authenticated using (id = auth.uid());

drop policy if exists subscriptions_select_own on public.subscriptions;
create policy subscriptions_select_own on public.subscriptions for select to authenticated using (user_id = auth.uid());

drop policy if exists audit_insert_own on public.audit_logs;
create policy audit_insert_own on public.audit_logs for insert to authenticated with check (user_id = auth.uid());

-- Existing anonymous demo rows are intentionally not assigned to a new user.
-- A future secure "claim project" flow can explicitly transfer a row after verification.

-- ============================================================
-- Production hardening: transactional company limits
-- The API calls this function with the server-only service role.
-- It locks the user's profile row so concurrent requests cannot
-- race past the Free/Pro company limit.
-- ============================================================

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
  if p_user_id is null then
    raise exception 'USER_NOT_FOUND';
  end if;

  perform 1 from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'USER_NOT_FOUND';
  end if;

  normalized := regexp_replace(regexp_replace(regexp_replace(lower(trim(p_url)), '^https?://(www\.)?', '', 'i'), '[?#].*$', '', 'g'), '/+$', '', 'g');

  select id into existing_project_id from public.projects where user_id = p_user_id and normalized_url = normalized order by created_at asc limit 1;
  if existing_project_id is not null then
    update public.projects set url = p_url, profile = coalesce(p_profile, profile), prefs = coalesce(p_prefs, prefs), brand_theme = coalesce(p_brand_theme, brand_theme) where id = existing_project_id;
    return query select * from public.projects where id = existing_project_id;
    return;
  end if;
  if not coalesce(p_unlimited, false) then
    select count(*)::integer into current_count
    from public.projects
    where user_id = p_user_id;
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

alter table public.jobs add column if not exists live_view_token text;
create index if not exists jobs_live_view_token_idx on public.jobs(live_view_token) where live_view_token is not null;
