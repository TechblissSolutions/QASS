'use client';

import './site-nav.css';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getAccessToken } from '@/lib/auth';

/**
 * Floating top bar for pages that have no header of their own
 * (login, signup, not-found, maintenance, error). Same look as the landing and pricing pages.
 */
export default function SiteNav({ current }: { current?: 'login' | 'signup' }) {
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try { if (await getAccessToken() && alive) setAuthed(true); } catch { /* signed out */ }
    })();
    return () => { alive = false; };
  }, []);

  const goBack = () => {
    if (window.history.length > 1) window.history.back();
    else window.location.assign('/');
  };

  return (
    <header className="sn">
      <Link href="/" className="sn-brand" aria-label="Sparrow by TechBliss home">
        <span className="sn-mark" aria-hidden="true"><i /><i /><i /></span>
        <span>Sparrow <small>by TechBliss</small></span>
      </Link>
      <nav className="sn-links" aria-label="Main">
        <Link href="/">Home</Link>
        <Link href="/pricing">Pricing</Link>
      </nav>
      <div className="sn-actions">
        <button type="button" className="sn-back" onClick={goBack}>← Back</button>
        {authed ? (
          <Link href="/dashboard" className="sn-btn">Open workspace</Link>
        ) : current === 'login' ? (
          <Link href="/signup" className="sn-btn">Create account</Link>
        ) : current === 'signup' ? (
          <Link href="/login" className="sn-btn">Sign in</Link>
        ) : (
          <>
            <Link href="/login" className="sn-ghost">Sign in</Link>
            <Link href="/signup" className="sn-btn">Get started</Link>
          </>
        )}
      </div>
    </header>
  );
}
