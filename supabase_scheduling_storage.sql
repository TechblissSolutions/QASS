-- Sparrow scheduled-media storage
-- Run this once in the existing Supabase project.
-- The app also self-heals the bucket at upload time when the service role is configured.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'scheduled-media',
  'scheduled-media',
  true,
  10485760,
  array['image/jpeg','image/png','image/webp','image/gif']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
