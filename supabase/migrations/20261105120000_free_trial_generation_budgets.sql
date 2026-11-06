-- Support one LinkedIn and one Blog generation per anonymous visitor.
-- The existing visitor flags and 100-credit balance already model this quota.
alter table public.free_trial_generations
  add column if not exists total_tokens integer,
  add column if not exists usage_metadata_available boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'free_trial_generations_total_tokens_nonnegative'
      and conrelid = 'public.free_trial_generations'::regclass
  ) then
    alter table public.free_trial_generations
      add constraint free_trial_generations_total_tokens_nonnegative
      check (total_tokens is null or total_tokens >= 0);
  end if;
end;
$$;

-- Atomically restore only the failed generation's 50-credit reservation.
create or replace function public.release_free_trial_claim(
  p_visitor_id uuid,
  p_generation_type text,
  p_credit_cost integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_generation_type is null or p_generation_type not in ('linkedin', 'blog') or p_credit_cost is distinct from 50 then
    raise exception 'Invalid free-trial claim release.';
  end if;

  if p_generation_type = 'linkedin' then
    update public.free_trial_visitors
      set linkedin_used = false,
          credits_remaining = least(credits_total, credits_remaining + p_credit_cost),
          updated_at = now()
      where id = p_visitor_id and linkedin_used = true
        and not exists (
          select 1 from public.free_trial_generations
          where visitor_id = p_visitor_id and generation_type = 'linkedin' and status = 'success'
        );
  else
    update public.free_trial_visitors
      set blog_used = false,
          credits_remaining = least(credits_total, credits_remaining + p_credit_cost),
          updated_at = now()
      where id = p_visitor_id and blog_used = true
        and not exists (
          select 1 from public.free_trial_generations
          where visitor_id = p_visitor_id and generation_type = 'blog' and status = 'success'
        );
  end if;
end;
$$;

revoke all on function public.release_free_trial_claim(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.release_free_trial_claim(uuid, text, integer) to service_role;
