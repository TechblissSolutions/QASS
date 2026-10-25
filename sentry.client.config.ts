import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN || '';
const enabled = Boolean(dsn && dsn !== 'YOUR_DSN');

Sentry.init({
  dsn: enabled ? dsn : undefined,
  tracesSampleRate: 0.1,
  enabled,
});
