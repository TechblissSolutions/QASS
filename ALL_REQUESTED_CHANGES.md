# QASS consolidated admin and account-management release

This package consolidates the current QASS application with the admin/API-mode work and switches the shared transactional email sender to ZeptoMail. Existing n8n workflow definitions are not included or modified.

## Included in source
- Admin dashboard at `/admin` with platform overview, users/projects, global feature switches, user-level feature overrides, Free/Premium plan labels, per-project API mode policy, audit trail and admin-only APIs.
- Admin authorization enforced server-side; server-only Supabase service-role access.
- Per-project API mode: user choice, managed/platform API, or own APIs. Generation/analysis/settings routes check the admin policy and fail closed when policy cannot be verified.
- Existing generation request content configuration continues to pass requested platform content counts through `content_config` to n8n.
- Signup email OTP UI through Supabase Auth's `verifyOtp` flow. Configure Supabase email confirmation and SMTP separately.
- First-seen browser-token login alerts for password sign-ins.
- Shared ZeptoMail transactional sender for scheduling changes, generation terminal statuses, admin plan changes and per-user feature changes.
- Encrypted storage of personal API keys and optional company-named n8n credential provisioning when exact n8n credential type/field mappings are configured.
- Setup documentation and `.env.example`; no `.env.local` or live secrets included.

## Required external configuration
1. Run `supabase_admin_dashboard.sql` in a test Supabase project first.
2. Configure `SPARROW_OWNER_EMAILS`, Supabase service-role key, and `API_CREDENTIALS_ENCRYPTION_KEY` server-side.
3. Configure `ZEPTOMAIL_API_TOKEN`, `ZEPTOMAIL_FROM_EMAIL`, `ZEPTOMAIL_FROM_NAME`, and `ZEPTOMAIL_BOUNCE_ADDRESS` server-side. Use a verified sender/bounce address.
4. Configure Supabase Auth custom SMTP using the SMTP credentials shown by your ZeptoMail agent to deliver signup OTPs through ZeptoMail. The Send Mail API token is for the app's transactional email API and is not automatically the SMTP password.
5. For automatic n8n credential creation, configure `N8N_API_BASE_URL`, `N8N_API_KEY`, `N8N_CREDENTIAL_TYPE_MAP`, and (where needed) `N8N_CREDENTIAL_FIELD_MAP`. Verify each provider's credential type/fields in your n8n instance. Created credentials must be manually attached to the correct workflow nodes or mapped by a separately verified workflow integration.
6. Test on a separate branch, test Supabase project, and Vercel Preview before production deployment.

## Explicit boundaries / not claimed as complete
- A successful n8n credential creation does not itself connect the credential to workflow nodes. Existing n8n workflows remain unchanged by design.
- Publishing success/failure notifications and OAuth new-device alerts need their event/callback hooks connected and tested.
- Device recognition uses a browser token and is not definitive physical-device identification.
- Premium changes update `profiles.plan` (`pro` for Premium); this is not payment/billing verification.
- Global/per-user UI toggles are only fully enforced for the feature routes explicitly wired in `lib/admin-auth.ts`; remaining UI-only modules should be wired before treating every feature as fully enforced.
- Build and end-to-end integrations must be verified in the user's configured environment before production release.
