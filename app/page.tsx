'use client';

import { useStore } from '@/lib/store';
import { normaliseUrl } from '@/lib/utils';
import StoreLoading from '@/components/StoreLoading';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const socialTiles = [
  { platform: 'Instagram', mark: '◎', image: '/social-instagram-brand-dna.svg', eyebrow: 'BRAND DNA → VISUAL', title: 'Make the point of view visible.' },
  { platform: 'LinkedIn', mark: 'in', image: '/social-linkedin-brief.svg', eyebrow: 'SOURCE → SIGNAL', title: 'A clearer brief makes better work.' },
  { platform: 'YouTube', mark: '▶', image: '/social-youtube-story.svg', eyebrow: 'BRIEF → STORY', title: 'From source to story.' },
] as const;

function SparrowMark() {
  return <span className="landing-mark" aria-hidden="true"><i /><i /><i /></span>;
}

function SocialTile({ tile }: { tile: typeof socialTiles[number] }) {
  return (
    <article className={`landing-social-card landing-${tile.platform.toLowerCase()}`}>
      <div className="landing-social-top">
        <span className="landing-social-mark">{tile.mark}</span>
        <div><strong>Sparrow Studio</strong><small>{tile.platform} · sample preview</small></div>
        <span className="landing-social-menu">•••</span>
      </div>
      <div className="landing-social-art">
        <img src={tile.image} alt="" />
        <span>{tile.eyebrow}</span>
      </div>
      <div className="landing-social-title">{tile.title}</div>
    </article>
  );
}

export default function HomePage() {
  const { s, set, ready } = useStore();
  const router = useRouter();
  const pageRef = useRef<HTMLElement>(null);
  const [url, setUrl] = useState(s.url);
  const [error, setError] = useState('');

  useEffect(() => {
    const root = pageRef.current;
    if (!root) return;

    const sections = root.querySelectorAll(':scope > section:not(.landing-v6-hero)');
    const motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let observer: IntersectionObserver | null = null;
    const revealAll = () => sections.forEach(section => section.setAttribute('data-reveal', 'visible'));

    if (!motionPreference || motionPreference.matches || !('IntersectionObserver' in window)) {
      revealAll();
    } else {
      observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.setAttribute('data-reveal', 'visible');
            observer?.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -5% 0px' });

      sections.forEach(section => {
        section.setAttribute('data-reveal', 'pending');
        observer?.observe(section);
      });
    }

    const handleMotionPreference = (event: MediaQueryListEvent) => {
      if (event.matches) revealAll();
    };
    motionPreference?.addEventListener('change', handleMotionPreference);
    return () => {
      observer?.disconnect();
      motionPreference?.removeEventListener('change', handleMotionPreference);
    };
  }, [ready]);

  if (!ready) return <StoreLoading />;

  const start = () => {
    const value = normaliseUrl(url.trim());
    if (!value) { setError('Enter a valid website, like yourcompany.com'); return; }
    setError('');
    set({ url: value });
    router.push(`/analyse?new=1&url=${encodeURIComponent(value)}`);
  };

  return (
    <div className="landing-v6">
      <header className="landing-v6-header">
        <a href="/" className="landing-v6-brand"><SparrowMark /><span>Sparrow by TechBliss</span></a>
        <div className="landing-v6-actions">
          <a href="/login" className="landing-v6-signin">Sign in</a>
          <a href="/signup" className="landing-v6-cta">Start for free <span>↗</span></a>
        </div>
      </header>

      <main ref={pageRef}>
        <section className="landing-v6-hero">
          <div className="landing-v6-copy">
            <h1>CREATE <span>ON-BRAND</span> CONTENT <em>FROM A COMPANY WEBSITE.</em></h1>
            <p>Sparrow by TechBliss uses your company’s website to build brand context for marketing content your team can review and refine.</p>
            <div className="landing-v6-actions">
              <a href="/signup" className="landing-v6-primary">Start for free <span>↗</span></a>
              <a href="#workflow" className="landing-v6-workflow">See the workflow <span>↓</span></a>
            </div>
            <div className="landing-v6-source"><span /> Your company’s website guides the work.</div>
          </div>

          <div
            className="landing-v6-flow"
            role="img"
            aria-label="Illustrative product preview showing company research, brand context, sample marketing content, and calendar planning"
          >
            <div className="landing-v6-preview-label">
              <span>ILLUSTRATIVE WORKFLOW</span>
              <span>WEBSITE TO PLAN</span>
            </div>
            <div className="landing-v6-telemetry" aria-hidden="true">
              <svg viewBox="0 0 620 660" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="signal-gradient" x1="0" x2="1" y1="1" y2="0">
                    <stop offset="0" stopColor="#ff4b13" />
                    <stop offset="1" stopColor="#c8f169" />
                  </linearGradient>
                </defs>
                <ellipse className="landing-v6-orbit" cx="310" cy="330" rx="260" ry="184" />
                <ellipse className="landing-v6-orbit landing-v6-orbit-inner" cx="310" cy="330" rx="226" ry="154" />
                <path className="landing-v6-signal-path" d="M18 520C146 488 144 347 230 301S365 241 403 316s96 128 198 26" />
                <circle className="landing-v6-signal-node" cx="18" cy="520" r="4" />
                <circle className="landing-v6-signal-node landing-v6-signal-node-end" cx="601" cy="342" r="4" />
              </svg>
              <span className="landing-v6-engine-status">SAMPLE FLOW <b>01—04</b></span>
              <span className="landing-v6-engine-label landing-v6-engine-label-source">RESEARCH → BRAND CONTEXT</span>
              <span className="landing-v6-engine-label landing-v6-engine-label-channels">CONTENT → PLANNING</span>
            </div>
            <article className="landing-v6-stage-card landing-v6-research">
              <div className="landing-v6-browser-bar">
                <span><i /><i /><i /></span>
                <small>samplecompany.com</small>
              </div>
              <div className="landing-v6-stage-copy">
                <span className="landing-v6-stage-kicker">01 / COMPANY RESEARCH</span>
                <strong>Built around thoughtful everyday care.</strong>
                <div className="landing-v6-research-lines" aria-hidden="true"><i /><i /><i /></div>
                <small>Website details become useful context.</small>
              </div>
            </article>
            <article className="landing-v6-stage-card landing-v6-brand-context">
              <div className="landing-v6-context-head">
                <span className="landing-v6-context-monogram">S</span>
                <span><small>02 / BRAND CONTEXT</small><strong>Sample Company</strong></span>
              </div>
              <p>Clear, considered, human.</p>
              <div className="landing-v6-context-tags"><span>Audience</span><span>Voice</span><span>Point of view</span></div>
            </article>
            <div className="landing-v6-content-stack">
              <span className="landing-v6-stack-label">03 / CONTENT FOR REVIEW</span>
              {socialTiles.map(tile => <SocialTile key={tile.platform} tile={tile} />)}
            </div>
            <article className="landing-v6-stage-card landing-v6-planner">
              <div className="landing-v6-planner-head"><span><i />04 / CONTENT PLAN</span><small>Sample week</small></div>
              <div className="landing-v6-planner-days" aria-hidden="true">
                <span><small>MON</small><i>Brand story</i></span>
                <span><small>WED</small><i>Product note</i></span>
                <span><small>FRI</small><i>Team voice</i></span>
              </div>
              <small className="landing-v6-planner-note">Illustrative preview · not a live schedule</small>
            </article>
          </div>
        </section>

        <section className="landing-v6-white" id="workflow">
          <div className="landing-v6-white-inner">
            <div>
              <h2>Build reusable<br /><em>brand context.</em></h2>
            </div>
            <div className="landing-v6-start">
              <p>Enter a company website to create brand context you can reuse when making content.</p>
              <div className="landing-v6-url">
                <input id="company-website" value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') start(); }} placeholder="yourcompany.com" aria-label="Company website" aria-invalid={Boolean(error)} aria-describedby={error ? 'company-website-error' : undefined} />
                <button type="button" onClick={start}>Analyze website <span>↗</span></button>
              </div>
              {error && <small className="landing-v6-error" id="company-website-error" role="alert">{error}</small>}
            </div>
          </div>
        </section>

        <section className="landing-v6-process">
          <h2>From a company website<br /><em>to content for review.</em></h2>
          <div className="landing-v6-process-grid">
            <article><span>01</span><h3>Analyze a company website</h3><p>Sparrow reads the site to build reusable brand context for content creation.</p></article>
            <article><span>02</span><h3>Create marketing content</h3><p>Generate social posts, website copy, ads, messages, blogs, and video briefs from that context.</p></article>
            <article><span>03</span><h3>Review and schedule</h3><p>Open each piece in its workspace, refine it, and schedule posts from your calendar.</p></article>
          </div>
        </section>

        <section className="landing-v6-capabilities">
          <div className="landing-v6-capabilities-intro">
            <h2>Keep brand context, content, and planning together.</h2>
            <p>Each company’s brand context, generated content, history, and schedule stay in its workspace.</p>
          </div>
          <div className="landing-v6-capability-grid">
            <article><strong>Brand context</strong><p>Keep your company story, audience, tone, and visual direction attached to the workspace.</p></article>
            <article><strong>Multi-channel output</strong><p>Generate platform-ready work while keeping the core message consistent across channels.</p></article>
            <article><strong>Content history</strong><p>Find earlier generations in the same company workspace.</p></article>
            <article><strong>Calendar planning</strong><p>Move selected pieces to your calendar to plan when to publish.</p></article>
          </div>
        </section>

        <section className="landing-v6-final">
          <div>
            <h2>Start with a company website.<br /><em>Create content from its story.</em></h2>
          </div>
          <a href="/signup" className="landing-v6-primary">Start for free <span>↗</span></a>
        </section>
      </main>

            <footer className="landing-v6-footer">
        <span>
          <SparrowMark /> Sparrow by{" "}
          <a
            href="https://techbliss.in"
            target="_blank"
            rel="noopener noreferrer"
          >
            TechBliss
          </a>
        </span>

        <div>
          <a href="/pricing">Pricing</a>
          <a href="/login">Sign in</a>
        </div>
      </footer>
    </div>
  );
}
