-- Sparrow account/plan visibility + backfill for existing Auth users.
-- Run once in Supabase SQL Editor after supabase_schema.sql and the multi-company migration.

-- Make sure every existing Auth user has a visible profile row.
insert into public.profiles (id, email, plan, role)
select u.id, u.email, 'free', 'user'
from auth.users u
on conflict (id) do update
set email = coalesce(excluded.email, public.profiles.email),
    updated_at = now();

-- Keep a subscription row available for every account. Billing/webhooks can later
-- change plan/status; the account UI can then show exactly who is Free vs Pro.
insert into public.subscriptions (user_id, plan, status)
select p.id, p.plan, case when p.plan = 'pro' then 'active' else 'inactive' end
from public.profiles p
on conflict (user_id) do nothing;

-- Helpful view for the Supabase dashboard / SQL Editor.
-- It exposes account identity + current plan without touching auth.users directly in the UI.
create or replace view public.sparrow_account_status with (security_invoker = true) as
select
  p.id as user_id,
  p.email,
  p.full_name,
  p.plan,
  p.role,
  s.status as subscription_status,
  s.provider,
  s.current_period_end,
  p.created_at
from public.profiles p
left join public.subscriptions s on s.user_id = p.id;

-- RLS still controls direct table access. The view is intended for the dashboard/SQL Editor;
-- do not grant it to anon.
revoke all on public.sparrow_account_status from anon;
grant select on public.sparrow_account_status to authenticated;


-- Keep future signups' display name in sync with Auth user metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles(id, email, full_name)
  values (new.id, new.email, nullif(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), ''))
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(public.profiles.full_name, excluded.full_name),
        updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();
