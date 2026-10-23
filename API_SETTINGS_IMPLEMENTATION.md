# Company AI/API settings — implementation notes

## Included in this working build
- Company-scoped API mode, service provider/model preferences, and content defaults are saved to the existing `project_ai_settings` row keyed by `project_id`.
- Personal API credentials are encrypted server-side with AES-256-GCM before being written into that row. The browser never receives the saved key back.
- The `API_CREDENTIALS_ENCRYPTION_KEY` environment variable is required to save personal keys. Use a unique random secret of at least 32 characters and keep it stable across deployments. If it is lost, saved keys cannot be decrypted.
- The API route verifies the signed-in user and project ownership before reads or writes, and uses the user's Supabase token/RLS.
- One shared Social Media Posts quantity is bounded to 1–5 across connected social platforms; blog generation remains one blog per request (there is intentionally no blog quantity field). Other content defaults are bounded and saved per company.
- The UI treats image and video providers as separate service configurations and reports key presence only, never secret values.

## Required environment setup
Add `API_CREDENTIALS_ENCRYPTION_KEY` to local `.env.local` and production environment variables before saving personal API keys. Do not commit `.env.local` or any real credentials. The supplied `.env.example` is only a template.

## n8n integration status
The n8n workflow JSON was not supplied with this package, so this package does not claim that n8n generation is already switching providers. The UI and persistence layer save settings and encrypted credentials. The new n8n Settings node must next consume the settings for the authenticated `project_id`, decrypt/use credentials only server-side, validate required services per operation, enforce post counts, and fail closed without fallback to platform credentials in personal mode. Do not pass decrypted credentials into client-visible responses or logs.

## Database
Uses the existing `public.project_ai_settings` table and `project_id` conflict key described in the current project setup. No SQL migration is included because the currently observed table already contains `project_id`, `settings` JSONB, `created_at`, and `updated_at`. The `project_id` column must have a unique or primary-key constraint for upsert to work.

## Follow-up UI behaviour included in the test build

- Content quantity controls are disabled in Sparrow AI mode and editable only in My Own APIs mode. The settings API also ignores quantity overrides in Sparrow AI mode and preserves the project's saved values/defaults.
- A single Social Media Posts quantity is bounded to 1–5 across connected social platforms. Blog generation remains a single blog per request; the UI does not expose a blog-count control.
- Parsed Google/Meta ad copy, email, WhatsApp, SMS, and lead follow-up pieces are consolidated into one `Ads & Messages` card with a Copy action only. This card does not expose edit, schedule, or expand actions.

## Validation status

TypeScript transpilation/syntax checks passed for the edited Studio page, API settings component, and project settings route. A full Next.js production build has not been verified in this environment because the installed dependency/type package directory is incomplete. The new n8n workflow is still required to verify actual generation-time API routing and enforcement.

## Single-table settings design

All company-specific AI/API settings and content defaults are stored together in `public.project_ai_settings.settings` (JSONB), keyed by `project_id`. The API route does not read or write `project_ai_service_settings` or `project_ai_content_settings`. Do not run the old normalization migration included in earlier test packages; it is intentionally excluded from this package.


## Profile API settings UI polish (2026-10-10)
- Replaced emoji visibility controls with accessible inline eye/eye-off SVG icons.
- Removed success banners, project-id footer text, and the saved-key checkbox.
- Connected services show a Remove action; entering a replacement key exposes Update API key. Removal clears only that service credential.
- Saved API keys are intentionally never returned to the browser. The UI shows a masked saved-key indicator; the eye toggles visibility only for a newly entered replacement key.
- The project ownership error response now narrows optional error/status types for TypeScript.
