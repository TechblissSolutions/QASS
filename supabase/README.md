# Sparrow Supabase setup

Run `../supabase_schema.sql` in the Supabase SQL Editor.

The schema is production-oriented:

- Supabase Auth owns users.
- `profiles` stores plan/role metadata.
- `projects` and `jobs` are protected by RLS and owned by `auth.uid()`.
- `subscriptions` and `audit_logs` are protected by RLS.
- Anonymous demo requests are intentionally not persisted.
- `create_project_for_user` is a server-only transactional function used to enforce company limits without race conditions.

The Next.js server needs the Supabase service-role key for this function. Never expose that key to browser code or prefix it with `NEXT_PUBLIC_`.
