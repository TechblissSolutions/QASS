'use client';
import * as Sentry from '@sentry/nextjs';
import type { ReactNode } from 'react';

export default function SentryErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <Sentry.ErrorBoundary fallback={<div className="center-page"><div className="work-card"><h2>Something went wrong</h2><p className="err">Sparrow hit an unexpected error. Please refresh and try again.</p><button className="btn btn-primary" onClick={() => window.location.reload()}>Refresh</button></div></div>}>
      {children}
    </Sentry.ErrorBoundary>
  );
}
