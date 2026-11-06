-- Free trial visitor state, generated drafts, and optional marketing leads.
-- Trusted server-side code owns writes; no anonymous access policies are defined.

create table if not exists public.free_trial_visitors (
  id uuid primary key default gen_random_uuid(),
  visitor_hash text not null unique,
  credits_total integer not null default 100,
  credits_remaining integer not null default 100,
  linkedin_used boolean not null default false,
  blog_used boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint free_trial_visitors_total_nonnegative check (credits_total >= 0),
  constraint free_trial_visitors_remaining_nonnegative check (credits_remaining >= 0),
  constraint free_trial_visitors_remaining_within_total check (credits_remaining <= credits_total)
);

comment on table public.free_trial_visitors is 'Server-managed identity and trial usage state for free-trial visitors.';
comment on column public.free_trial_visitors.visitor_hash is 'Server-generated non-reversible visitor identifier; never store raw browser identity here.';

create table if not exists public.free_trial_generations (
  id uuid primary key default gen_random_uuid(),
  visitor_id uuid not null references public.free_trial_visitors(id),
  generation_type text not null,
  generated_content text,
  prompt_tokens integer,
  completion_tokens integer,
  credits_used integer,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint free_trial_generations_type_valid check (generation_type in ('linkedin', 'blog')),
  constraint free_trial_generations_status_valid check (status in ('pending', 'success', 'failed')),
  constraint free_trial_generations_prompt_tokens_nonnegative check (prompt_tokens is null or prompt_tokens >= 0),
  constraint free_trial_generations_completion_tokens_nonnegative check (completion_tokens is null or completion_tokens >= 0),
  constraint free_trial_generations_credits_nonnegative check (credits_used is null or credits_used >= 0)
);

comment on table public.free_trial_generations is 'Server-managed trial generation attempts and generated content.';
comment on column public.free_trial_generations.status is 'Generation lifecycle state; successful generations are unique per visitor and type.';

create unique index if not exists free_trial_generations_one_success_per_type
  on public.free_trial_generations (visitor_id, generation_type)
  where status = 'success';

create index if not exists free_trial_generations_visitor_created_idx
  on public.free_trial_generations (visitor_id, created_at desc);

create table if not exists public.marketing_leads (
  id uuid primary key default gen_random_uuid(),
  visitor_id uuid not null references public.free_trial_visitors(id),
  name text not null,
  email text not null,
  company_name text not null,
  phone text,
  marketing_consent boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.marketing_leads is 'Contact details provided by trial visitors; marketing consent is separate and optional.';
comment on column public.marketing_leads.marketing_consent is 'Explicit opt-in for marketing communication; false by default and not required for trial access.';

create index if not exists marketing_leads_visitor_created_idx
  on public.marketing_leads (visitor_id, created_at desc);

create index if not exists marketing_leads_email_idx
  on public.marketing_leads (lower(email));

alter table public.free_trial_visitors enable row level security;
alter table public.free_trial_generations enable row level security;
alter table public.marketing_leads enable row level security;

-- No client policies are added: all access is intended through trusted server-side code.
