# Sparrow Content Generation Agent

Sparrow is a production-oriented Next.js content-generation application backed by n8n, Supabase, Upstash Redis, Sentry and Vercel.

## Architecture

- **Next.js App Router**: UI and server API routes.
- **Supabase Auth + Postgres + RLS**: identity, durable projects/jobs, ownership and plan metadata.
- **n8n**: website analysis, content generation and live-view workflow execution. Sparrow does not require n8n workflow changes.
- **Upstash Redis**: shared serverless rate limits and generation safety counters. This replaces correctness-critical in-memory counters.
- **Sentry**: server/client error monitoring.
- **Vercel**: horizontally scalable hosting for the Next.js application.

Local `Map` caches remain only as best-effort performance caches. They are never used for authorization, quotas or correctness.

## Requirements

- Node.js 22+
- Supabase project
- n8n workflow endpoints
- Upstash Redis for production
- Sentry is recommended for production monitoring

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

For local development, Upstash variables can be empty and the app uses a local rate-limit fallback. **Production must have Redis configured.**

## Environment variables

Required:

```env
N8N_BASE=https://your-n8n-host.example.com
N8N_ANALYSE_PATH=/form/your-analysis-form-id
N8N_GENERATE_PATH=/webhook/your-generation-webhook
N8N_LIVE_VIEW_PATH=/webhook/your-live-view-webhook
# Optional; reserved for future media-provider routes
N8N_MEDIA_PATH=/webhook/your-media-webhook
N8N_CA_CERT=

NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

SPARROW_LIVE_VIEW_SECRET=long-random-secret-at-least-32-characters
SPARROW_OWNER_EMAILS=your-email@example.com
SPARROW_OWNER_USER_IDS=

UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
SPARROW_RATE_LIMIT_PER_MINUTE=30
SPARROW_GLOBAL_DAILY_GENERATION_LIMIT=2000
SPARROW_FREE_DAILY_GENERATION_LIMIT=10
SPARROW_PRO_DAILY_GENERATION_LIMIT=100

SENTRY_DSN=
MAINTENANCE_MODE=false
EDGE_CONFIG=
```

### Secret handling

Never expose `SUPABASE_SERVICE_ROLE_KEY`, `SPARROW_LIVE_VIEW_SECRET`, or Redis tokens with a `NEXT_PUBLIC_` prefix. Keep them in Vercel server environment variables and in local `.env.local`, which is gitignored.

Do not commit real n8n webhook hostnames, webhook IDs, service-role keys, Redis tokens, or other production credentials. `.env.example` intentionally uses placeholders.

Generate the live-view secret with a password manager or, on PowerShell, `-join ((48..122) | Get-Random -Count 64 | % {[char]$_})`. It must be at least 32 characters.

## Supabase

Run `supabase_schema.sql` in the Supabase SQL Editor. The final state enables RLS for projects, jobs, profiles, subscriptions and audit logs.

Analysis and generation require an authenticated Supabase session. Project creation is performed only through the server-side company-limit RPC; browser clients cannot insert directly into `projects`.

The schema includes a server-only transactional function for company limits. The API invokes it with the Supabase service-role key so concurrent requests cannot race past Free/Pro limits.

## Production traffic protection

Vercel functions are stateless and may run on multiple instances. Therefore correctness-critical controls are shared through Upstash Redis:

- per-IP API rate limiting
- per-user daily generation quotas for Free and Pro
- global daily generation safety cap
- failed generations refund their reserved daily quota counters

The generation concurrency limit was deliberately removed from process memory. n8n remains the generation worker/orchestrator; Vercel should not depend on a single function instance's memory for concurrency accounting.

If Redis is unavailable in production, Sparrow fails closed for analysis/generation. Read-only/account/polling routes can continue with a local short-window limiter so a Redis outage does not make the whole application unusable.

## Live-view security

Live-view responses use a short-lived signed capability token. Authenticated jobs additionally remain protected by Supabase RLS. Anonymous jobs receive the signed live-view token from the generation request; a bare `job_id` is no longer sufficient to retrieve generated content.

Tokens expire after six hours. They are stored only for authenticated jobs so an authenticated user can resume an in-progress generation from history.

## SSRF and proxy hardening

Website analysis, brand appearance and logo proxy requests:

- allow only HTTP/HTTPS URLs
- resolve DNS and reject private/link-local/multicast/local addresses
- re-check every redirect target
- cap logo response size at 2 MB
- sandbox SVG responses at the proxy boundary
- pin public DNS results for outbound fetches to reduce DNS-rebinding risk
- cap brand-appearance HTML/CSS fetches and require authentication
- use request rate limits

This is defense-in-depth; no arbitrary internal URL should be considered trusted input.

## Security headers

The application sends `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, and HSTS in production. n8n webhook calls use the configured production webhook URLs directly without shared-secret authentication.

## Error handling

- Root render failures are handled by `app/global-error.tsx` and reported to Sentry.
- API errors use stable request IDs where appropriate.
- Upstream n8n failures are converted into user-safe error messages rather than leaking raw upstream HTML.
- Request bodies have explicit size limits.

## Plans

Current entitlement model:

- **Free**: 1 saved company, initial generation.
- **Pro**: up to 5 saved companies and regeneration.
- **Owner**: unlimited companies and all current features.

The pricing page is an entitlement/billing shell. Payment-provider checkout/webhooks are not included yet. When billing is added, verified subscription webhooks should update `profiles.plan` and `subscriptions` server-side.

## Regeneration

The existing n8n workflow has one generation webhook and consumes `additional_instructions`. Sparrow uses that existing contract for full-package regeneration by passing the previous generated package plus an improvement instruction. No n8n workflow change is required.

## Deployment to Vercel

1. Push the repository to the company GitHub repository.
2. Import the repository into Vercel.
3. Select Node.js 22+ / the Next.js framework.
4. Add all production environment variables from `.env.example`.
5. Create/connect an Upstash Redis database through Vercel or Upstash and add its REST URL/token. Upstash's REST client is designed for serverless functions.
6. Run the Supabase schema before exposing the production app.
7. Deploy.
8. Test `/api/health`, signup/login, analysis, generation, live-view polling, dashboard history and owner entitlements.
9. Enable Sentry and watch the first production deployment for upstream n8n failures, Redis failures and Supabase RLS errors.

### Important Vercel note

Sparrow is designed to scale horizontally at the web/API layer, but content generation still depends on the latency and concurrency of the external n8n workflow. Vercel cannot make a slow or overloaded n8n workflow faster. If generation eventually becomes long-running, the next architectural step is an asynchronous queue/callback model so the API request does not remain open while n8n works.

## Verification

Run:

```bash
npm test
npm run build
```

The repository is configured for Node.js 20+. Before the first production deployment, these commands should be run in CI/Vercel as the final dependency-resolution check. The production ZIP includes `package-lock.json`; use `npm ci` rather than `npm install` in CI and Vercel.

### Existing database migration

For an existing Sparrow database, run `supabase_multi_company_migration.sql` once after `supabase_schema.sql`. It safely backs up existing rows, canonicalizes duplicate company URLs, reassigns jobs to the canonical project, and installs the user/company uniqueness constraint. Do not remove the backup tables until production verification is complete.

### Production readiness notes

- Company identity is persisted from the analysis response and has a safe domain-derived fallback plus initials/logo fallback in the dashboard and sidebar.
- Authenticated API responses use `private, no-store`; only public website-resource caches are shared in-process and they are never used for authorization.
- Production requires working Upstash Redis and the Supabase service-role key. The application fails closed for protected traffic when those are unavailable.
- The current pricing page intentionally does not claim working billing; Pro upgrades require an administrative plan change until payment webhooks are added.

## Account plans in Supabase

Run `supabase_entitlements_backfill.sql` once after the main schema/migration. It backfills `profiles` for existing Auth users and creates `sparrow_account_status`, so the Supabase dashboard can clearly show each user's email, plan (`free`/`pro`), role, and subscription status.


## Frontend-only n8n file-backed live output fix
- UI/layout unchanged.
- Studio now polls the existing `/api/live-view` endpoint concurrently for missing sections.
- Explicitly treats n8n pending responses as pending, not generated content.
- Accepts the native file-backed HTML returned by the current n8n workflow and only marks a section ready when real content cards are parsed.
- Keeps the existing 4s/8s/12s/20s backoff, visibility pause, Supabase persistence, cancellation behavior, and 20-minute safety limit.
- No n8n workflow/backend changes are included.

## Local environment

Do not commit `.env.local` or paste its secrets into source control. For the Fixed5/Fixed6 workspace, copy the existing Sparrow local environment file into the **actual extracted project folder** before running the app:

```powershell
Copy-Item "C:\Users\tanis\Downloads\qass\.env.local" "C:\Users\tanis\OneDrive\Desktop\Sparrow_Scheduling_Phase1-4_Brand_Ready_EditRef_Fixed6\.env.local"
```

Verify it with:

```powershell
Test-Path ".env.local"
```

It must return `True` while PowerShell is inside the Fixed6 folder.

## Scheduling schema

The scheduler uses the existing `scheduled_posts.platforms` JSON column and the related `social_accounts` table. It does **not** require a `scheduled_post_targets` table.

## Scheduling media storage

Run `supabase_scheduling_storage.sql` once in the existing Supabase project to create the `scheduled-media` Storage bucket. The server upload endpoint also checks for the bucket and creates it automatically when `SUPABASE_SERVICE_ROLE_KEY` is available.

## Social OAuth

See `SOCIAL_OAUTH_SETUP.md`. The six platform cards are intentionally independent. A platform without developer credentials is shown as requiring OAuth setup rather than producing a runtime connection error.
