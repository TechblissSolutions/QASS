# Admin theme alignment and verification status

The admin console uses the existing Sparrow/QASS monochrome visual language: white and off-white surfaces, black primary actions, fine neutral borders, and the same system/Inter font stack as the rest of the application. The previous high-contrast lime styling has been removed from the admin controls so it matches the current landing/dashboard styles.

The admin page's decorative glyphs and arrow characters were replaced with ASCII-safe labels to avoid mojibake in Windows environments that previously displayed sequences such as `â†`. The admin API-mode select uses a non-null string value for the user-controlled option.

## Required setup

1. Copy your own `.env.local` into the project root; it is intentionally not included in this ZIP.
2. Run `npm ci` on your machine and then `npm run build`.
3. Apply `supabase_admin_dashboard.sql` to a **test** Supabase project before testing feature flags, user overrides, or project API policies.
4. Test with an admin account and a regular account. Confirm that regular users cannot call `/api/admin/*` successfully.
5. Verify each feature gate at its actual API/route, not just in the UI.
6. Do not deploy until the build and end-to-end checks pass.

## Verification limitation

A production build could not be completed in this packaging environment because the Next.js executable was not available in the installed `node_modules`, and dependency installation timed out. This ZIP is not represented as production-verified. n8n credential provisioning still requires a valid n8n API key, provider-specific credential types, and mapping the generated credential IDs to the relevant existing workflow nodes. ZeptoMail delivery requires a rotated Send Mail token and verified sender; Supabase Auth email OTP delivery must be configured separately. No existing n8n workflow definitions were changed here.
