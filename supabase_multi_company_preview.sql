-- Read-only preview before running supabase_multi_company_migration.sql
select
  user_id,
  lower(regexp_replace(regexp_replace(regexp_replace(trim(url), '^https?://(www\\.)?', '', 'i'), '[?#].*$', '', 'g'), '/+$', '')) as normalized_candidate,
  count(*) as project_count,
  array_agg(id order by created_at asc) as project_ids
from public.projects
group by user_id, normalized_candidate
having count(*) > 1
order by project_count desc;

select count(*) as projects_before from public.projects;
select count(*) as jobs_before from public.jobs;
