# QASS Admin Dashboard — Fixes in this ZIP

## UI and build fixes
- Restored the admin page from a UTF-8 source file so arrows, em dashes, and other UI glyphs render correctly. If a local copy previously passed through Windows PowerShell `Get-Content`/`Set-Content`, replace it with this source instead of attempting another encoding conversion.
- Fixed the project API-mode dropdown value so React never receives `null` as its `value`.
- Fixed the user-choice option markup (`value="user"`).
- Fixed the n8n credential mapping parser's TypeScript type narrowing.
- Changed admin loading so overview/user metrics and feature flags load independently. If the feature-flags migration has not been run, the overview can still load and the feature API's migration error is displayed rather than blanking the whole dashboard.

## Required first-time setup
1. Keep a backup of your current project and `.env.local`. Do not put `.env.local` in the ZIP or Git.
2. In your test Supabase project, run `supabase_admin_dashboard.sql` from this project. It creates the feature flags, per-user overrides, audit log, login-device registry, and per-project API-mode policies.
3. Verify `SPARROW_OWNER_EMAILS` contains only trusted administrator email addresses.
4. Keep `SUPABASE_SERVICE_ROLE_KEY`, `N8N_API_KEY`, `ZEPTOMAIL_API_TOKEN`, and `API_CREDENTIALS_ENCRYPTION_KEY` server-side only.
5. Configure ZeptoMail's verified sender and bounce address; the mail sender expects `ZEPTOMAIL_API_TOKEN`, `ZEPTOMAIL_FROM_EMAIL`, `ZEPTOMAIL_FROM_NAME`, and `ZEPTOMAIL_BOUNCE_ADDRESS`. Supabase Auth signup OTP uses Supabase Auth email configuration/SMTP separately.
6. Test the build and application locally before creating a Git commit or Vercel Preview.

## Known integration boundaries
- Global flags and per-user overrides exist; individual feature enforcement is documented in `ADMIN_DASHBOARD_SETUP.md`. Do not assume every UI module is fully gated unless its route and action have been tested.
- Premium is stored as the existing profile plan value; it is not payment verification or a billing subscription system.
- n8n credential creation requires `N8N_API_BASE_URL`, `N8N_API_KEY`, and exact provider-specific `N8N_CREDENTIAL_TYPE_MAP` / optional field mappings. A created credential still must be manually attached to the appropriate workflow node. Existing n8n workflow definitions are not changed.
- Signup OTP depends on Supabase Auth configuration. ZeptoMail transactional notifications do not automatically replace Supabase Auth SMTP. OAuth device alerts and publishing outcome notifications require their respective callbacks to be wired and tested.

## Verification status
The source-level fixes above are applied. A clean production build was not verified in this packaging environment because dependency installation timed out. Run `npm ci` and `npm run build` in your local project and resolve any additional compiler errors before deployment.
