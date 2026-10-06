'use client';

import { useStore } from '@/lib/store';
import { normaliseUrl } from '@/lib/utils';
import StoreLoading from '@/components/StoreLoading';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

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
        <div><strong>Sparrow Studio</strong><small>{tile.platform} · ready to review</small></div>
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
  const [url, setUrl] = useState(s.url);
  const [error, setError] = useState('');

  if (!ready) return <StoreLoading />;

  const start = () => {
    const value = normaliseUrl(url.trim());
    if (!value) { setError('Enter a valid website, like yourcompany.com'); return; }
    setError('');
    set({ url: value });
    router.push('/analyse?new=1');
  };

  return (
    <div className="landing-v6">
      <header className="landing-v6-header">
        <a href="/" className="landing-v6-brand"><SparrowMark /><span>Sparrow</span></a>
        <div className="landing-v6-actions">
          <a href="/login" className="landing-v6-signin">Sign in</a>
          <a href="/signup" className="landing-v6-cta">Start for free <span>↗</span></a>
        </div>
      </header>

      <main>
        <section className="landing-v6-hero">
          <div className="landing-v6-copy">
            <div className="landing-v6-kicker">CONTENT OPERATING SYSTEM</div>
            <h1>TURN YOUR BRAND STORY INTO <em>CONTENT THAT MOVES.</em></h1>
            <p>Sparrow turns the real story behind a business into content your team can review, refine, and ship.</p>
            <div className="landing-v6-actions">
              <a href="/signup" className="landing-v6-primary">Start for free <span>↗</span></a>
              <a href="#workflow" className="landing-v6-workflow">See the workflow <span>↓</span></a>
            </div>
            <div className="landing-v6-source"><span /> Built around your source, not a blank prompt.</div>
          </div>

          <div className="landing-v6-flow" aria-label="Sparrow content flowing from source to social channels">
            {socialTiles.map((tile, index) => <SocialTile key={tile.platform} tile={tile} />)}
          </div>
        </section>

        <section className="landing-v6-white" id="workflow">
          <div className="landing-v6-white-inner">
            <div>
              <span>CONTENT OPERATING SYSTEM</span>
              <h2>Source first.<br /><em>Work that moves.</em></h2>
            </div>
            <div className="landing-v6-start">
              <p>Start with a company website. Sparrow keeps the brand context attached to every piece your team creates.</p>
              <div className="landing-v6-url">
                <input value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') start(); }} placeholder="yourcompany.com" aria-label="Company website" />
                <button onClick={start}>Build Brand DNA <span>↗</span></button>
              </div>
              {error && <small className="landing-v6-error">{error}</small>}
            </div>
          </div>
        </section>

        <section className="landing-v6-process">
          <div className="landing-v6-section-label">HOW IT WORKS</div>
          <h2>From website to<br /><em>ready-to-review content.</em></h2>
          <div className="landing-v6-process-grid">
            <article><span>01</span><h3>Build Brand DNA</h3><p>Sparrow reads your company website and turns the source material into a reusable brand context.</p></article>
            <article><span>02</span><h3>Generate the work</h3><p>Create social posts, website copy, ads, messages, blogs, and video briefs from the same source.</p></article>
            <article><span>03</span><h3>Review and schedule</h3><p>Open every piece in its workspace, refine the copy, copy what you need, and schedule the work on your calendar.</p></article>
          </div>
        </section>

        <section className="landing-v6-capabilities">
          <div className="landing-v6-capabilities-intro">
            <div className="landing-v6-section-label">ONE WORKSPACE</div>
            <h2>Everything your content team needs in one place.</h2>
            <p>Keep the company context, generated pieces, history, and schedule connected to the same workspace.</p>
          </div>
          <div className="landing-v6-capability-grid">
            <article><strong>Brand context</strong><p>Keep your company story, audience, tone, and visual direction attached to the workspace.</p></article>
            <article><strong>Multi-channel output</strong><p>Generate platform-ready work while keeping the core message consistent across channels.</p></article>
            <article><strong>Content history</strong><p>Return to earlier generations and keep your approved work organized by company.</p></article>
            <article><strong>Calendar planning</strong><p>Move selected pieces into a simple schedule so the next publishing step is clear.</p></article>
          </div>
        </section>

        <section className="landing-v6-final">
          <div>
            <div className="landing-v6-section-label">READY WHEN YOU ARE</div>
            <h2>Give Sparrow the source.<br /><em>Get a workspace full of work.</em></h2>
          </div>
          <a href="/signup" className="landing-v6-primary">Start for free <span>↗</span></a>
        </section>
      </main>

            <footer className="landing-v6-footer">
        <span>
          <SparrowMark /> Sparrow
          <span className="footer-powered-by">
            · Powered by{" "}
            <a
              href="https://techbliss.in"
              target="_blank"
              rel="noopener noreferrer"
            >
              TechBliss
            </a>
          </span>
        </span>

        <div>
          <a href="/pricing">Pricing</a>
          <a href="/login">Sign in</a>
        </div>
      </footer>
    </div>
  );
}
