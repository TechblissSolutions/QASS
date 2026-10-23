# CI/CD setup for QASS test build

## CI
`.github/workflows/ci.yml` runs on pushes to `main`/`develop` and pull requests to `main`. It runs `npm ci`, TypeScript typechecking, Jest tests, and a production build.

## Optional GitHub Actions deployment to Vercel
`.github/workflows/deploy.yml` deploys the `main` branch to Vercel production, or can be started manually from GitHub Actions. Before enabling it, add these GitHub Actions repository (or production environment) secrets:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

Also configure all required application environment variables in the Vercel project itself, including Supabase and n8n variables and `API_CREDENTIALS_ENCRYPTION_KEY`. Do not commit `.env.local`, API keys, or production secrets to Git.

If the repository is already connected to Vercel's built-in Git integration, you may prefer to use that deployment mechanism instead of the optional deployment workflow. Avoid enabling two production deployment paths unintentionally.

## Local validation
Use Node.js 22 or newer:

```powershell
npm ci
npx tsc --noEmit
npm test
npm run build
```

The workflow files are included, but their GitHub execution and a successful full production build have not been verified from this packaging environment. Actual n8n provider routing still needs the new workflow JSON.
