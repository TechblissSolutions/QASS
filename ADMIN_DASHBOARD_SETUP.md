# QASS Admin Dashboard setup

## What's included
- `/admin` dashboard with overview metrics, registered users, per-user project inspection, recent generation jobs, and feature switches.
- Server-side admin APIs under `/api/admin/*` that require a valid Supabase session and administrator authorization.
- Persistent feature flags in `public.admin_feature_flags`.
- API enforcement for generation, website analysis, scheduling CRUD, media routes, and social-account connection routes. Authorized admins bypass user-facing feature gates.

## Before running
1. In Supabase SQL Editor, run `supabase_admin_dashboard.sql`.
2. In the server environment (local `.env.local` and Vercel Project Settings), set `SPARROW_OWNER_EMAILS` to a comma-separated list of trusted administrator emails. The existing `SPARROW_OWNER_USER_IDS` allowlist is also supported. Never use `NEXT_PUBLIC_` for admin configuration.
3. Ensure `SUPABASE_SERVICE_ROLE_KEY` exists only in server-side environment variables. Do not expose it to browser code.
4. Start the app and sign in with an authorized admin account, then visit `/admin`.

## Feature switch behavior
- `generation` gates `/api/generate`.
- `website_analysis` gates `/api/analyse`.
- `scheduling` gates scheduled-post CRUD, publishing media upload/download, and the scheduled publishing worker (the worker safely skips publishing when disabled).
- `social_connections` gates social-account list/delete and OAuth connection initiation.
- `media_generation`, `history`, `brand_dna`, and `personal_apis` are persistent controls exposed in the dashboard; these need to be wired to their corresponding remaining UI/API entry points before treating them as fully enforced feature gates.

Feature toggles are global. They do not delete user data. Disabling a feature blocks the covered APIs; re-enabling it restores access. Admins retain access to covered features.

## Security notes
- The dashboard reads Auth users and cross-user project/job data only on the server through the service-role client.
- Admin endpoints validate the Supabase access token and then check the server-side owner allowlist or `profiles.role = 'owner'`.
- The SQL migration enables RLS and revokes table access from `anon` and `authenticated` roles; only the service role can access feature flags.
- No user deletion, project deletion, role editing, or subscription changes are exposed in this initial dashboard to avoid destructive actions without an explicit policy.

## Per-user premium and feature overrides
- In Admin → Users & projects → Inspect a user, set the account to Free or Premium and set individual feature switches.
- `Premium` is stored as `profiles.plan = 'pro'` to match the existing schema. This changes the profile plan label; connect the existing billing/entitlement policy before treating it as proof of a paid subscription.
- Run the updated `supabase_admin_dashboard.sql` again to create `admin_user_feature_overrides`, `admin_audit_log`, and `account_login_devices`. It is safe to re-run the `CREATE TABLE IF NOT EXISTS` statements.
- A platform-wide disabled feature remains disabled for everyone; per-user overrides can further disable a feature for a specific user. Admins retain access.

## Email verification, sign-in alerts, and notifications
1. In Supabase Dashboard → Authentication → Providers → Email, enable email confirmations. For an OTP-style confirmation, edit the Supabase **Confirm signup** email template to display `{{ .Token }}` and use the email OTP verification flow configured for your project. Keep email confirmation enabled in production; the app's current signup screen relies on Supabase's confirmation behavior.
2. Configure a verified sender and bounce address in ZeptoMail, then add server-only environment variables to local `.env.local` and Vercel:
   - `ZEPTOMAIL_API_TOKEN=Zoho-enczapikey ...`
   - `ZEPTOMAIL_FROM_EMAIL=QASS <notifications@your-verified-domain.example>`
3. Password sign-ins are checked against a per-browser device token; a first-seen browser/device triggers a security email. This is a practical device-change alert, not a guarantee of physical-device identity (clearing browser storage creates a new token). OAuth sign-ins must also be wired through your auth callback to get the same alert.
4. Creating, editing, and cancelling scheduled posts sends a transactional email when the mail provider is configured. Email delivery is best-effort and does not undo a successful schedule action. Additional events (generation completion/failure, published/failed post callbacks, password/security changes) still need their own event hooks before claiming every notification is covered.
5. Keep email-provider credentials server-side. Do not add `ZEPTOMAIL_API_TOKEN` or the Supabase service role key to any `NEXT_PUBLIC_*` variable.

## Company-named n8n credentials
- Do not send user-entered API keys to browser-visible workflow payloads or log them. Current personal API settings use server-side encryption in Supabase; this release does **not** automatically create provider-specific n8n credential records.
- To provision credentials in n8n, first identify the exact n8n credential type and required credential fields for each supported provider (the field schema differs per provider). Configure the n8n API key and base URL on the server only, then create credentials named consistently, for example `QASS — <Company Name> — OpenAI` or `QASS — <Company Name> — Website Analysis`. Associate the credential ID with the matching project in server-side settings and configure the workflow node to select that credential ID. Never store an n8n API key in client code or expose credential secrets back to the user.
- If customers are expected to configure n8n themselves, provide a per-company setup checklist and the exact credential type, required fields, and workflow node mapping. Do not claim an API is connected until a server-side test succeeds.

## Recommended code map for review
- `app/admin/page.tsx`: admin dashboard, user plan and feature controls.
- `app/api/admin/overview/route.ts`: read-only platform overview.
- `app/api/admin/features/route.ts`: platform-wide feature flags.
- `app/api/admin/users/[id]/route.ts`: admin-only per-user plan and feature overrides.
- `lib/admin-auth.ts`: admin checks and feature enforcement.
- `app/api/security/login-alert/route.ts`: first-seen browser/device email alert.
- `lib/email-notifications.ts`: shared transactional email sender.
- `app/api/scheduling/posts/route.ts`: scheduled-post create/update/cancel email notifications.
- `supabase_admin_dashboard.sql`: admin flags, user overrides, audit trail, and login-device registry.


## Per-project API mode policy (admin)
In Admin → Users & projects → select a user, each project has an API mode policy selector:
- **User chooses**: the company can choose Use Our API (Sparrow) or Use My Own APIs in its own settings.
- **Our API (Sparrow)**: locks that project to the platform-managed API workflow.
- **Their own APIs**: locks that project to its own saved provider credentials.

The policy is persisted in `admin_project_api_policies` and enforced in the project settings save endpoint, generation route, and analysis route. If the policy table is unavailable, these routes fail closed instead of silently choosing another provider. This controls provider mode only; personal-provider analysis still requires a provider-specific analysis integration, and does not silently fall back to Sparrow. Run `supabase_admin_dashboard.sql` before testing.

## Company-named n8n API credentials (optional automatic provisioning)
When a user saves a new personal API key, QASS first stores it encrypted in `project_ai_settings`. If the n8n API is configured and the exact service/provider mapping exists, the server creates a company-named n8n credential such as `QASS — Acme-Co — aiModel — openai`. The credential ID and provisioning status are saved as metadata only; the raw API key is never sent back to the browser or written to application logs.

Configure these **server-only** variables in local `.env.local` and Vercel:
- `N8N_API_BASE_URL=https://your-n8n-host.example.com` (base URL, no `/api/v1` suffix)
- `N8N_API_KEY=...` (n8n API key with credential-management permission)
- `N8N_CREDENTIAL_TYPE_MAP={"aiModel:openai":"openAiApi","aiModel:anthropic":"anthropicApi"}` (JSON map from `serviceKey:provider` to the exact credential type accepted by your n8n instance)
- Optional `N8N_CREDENTIAL_FIELD_MAP={"aiModel:openai":"apiKey"}` (JSON map for credential data field names; defaults to `apiKey`)

**Important:** Provider credential types and field names vary by n8n version and node. Confirm the exact type and field schema in your n8n instance before enabling a mapping. Start with one test company and one provider. An `created` status means n8n accepted the credential; it does not mean your workflow node is already using it. The workflow must be manually configured to select the new credential ID or to resolve the project-to-credential mapping. This code intentionally does not edit or overwrite existing n8n workflows. Services without a mapping are marked `manual_required` and remain encrypted in Supabase; failures are surfaced as status metadata for the admin.

## Notification events
- Signup OTP: handled by Supabase Auth email confirmation/template configuration.
- New browser/device password sign-in: security alert route; browser token is a practical signal, not proof of physical-device identity.
- Scheduled post create/update/cancel: transactional email after the schedule operation.
- Generation terminal state (`completed`, `partial`, `failed`, `cancelled`): email when the History/job persistence API records a transition into a terminal state. This depends on the frontend calling `/api/jobs/persist` with the terminal status and on ZeptoMail being configured.
- Publishing success/failure and OAuth sign-in device alerts are not automatically covered unless the relevant publishing callback/auth callback is wired to send them. Do not advertise these as active until tested end to end.

Email configuration: `ZEPTOMAIL_API_TOKEN`, `ZEPTOMAIL_FROM_EMAIL`, `ZEPTOMAIL_FROM_NAME`, and `ZEPTOMAIL_BOUNCE_ADDRESS` must be server-only. Signup OTP is delivered by Supabase Auth; configure Supabase Auth SMTP to route through ZeptoMail if signup verification must also use ZeptoMail. The app notification sender uses the ZeptoMail Send Mail API token. Delivery is best-effort and never rolls back a successfully saved job or scheduled post.


## ZeptoMail provider
The shared notification sender calls the official ZeptoMail Send Email API (`https://api.zeptomail.com/v1.1/email`) using the `Zoho-enczapikey` authorization scheme. See the [ZeptoMail API guide](https://www.zoho.com/zeptomail/help/api-home.html). Keep all four `ZEPTOMAIL_*` variables server-side. Signup OTP is controlled by Supabase Auth; to send those messages through ZeptoMail, configure Supabase Auth custom SMTP using the SMTP credentials supplied in your ZeptoMail agent settings. The Send Mail API token is not necessarily the same as SMTP credentials.

## Important scope notes
- Global feature switches and per-user overrides are both available. A per-user override does not bypass a globally disabled feature.
- Plan changes update the existing `profiles.plan` value (`pro` for Premium); this is an administrative plan label and is not a billing/payment verification system.
- Company-named n8n credentials are provisioned only when the exact n8n credential type and field mapping are configured. A created credential must still be manually attached to the appropriate workflow node; the existing n8n workflow definitions are not edited.
- New-device detection is browser-token based, not proof of physical-device identity. Password sign-ins are wired to the alert route; OAuth callback coverage must be tested separately.
- Publishing success/failure alerts require the relevant provider/webhook callbacks to be connected. Do not treat the entire notification catalogue as live until each event is tested.
