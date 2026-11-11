'use client';

import './tunnel-loader.css';
import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import SignalRevealText from '@/components/SignalRevealText';

/**
 * Full-screen loading scene: example post cards fly toward you through a 3D tunnel.
 * Plain CSS 3D (transform and opacity only), no libraries. It plays by itself while something loads.
 *  - delay: ms to wait before showing, so very quick loads never flash it
 *  - it is drawn on document.body, above the header and sidebar
 */
// When one loader takes over from another (sign-in -> dashboard, route fallback -> page)
// it should carry on, not fade out and restart. This remembers when a loader was last on
// screen; a loader that mounts within HANDOFF_MS of that appears at once.
let lastShownAt = 0;
// When the current run of loaders first appeared; the minimum display time counts from here.
let chainStart = 0;
// The cards dealt for the current run, kept so a handoff between loaders shows the same cards.
let lastDeck: Post[] | null = null;
const HANDOFF_MS = 4000;

/**
 * Keeps the tunnel on screen for at least `minMs` (counted from when it first appeared),
 * however quickly the data arrives, then lets it zoom out for `leaveMs` while the page
 * appears underneath.
 *   'loading' -> show the loader only
 *   'leaving' -> show the page AND the loader with `leaving`
 *   'done'    -> show the page only
 */
export function useTunnelPhase(active: boolean, minMs = 3500, leaveMs = 1100): 'loading' | 'leaving' | 'done' {
  const [held, setHeld] = useState(false);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const total = calm ? Math.min(minMs, 1200) : minMs;
    const wait = Math.max(0, chainStart + total - Date.now());
    const t = window.setTimeout(() => setHeld(true), wait);
    return () => window.clearTimeout(t);
  }, [minMs]);
  const ready = held && !active;
  useEffect(() => {
    if (!ready) return;
    const t = window.setTimeout(() => setGone(true), leaveMs);
    return () => window.clearTimeout(t);
  }, [ready, leaveMs]);
  return !ready ? 'loading' : gone ? 'done' : 'leaving';
}


// fixed positions (golden angle), so server and browser always agree
const CARDS = Array.from({ length: 12 }, (_, i) => {
  const a = (i * 137.5 * Math.PI) / 180;
  return {
    i,
    cx: +Math.cos(a).toFixed(3),
    sy: +Math.sin(a).toFixed(3),
    rx: +(0.28 + (i % 3) * 0.08).toFixed(2),
    ry: +(0.26 + (i % 2) * 0.09).toFixed(2),
    rot: (i % 2 === 0 ? 1 : -1) * (3 + (i % 5) * 2),
  };
});


// ── tiny inline icons for the mock posts (no icon library needed) ─────────
const Ico = ({ children, fill = false }: { children: ReactNode; fill?: boolean }) => (
  <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"
    fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const HeartIco = () => <Ico fill><path d="M12 21s-7.6-4.7-9.7-9.3C.9 8.5 2.6 5.4 5.7 5.4c1.9 0 3.4 1 4.3 2.5h0c.9-1.5 2.4-2.5 4.3-2.5 3.1 0 4.800 3.100 3.400 6.300C19.600 16.300 12 21 12 21z" /></Ico>;
const CommentIco = () => <Ico><path d="M4 5.500h16v11H10l-5 4v-4H4z" /></Ico>;
const SendIco = () => <Ico><path d="M21 3 10 14M21 3l-7 18-4-7-7-4z" /></Ico>;
const PlayIco = () => <Ico fill><path d="M8 5v14l11-7z" /></Ico>;
const LikeIco = () => <Ico><path d="M7 10v10H3V10zM7 10l4-7c1.700 0 2.700 1.200 2.300 2.800L12.600 9H19c1.300 0 2.200 1.100 2 2.300l-1.300 7c-.2 1-1 1.700-2 1.700H7" /></Ico>;
const RepostIco = () => <Ico><path d="M4 11V8a3 3 0 0 1 3-3h10l-3-3M20 13v3a3 3 0 0 1-3 3H7l3 3" /></Ico>;

type IgPost = { kind: 'ig'; user: string; caption: string; likes: string; comments: string };
type LiPost = { kind: 'li'; name: string; role: string; text: string; reactions: string };
type YtPost = { kind: 'yt'; title: string; channel: string; views: string; ago: string; length: string };
type FbPost = { kind: 'fb'; page: string; when: string; text: string; reactions: string };
type Post = (IgPost | LiPost | YtPost | FbPost) & { art: number };

// Premade content. Every time the tunnel starts, the 12 cards are dealt from these at random.
const IG: Omit<IgPost, 'kind'>[] = [
  { user: 'sparrow.studio', caption: 'Behind the scenes of our new launch #contentcreator', likes: '12.4K', comments: '238' },
  { user: 'fitwithmaya', caption: '5-minute morning mobility routine you can do anywhere', likes: '48.1K', comments: '1.2K' },
  { user: 'urban.brews', caption: 'How we pour the perfect flat white at home', likes: '9.8K', comments: '164' },
  { user: 'travelwithravi', caption: 'Hidden beaches in Goa you need to visit this year', likes: '76K', comments: '2.9K' },
  { user: 'cooking.with.anu', caption: '10-minute paneer wrap, no oven needed', likes: '31.5K', comments: '870' },
  { user: 'studio.neon', caption: 'Our desk setup tour for creators #workspace', likes: '22.7K', comments: '540' },
];
const LI: Omit<LiPost, 'kind'>[] = [
  { name: 'Aarav Mehta', role: 'Head of Growth · 2h · Public', text: 'Proud to share that our team just crossed 1M content views this quarter.', reactions: '248 · 32 comments' },
  { name: 'Priya Nair', role: 'Founder at BrightLeaf · 5h', text: 'Three lessons I learned after hiring my first ten employees.', reactions: '1.1K · 94 comments' },
  { name: 'Rohan Kapoor', role: 'Marketing Director · 1d', text: 'We rebuilt our onboarding and cut churn by 18% in six weeks.', reactions: '673 · 51 comments' },
  { name: 'Sneha Iyer', role: 'Product Designer · 3h', text: 'Good design is invisible. Here is what that looks like in practice.', reactions: '392 · 27 comments' },
  { name: 'Karan Shah', role: 'CEO, Nimbus Labs · 8h', text: 'We just opened a new office in Pune and are hiring across five roles.', reactions: '2.4K · 160 comments' },
  { name: 'Meera Joshi', role: 'Talent Partner · 12h', text: 'Resume tips that actually get replies from recruiters.', reactions: '845 · 73 comments' },
];
const YT: Omit<YtPost, 'kind'>[] = [
  { title: 'How we plan a month of content in one hour', channel: 'Sparrow Studio', views: '12K views', ago: '3 days ago', length: '8:24' },
  { title: 'Build a SaaS landing page from scratch', channel: 'Code Canvas', views: '184K views', ago: '2 weeks ago', length: '24:10' },
  { title: 'Street food tour: 12 dishes under Rs 100', channel: 'Foodie Frames', views: '1.2M views', ago: '1 month ago', length: '15:42' },
  { title: 'Morning routine of a freelance designer', channel: 'Pixel & Pen', views: '67K views', ago: '5 days ago', length: '11:03' },
  { title: 'Why every brand needs a content calendar', channel: 'Growth Lab', views: '41K views', ago: '1 week ago', length: '6:47' },
  { title: 'Phone camera test in low light', channel: 'TechBurst', views: '530K views', ago: '4 days ago', length: '13:28' },
];
const FB: Omit<FbPost, 'kind'>[] = [
  { page: 'Sparrow Studio', when: 'Just now · Public', text: 'Our weekend sale starts now. Tap to see what is new this season.', reactions: '1.2K · 86 comments' },
  { page: 'Green Basket Market', when: '2h · Public', text: 'Fresh mangoes just arrived at all our stores. Come pick yours today.', reactions: '640 · 48 comments' },
  { page: "Riya's Bakery", when: '4h · Public', text: 'Warm cinnamon rolls out of the oven. First 20 customers get a free coffee.', reactions: '2.1K · 130 comments' },
  { page: 'City Fitness Club', when: '1d · Public', text: 'Join our 30-day challenge and win a free annual membership.', reactions: '980 · 72 comments' },
  { page: 'Wanderlust Travels', when: '3h · Public', text: 'Early bird offer: Kerala backwater trips from Rs 7,999 per person.', reactions: '1.7K · 109 comments' },
  { page: 'Little Learners Academy', when: '6h · Public', text: 'Admissions are now open for the new academic year. Book a campus visit.', reactions: '410 · 35 comments' },
];

const shuffle = <T,>(list: T[]): T[] => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

// Deals a fresh, random set of cards: which platform sits where, whose post it is, and its picture.
const ART_COUNT = 6;
function makeDeck(count: number): Post[] {
  const kinds = shuffle(Array.from({ length: count }, (_, i) => (['ig', 'li', 'yt', 'fb'] as const)[i % 4]));
  const pools = { ig: shuffle(IG), li: shuffle(LI), yt: shuffle(YT), fb: shuffle(FB) };
  const used = { ig: 0, li: 0, yt: 0, fb: 0 };
  let lastArt = -1;
  return kinds.map((kind) => {
    const pool = pools[kind];
    const item = pool[used[kind]++ % pool.length];
    let art = Math.floor(Math.random() * ART_COUNT);
    if (art === lastArt) art = (art + 1) % ART_COUNT;
    lastArt = art;
    return { kind, art, ...item } as Post;
  });
}

function MiniPost({ post }: { post: Post }) {
  const art = post.art;
  if (post.kind === 'ig') {
    return (
      <div className={`tl-ig tl-art tl-a${art}`}>
        <div className="tl-ig-top"><span>Reels</span><i className="tl-cam" /></div>
        <div className="tl-ig-side">
          <span><HeartIco /><b>{post.likes}</b></span>
          <span><CommentIco /><b>{post.comments}</b></span>
          <span><SendIco /><b>Share</b></span>
        </div>
        <div className="tl-ig-bottom">
          <div className="tl-ig-user"><i className="tl-av" /><strong>{post.user}</strong><em>Follow</em></div>
          <p>{post.caption}</p>
          <small>♪ Original audio · {post.user}</small>
        </div>
      </div>
    );
  }
  if (post.kind === 'li') {
    return (
      <div className="tl-post">
        <div className="tl-p-head"><i className="tl-av tl-av-li" /><div><strong>{post.name}</strong><small>{post.role}</small></div></div>
        <p className="tl-p-text">{post.text}</p>
        <div className={`tl-p-img tl-art tl-flat tl-a${art}`}><span className="tl-chart"><i /><i /><i /><i /><i /></span></div>
        <div className="tl-p-react"><span className="tl-dots tl-dots-li"><i /><i /></span>{post.reactions}</div>
        <div className="tl-p-actions"><span><LikeIco /><b>Like</b></span><span><CommentIco /><b>Comment</b></span><span><RepostIco /><b>Repost</b></span><span><SendIco /><b>Send</b></span></div>
      </div>
    );
  }
  if (post.kind === 'yt') {
    return (
      <div className="tl-yt">
        <div className={`tl-yt-thumb tl-art tl-a${art}`}><span className="tl-yt-play"><PlayIco /></span><em>{post.length}</em></div>
        <div className="tl-yt-meta"><i className="tl-av tl-av-yt" /><div><strong>{post.title}</strong><small>{post.channel} · {post.views} · {post.ago}</small></div></div>
      </div>
    );
  }
  return (
    <div className="tl-post">
      <div className="tl-p-head"><i className="tl-av tl-av-fb" /><div><strong>{post.page}</strong><small>{post.when}</small></div></div>
      <p className="tl-p-text">{post.text}</p>
      <div className={`tl-p-img tl-art tl-a${art}`} />
      <div className="tl-p-react"><span className="tl-dots tl-dots-fb"><i /><i /></span>{post.reactions}</div>
      <div className="tl-p-actions"><span><LikeIco /><b>Like</b></span><span><CommentIco /><b>Comment</b></span><span><SendIco /><b>Share</b></span></div>
    </div>
  );
}

export default function TunnelLoader({ title = 'Loading your companies', delay = 200, leaving = false }: { title?: string; delay?: number; leaving?: boolean }) {
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);
  const [instant, setInstant] = useState(false);
  const [deck, setDeck] = useState<Post[] | null>(null);
  const shownRef = useRef(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    const handoff = lastShownAt > 0 && Date.now() - lastShownAt < HANDOFF_MS;
    if (!handoff) chainStart = Date.now();
    // new run -> new random cards; a handoff keeps the cards the user is already looking at
    if (!(handoff && lastDeck)) lastDeck = makeDeck(CARDS.length);
    setDeck(lastDeck);
    if (handoff) {
      shownRef.current = true;
      setInstant(true);
      setShown(true);
      return () => { lastShownAt = Date.now(); };
    }
    const t = window.setTimeout(() => { shownRef.current = true; setShown(true); }, delay);
    return () => {
      window.clearTimeout(t);
      if (shownRef.current) lastShownAt = Date.now();
    };
  }, [delay]);

  // the camera drifts a little with the pointer
  useEffect(() => {
    const el = ref.current;
    if (!mounted || !el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        el.style.setProperty('--px', ((e.clientX / window.innerWidth - 0.5) * 2).toFixed(3));
        el.style.setProperty('--py', ((e.clientY / window.innerHeight - 0.5) * 2).toFixed(3));
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => { window.removeEventListener('pointermove', onMove); if (raf) cancelAnimationFrame(raf); };
  }, [mounted]);

  if (!mounted) return null;

  return createPortal(
    <div className={`tl${shown ? ' is-on' : ''}${instant ? ' is-instant' : ''}${leaving ? ' is-leaving' : ''}`} ref={ref} role="status" aria-live="polite">
      <div className="tl-grid" aria-hidden="true" />
      <div className="tl-glow" aria-hidden="true" />
      <div className="tl-ring tl-ring-a" aria-hidden="true" />
      <div className="tl-ring tl-ring-b" aria-hidden="true" />
      <div className="tl-streaks" aria-hidden="true" />
      <div className="tl-streaks tl-streaks-b" aria-hidden="true" />
      <div className="tl-tube" aria-hidden="true">
        {Array.from({ length: 7 }, (_, k) => (
          <i key={k} style={{ '--k': k } as CSSProperties} />
        ))}
      </div>
      <div className="tl-stage" aria-hidden="true">
        <div className="tl-scene">
          {deck && CARDS.map((c) => {
            const post = deck[c.i];
            return (
              <div key={c.i} className={`tl-card tl-k-${post.kind}`}
                style={{ '--i': c.i, '--cx': c.cx, '--sy': c.sy, '--rx': c.rx, '--ry': c.ry, '--r': `${c.rot}deg` } as CSSProperties}>
                <div className="tl-in"><MiniPost post={post} /></div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="tl-flash" aria-hidden="true" />
      <div className="tl-center">
        <span className="tl-kicker">SPARROW</span>
        <SignalRevealText as="h2" text={title} loop className="tl-title" />
        <div className="tl-bar" aria-hidden="true"><i /></div>
      </div>
    </div>,
    document.body,
  );
}
