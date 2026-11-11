'use client';

import './pricing-pz.css';
import '@/components/nav-active.css';
import { useEffect, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import AuthScene from '@/components/fx/AuthScene';
import { getAccessToken } from '@/lib/auth';

// Real plans, copied from the previous pricing page. No invented prices: billing is not live yet.
const PLANS = [
  {
    key: 'starter', pill: 'FREE', name: 'Starter', big: 'Free', sub: '1 saved company',
    desc: 'For trying Sparrow with one company.', lead: 'Included:',
    items: ['1 saved company', 'Full initial content generation', 'Company analysis and Brand DNA', 'Studio and calendar workspace'],
  },
  {
    key: 'pro', pill: 'PRO', name: 'Pro', big: 'Coming soon', sub: 'Up to 5 saved companies', featured: true,
    desc: 'For teams creating and iterating content.', lead: 'Everything in Starter, plus:',
    items: ['Up to 5 saved companies', 'Regenerate and improve content', 'All current Sparrow features', 'Ready for future publishing integrations'],
  },
  {
    key: 'owner', pill: 'OWNER', name: 'Owner', big: 'By invitation', sub: 'Unlimited companies',
    desc: 'Full platform access with no limits.', lead: 'Includes:',
    items: ['Unlimited companies', 'Regeneration and all features', 'No paywall restrictions', 'Assigned by platform admin'],
  },
];

const Check = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 12.5l5 5L20 6.5" />
  </svg>
);

// Words slide up out of a mask, one after another (CSS only)
const Words = ({ text }: { text: string }) => (
  <>
    {text.split(' ').map((w, i) => (
      <span className="pz-w" aria-hidden="true" key={i}><span style={{ '--i': i } as CSSProperties}>{w}</span></span>
    ))}
  </>
);

const tilt = (e: PointerEvent<HTMLElement>) => {
  if (e.pointerType === 'touch') return;
  const c = e.currentTarget, r = c.getBoundingClientRect();
  c.style.setProperty('--tx', `${(((e.clientY - r.top) / r.height - 0.5) * -6).toFixed(1)}deg`);
  c.style.setProperty('--ty', `${(((e.clientX - r.left) / r.width - 0.5) * 8).toFixed(1)}deg`);
};
const untilt = (e: PointerEvent<HTMLElement>) => {
  e.currentTarget.style.removeProperty('--tx');
  e.currentTarget.style.removeProperty('--ty');
};

const goBack = () => {
  if (window.history.length > 1) window.history.back();
  else window.location.assign('/');
};

export default function Pricing() {
  const [authed, setAuthed] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try { if (await getAccessToken() && alive) setAuthed(true); } catch { /* signed out */ }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div className="pricing-page">
      <AuthScene />
      <div className="pz-wrap">
        <header className="pz-nav">
          <a href="/" className="pz-brand" aria-label="Sparrow home">Sparrow</a>
          <nav className="pz-links" aria-label="Main">
            <a href="/">Home</a>
            <a href="/pricing" aria-current="page">Pricing</a>
          </nav>
          <div className="pz-nav-actions">
            <button type="button" className="pz-back" onClick={goBack}>← Back</button>
            {!authed && <a className="pz-ghost" href="/login">Sign in</a>}
            <a className="pz-nav-btn" href={authed ? '/dashboard' : '/signup'}>{authed ? 'Open workspace' : 'Get started'}</a>
          </div>
        </header>

        <header className="pz-head">
          <div>
            <span className="pz-kicker">SPARROW PLANS</span>
            <h1 aria-label="Choose how you want to work."><Words text="Choose how you want to work." /></h1>
            <p>Start free. Upgrade when you need more companies and regeneration.</p>
          </div>
          <span className="pz-note"><b />Paid billing is coming soon</span>
        </header>

        <div className="pz-tray">
          {PLANS.map((p, i) => (
            <article key={p.key} className={`pz-card${p.featured ? ' is-featured' : ''}`}
              style={{ '--n': i } as CSSProperties} onPointerMove={tilt} onPointerLeave={untilt}>
              <div className="pz-top">
                <span className="pz-pill">{p.pill}</span>
                <div className="pz-big">{p.big}</div>
                <small>{p.sub}</small>
              </div>
              <h2>{p.name}</h2>
              <p className="pz-desc">{p.desc}</p>
              <div className="pz-list">
                <h3>{p.lead}</h3>
                <ul>
                  {p.items.map(it => <li key={it}><span className="pz-tick"><Check /></span>{it}</li>)}
                </ul>
              </div>
              {p.key === 'starter' && <a className="pz-btn" href="/signup">Start free</a>}
              {p.key === 'pro' && <button className="pz-btn pz-btn-off" disabled>Billing coming soon</button>}
              {p.key === 'owner' && <span className="pz-contact">Contact admin for access</span>}
            </article>
          ))}
        </div>

        <footer className="pz-foot">
          <span>SPARROW · CONTENT OPERATING SYSTEM · Powered by <a href="https://techbliss.in" target="_blank" rel="noopener noreferrer">TechBliss</a></span>
          <span><a href="/">Home</a><a href="/login">Sign in</a></span>
        </footer>
      </div>
    </div>
  );
}
