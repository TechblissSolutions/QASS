'use client';

import './landing-hero.css';
import Link from 'next/link';
import SignalRevealText from '@/components/SignalRevealText';
import { useEffect, useRef, useState } from 'react';
import { getAccessToken } from '@/lib/auth';

const CHANNELS = ['LinkedIn', 'Instagram', 'YouTube', 'Facebook'];

type Fan = { key: string; label: string; status: string; text: string; rot: number; i: number; dl: number; kind: 'brand' | 'li' | 'ig' | 'yt' | 'fb' };
const FAN: Fan[] = [
  { key: 'brand', label: 'Brand workspace', status: 'Example', text: 'Acme Studio', rot: -22, i: -2, dl: 380, kind: 'brand' },
  { key: 'li', label: 'LinkedIn', status: 'Draft', text: 'How we turned one website into a month of posts.', rot: -11, i: -1, dl: 260, kind: 'li' },
  { key: 'ig', label: 'Instagram', status: 'Scheduled · Tue 10:30', text: 'New week, new launch. Here is what is coming.', rot: 0, i: 0, dl: 140, kind: 'ig' },
  { key: 'yt', label: 'YouTube', status: 'Script ready', text: 'A 60-second intro to the company.', rot: 11, i: 1, dl: 260, kind: 'yt' },
  { key: 'fb', label: 'Facebook', status: 'Ready', text: 'Meet the team behind the product.', rot: 22, i: 2, dl: 380, kind: 'fb' },
];

const STEPS = [
  { n: '01', t: 'Add the company website', d: 'Paste a URL. Sparrow reads the site and learns the company, its offer and its voice.' },
  { n: '02', t: 'Get a brand workspace', d: 'Logo and colours are detected, and every company keeps its own brand system.' },
  { n: '03', t: 'Generate, edit, schedule', d: 'Pick channels, goal and tone. Review each post, create visuals, then schedule it.' },
];

export default function LandingPage() {
  const [authed, setAuthed] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  // Signed-in visitors get a direct way back into the workspace
  useEffect(() => {
    let alive = true;
    void (async () => {
      try { if (await getAccessToken() && alive) setAuthed(true); } catch { /* signed out */ }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

    // scroll reveal
    const items = Array.from(el.querySelectorAll<HTMLElement>('[data-sp-reveal], [data-sp-fan]'));
    if (reduce || !('IntersectionObserver' in window)) items.forEach(i => i.classList.add('is-in'));
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }), { threshold: 0.15 });
    if (!reduce) items.forEach(i => io.observe(i));

    // 3D stage follows the pointer; step cards tilt toward it
    const stage = el.querySelector<HTMLElement>('.sp-stage');
    const onStage = (e: PointerEvent) => {
      if (!stage || e.pointerType === 'touch') return;
      const r = stage.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      stage.style.setProperty('--ry', `${(-14 + x * 22).toFixed(1)}deg`);
      stage.style.setProperty('--rx', `${(8 - y * 18).toFixed(1)}deg`);
    };
    const onStageLeave = () => { stage?.style.removeProperty('--ry'); stage?.style.removeProperty('--rx'); };
    const onTilt = (e: PointerEvent) => {
      const c = (e.target as Element).closest<HTMLElement>('.sp-step');
      if (!c || e.pointerType === 'touch') return;
      const r = c.getBoundingClientRect();
      c.style.setProperty('--tx', `${(((e.clientY - r.top) / r.height - 0.5) * -8).toFixed(1)}deg`);
      c.style.setProperty('--ty', `${(((e.clientX - r.left) / r.width - 0.5) * 10).toFixed(1)}deg`);
    };
    const onTiltLeave = (e: PointerEvent) => {
      const c = (e.target as Element).closest<HTMLElement>('.sp-step');
      c?.style.removeProperty('--tx'); c?.style.removeProperty('--ty');
    };
    if (fine && !reduce) {
      stage?.addEventListener('pointermove', onStage);
      stage?.addEventListener('pointerleave', onStageLeave);
      el.addEventListener('pointermove', onTilt);
      el.addEventListener('pointerout', onTiltLeave);
    }
    return () => {
      io.disconnect();
      stage?.removeEventListener('pointermove', onStage);
      stage?.removeEventListener('pointerleave', onStageLeave);
      el.removeEventListener('pointermove', onTilt);
      el.removeEventListener('pointerout', onTiltLeave);
    };
  }, []);

  const cta = authed ? { href: '/dashboard', label: 'Open workspace' } : { href: '/signup', label: 'Get started' };

  return (
    <div className="sp-landing" ref={root}>
      <div className="sp-glow sp-glow-a" aria-hidden="true" />
      <div className="sp-glow sp-glow-b" aria-hidden="true" />
      <div className="sp-glow sp-glow-c" aria-hidden="true" />

      <header className="sp-nav">
        <Link href="/" className="sp-brand" aria-label="Sparrow by TechBliss home">
          <span className="sp-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>Sparrow <small>by TechBliss</small></span>
        </Link>
        <nav className="sp-links" aria-label="Main">
          <a href="#how">How it works</a>
          <a href="#channels">Channels</a>
          <Link href="/pricing">Pricing</Link>
        </nav>
        <div className="sp-nav-actions">
          {!authed && <Link href="/login" className="sp-ghost">Sign in</Link>}
          <Link href={cta.href} className="sp-btn sp-btn-sm">{cta.label}</Link>
        </div>
      </header>

      <main>
        <section className="sp-hero">
          <div className="sp-copy">
            <span className="sp-kicker sp-rise" style={{ '--d': '0ms' } as React.CSSProperties}><b />CONTENT OPERATING SYSTEM</span>
            <h1>
              <SignalRevealText as="span" text="Content for every company." delay={120} />
              <br />
              <span className="sp-line-em sp-rise" style={{ '--d': '480ms' } as React.CSSProperties}><em>One workspace.</em></span>
            </h1>
            <p className="sp-rise" style={{ '--d': '560ms' } as React.CSSProperties}>
              Paste a company website. Sparrow learns the brand, then writes on-brand posts, creates visuals and
              schedules them for every channel.
            </p>
            <div className="sp-actions sp-rise" style={{ '--d': '660ms' } as React.CSSProperties}>
              <Link href={cta.href} className="sp-btn">{cta.label} <span aria-hidden="true">→</span></Link>
              <a href="#how" className="sp-btn sp-btn-line">See how it works</a>
            </div>
            <div className="sp-chips sp-rise" style={{ '--d': '760ms' } as React.CSSProperties} aria-label="Channels">
              {CHANNELS.map(c => <span key={c}>{c}</span>)}
            </div>
          </div>

          <div className="sp-stage" aria-hidden="true">
            <div className="sp-scene">
              <div className="sp-disc" />
              <div className="sp-card sp-card-brand">
                <div className="sp-logo">AC</div>
                <div><strong>Acme Studio</strong><small>Brand workspace · example</small></div>
                <div className="sp-swatches"><i /><i /><i /></div>
              </div>
              <div className="sp-card sp-card-post">
                <div className="sp-post-head"><span className="sp-dot" /><strong>Instagram</strong><small>Draft</small></div>
                <div className="sp-post-art" />
                <p>Behind every launch is a team that cares. Meet the people shaping what&apos;s next.</p>
                <div className="sp-bars"><i /><i /><i /></div>
              </div>
              <div className="sp-card sp-card-chip sp-chip-a">Scheduled · Tue 10:30</div>
              <div className="sp-card sp-card-chip sp-chip-b">On-brand ✓</div>
            </div>
          </div>
        </section>

        <section className="sp-fan-sec" aria-label="Example posts">
          <span className="sp-kicker" data-sp-reveal><b />ONE WEBSITE, EVERY CHANNEL</span>
          <SignalRevealText as="h2" text="On-brand posts for every channel." trigger="view" />
          <p data-sp-reveal>Example posts, generated from a company website.</p>
          <div className="sp-fan" data-sp-fan>
            {FAN.map(f => (
              <article key={f.key} className={`sp-fcard sp-f-${f.kind}`}
                style={{ '--r': `${f.rot}deg`, '--i': f.i, '--dl': `${f.dl}ms` } as React.CSSProperties}>
                <header><strong>{f.label}</strong><small>{f.status}</small></header>
                <div className="sp-fart">
                  {f.kind === 'yt' && <span className="sp-play" />}
                  {f.kind === 'brand' && <span className="sp-fsw"><i /><i /><i /><i /></span>}
                </div>
                <p>{f.text}</p>
                <div className="sp-bars"><i /><i /><i /></div>
              </article>
            ))}
          </div>
        </section>

        <section className="sp-marquee" id="channels" aria-label="Channels Sparrow writes for">
          <p>Writes and schedules for</p>
          <div className="sp-track">
            {[0, 1].map(k => (
              <div key={k} className="sp-row" aria-hidden={k === 1}>
                {[...CHANNELS, ...CHANNELS].map((c, i) => <span key={`${k}-${i}`}>{c}</span>)}
              </div>
            ))}
          </div>
        </section>

        <section className="sp-steps" id="how">
          <div className="sp-head" data-sp-reveal>
            <span className="sp-kicker"><b />HOW IT WORKS</span>
            <SignalRevealText as="h2" text="From a website to a content calendar." trigger="view" />
          </div>
          <div className="sp-step-grid">
            {STEPS.map((s, i) => (
              <article key={s.n} className="sp-step" data-sp-reveal style={{ '--i': i } as React.CSSProperties}>
                <span className="sp-num">{s.n}</span>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="sp-final" data-sp-reveal>
          <SignalRevealText as="h2" text="Ready to build your first workspace?" trigger="view" />
          <p>Add a company website and let Sparrow do the first draft.</p>
          <Link href={cta.href} className="sp-btn">{cta.label} <span aria-hidden="true">→</span></Link>
        </section>
      </main>

      <footer className="sp-foot">
        <span>SPARROW · CONTENT OPERATING SYSTEM · Powered by <a href="https://techbliss.in" target="_blank" rel="noopener noreferrer">TechBliss</a></span>
        <span><Link href="/pricing">Pricing</Link> <Link href="/login">Sign in</Link></span>
      </footer>
    </div>
  );
}
