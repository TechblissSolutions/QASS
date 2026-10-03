'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, []);
  return (
    <html lang="en">
      <body>
        <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
          <section style={{ maxWidth: 560, textAlign: 'center' }}>
            <h1>Something went wrong</h1>
            <p>Sparrow hit an unexpected error. Your saved work is stored separately and should be safe.</p>
            <button onClick={() => reset()} style={{ padding: '10px 16px', cursor: 'pointer' }}>Try again</button>
          </section>
        </main>
      </body>
    </html>
  );
}
