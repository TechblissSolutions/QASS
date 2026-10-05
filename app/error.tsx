'use client';
import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);
  return <div className="center-page"><div className="work-card"><h1>Something went wrong</h1><p className="err">Sparrow could not load this page.</p><button className="btn btn-primary" onClick={() => reset()}>Try again</button></div></div>;
}
