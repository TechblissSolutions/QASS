-- QASS Admin Dashboard: run this migration in the Supabase SQL Editor.
-- Admin APIs use the server-side service-role key; ordinary clients receive no table access.
create table if not exists public.admin_feature_flags (
  key text primary key,
  label text not null,
  description text not null default '',
  enabled boolean not null default true,
  sort_order integer not null default 100,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.admin_feature_flags enable row level security;
revoke all on public.admin_feature_flags from anon, authenticated;

grant all on public.admin_feature_flags to service_role;

insert into public.admin_feature_flags (key,label,description,enabled,sort_order) values
 ('generation','AI content generation','Create and regenerate content in Studio.',true,10),
 ('scheduling','Social scheduling','Calendar, scheduled posts, publishing and post management.',true,20),
 ('social_connections','Social account connections','Connect and manage publishing accounts.',true,30),
 ('website_analysis','Website analysis','Analyse a website and build its Brand DNA.',true,40),
 ('media_generation','Media generation','Generate or attach images and other media.',true,50),
 ('history','Content history','View previous generation results and job history.',true,60),
 ('brand_dna','Brand DNA','View and edit company brand information.',true,70),
 ('personal_apis','Use personal APIs','Allow users to configure their own provider credentials.',true,80)
on conflict (key) do nothing;

-- Per-user plan and feature overrides. NULL override means inherit platform-wide switch.
create table if not exists public.admin_user_feature_overrides (
  user_id uuid not null references auth.users(id) on delete cascade,
  feature_key text not null references public.admin_feature_flags(key) on delete cascade,
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (user_id, feature_key)
);
alter table public.admin_user_feature_overrides enable row level security;
revoke all on public.admin_user_feature_overrides from anon, authenticated;
grant all on public.admin_user_feature_overrides to service_role;

create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_audit_log enable row level security;
revoke all on public.admin_audit_log from anon, authenticated;
grant all on public.admin_audit_log to service_role;

-- Minimal device registry for first-seen-device security notifications. Store only a hash of the browser token.
create table if not exists public.account_login_devices (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_hash text not null,
  user_agent text not null default '',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique(user_id, device_hash)
);
alter table public.account_login_devices enable row level security;
revoke all on public.account_login_devices from anon, authenticated;
grant all on public.account_login_devices to service_role;


-- Per-project API mode policy. NULL means the project owner chooses their own mode.
create table if not exists public.admin_project_api_policies (
  project_id uuid primary key references public.projects(id) on delete cascade,
  api_mode_override text null check (api_mode_override in ('platform','personal') or api_mode_override is null),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
alter table public.admin_project_api_policies enable row level security;
revoke all on public.admin_project_api_policies from anon, authenticated;
grant all on public.admin_project_api_policies to service_role;
