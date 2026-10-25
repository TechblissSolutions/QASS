-- Sparrow social-account OAuth persistence. Safe to apply more than once.
-- Tokens are encrypted by the server before insertion; never store plaintext OAuth tokens.
create table if not exists public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('instagram','facebook','linkedin','x','youtube','wordpress')),
  provider_account_id text not null,
  account_name text not null,
  account_handle text,
  account_avatar_url text,
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  provider_metadata jsonb not null default '{}'::jsonb,
  status text not null default 'connected' check (status in ('connected','expired','revoked','disconnected','error')),
  connected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_accounts_project_provider_identity_key unique (project_id, provider, provider_account_id)
);

create index if not exists social_accounts_user_project_idx
  on public.social_accounts(user_id, project_id);

alter table public.social_accounts enable row level security;

-- User-facing APIs use the authenticated Supabase client. Service-role writes are server-only.
drop policy if exists social_accounts_select_own_company on public.social_accounts;
create policy social_accounts_select_own_company on public.social_accounts
  for select to authenticated
  using (
    user_id = auth.uid()
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

drop policy if exists social_accounts_insert_own_company on public.social_accounts;
create policy social_accounts_insert_own_company on public.social_accounts
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

drop policy if exists social_accounts_update_own_company on public.social_accounts;
create policy social_accounts_update_own_company on public.social_accounts
  for update to authenticated
  using (
    user_id = auth.uid()
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  )
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

drop policy if exists social_accounts_delete_own_company on public.social_accounts;
create policy social_accounts_delete_own_company on public.social_accounts
  for delete to authenticated
  using (
    user_id = auth.uid()
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = auth.uid())
  );

-- Do not grant browser users access to token columns. The authenticated client only needs
-- identity/status fields for the calendar UI; OAuth token reads/writes use the server-only service role.
revoke all on public.social_accounts from anon, authenticated;
grant select (id, project_id, user_id, provider, provider_account_id, account_name, account_handle, account_avatar_url, token_expires_at, provider_metadata, status, connected_at, created_at, updated_at)
  on public.social_accounts to authenticated;
