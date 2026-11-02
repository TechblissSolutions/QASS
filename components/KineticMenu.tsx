'use client';

import './kinetic-menu.css';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import gsap from 'gsap';
import { CustomEase } from 'gsap/CustomEase';

if (typeof window !== 'undefined') gsap.registerPlugin(CustomEase);

export type KineticLink = { label: string; href?: string; onClick?: () => void };

let easeName = 'power3.out';
let easeReady = false;
function getEase() {
  if (!easeReady) {
    easeReady = true;
    try { CustomEase.create('kmMain', '0.65, 0.01, 0.05, 0.99'); easeName = 'kmMain'; } catch { /* keep fallback */ }
  }
  return easeName;
}

/**
 * Full-screen kinetic menu: Menu button in the header, a right-hand panel whose
 * backdrop layers slide in one after another, links that rise in with a stagger,
 * and a soft shape behind the panel that changes as you hover each link.
 * The panel is portalled to <body> so sticky/blurred headers cannot clip it.
 */
export default function KineticMenu({ links, className = '', footer, open: openProp, onOpenChange, trigger = true, side = 'right', compact = false }: {
  links: KineticLink[]; className?: string; footer?: string;
  open?: boolean; onOpenChange?: (open: boolean) => void; trigger?: boolean; side?: 'left' | 'right'; compact?: boolean;
}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const open = openProp ?? innerOpen;
  const setOpen = (next: boolean) => { if (openProp === undefined) setInnerOpen(next); onOpenChange?.(next); };
  const [mounted, setMounted] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const tlRef = useRef<gsap.core.Timeline | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const path = usePathname() || '';

  useEffect(() => { setMounted(true); }, []);

  // Build the open/close timeline once; play it forward to open and reverse it to close.
  useEffect(() => {
    const root = rootRef.current;
    if (!mounted || !root) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t = (v: number) => (reduce ? 0.01 : v);
    const ctx = gsap.context(() => {
      const q = (s: string) => root.querySelectorAll(s);
      const tl = gsap.timeline({
        paused: true,
        defaults: { ease: getEase(), duration: t(0.7) },
        onReverseComplete: () => { gsap.set(root, { display: 'none' }); },
      });
      tl.set(root, { display: 'block' })
        .fromTo(q('.km-dim'), { autoAlpha: 0 }, { autoAlpha: 1, duration: t(0.5) })
        .fromTo(q('.km-layer'), { xPercent: side === 'left' ? -101 : 101 }, { xPercent: 0, stagger: reduce ? 0 : 0.12, duration: t(0.575) }, '<')
        .fromTo(q('.km-link-inner'), { yPercent: 140, rotate: 10 }, { yPercent: 0, rotate: 0, stagger: reduce ? 0 : 0.05 }, '<+=0.35')
        .fromTo(q('[data-km-fade]'), { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, stagger: reduce ? 0 : 0.05 }, '<+=0.2')
        .fromTo(q('.km-x'), { rotate: 0 }, { rotate: 315 }, 0.1);
      tlRef.current = tl;
    }, root);
    return () => { ctx.revert(); tlRef.current = null; };
  }, [mounted, side]);

  useEffect(() => {
    const tl = tlRef.current;
    if (!tl) return;
    if (open) {
      tl.timeScale(1).play();
      document.body.style.overflow = 'hidden';
      requestAnimationFrame(() => closeRef.current?.focus());
    } else if (tl.time() > 0) {
      tl.timeScale(1.6).reverse();
      document.body.style.overflow = '';
      if (wasOpen.current) triggerRef.current?.focus();
    }
    wasOpen.current = open;
    return () => { if (open) document.body.style.overflow = ''; };
  }, [open, mounted]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const showShape = (i: number) => {
    const root = rootRef.current;
    const shape = root?.querySelector(`.km-shape-${i}`);
    if (!root || !shape) return;
    root.querySelectorAll('.km-shape').forEach((s) => { if (s !== shape) s.classList.remove('active'); });
    shape.classList.add('active');
    gsap.fromTo(shape.querySelectorAll('.km-el'),
      { scale: 0.5, opacity: 0, rotation: -10, transformOrigin: '50% 50%' },
      { scale: 1, opacity: 1, rotation: 0, duration: 0.6, stagger: 0.08, ease: 'back.out(1.7)', overwrite: 'auto' });
  };
  const hideShape = (i: number) => {
    const shape = rootRef.current?.querySelector(`.km-shape-${i}`);
    if (!shape) return;
    gsap.to(shape.querySelectorAll('.km-el'), {
      scale: 0.8, opacity: 0, duration: 0.3, ease: 'power2.in', overwrite: 'auto',
      onComplete: () => shape.classList.remove('active'),
    });
  };

  const overlay = (
    <div ref={rootRef} className="km-root" role="dialog" aria-modal="true" aria-label="Site menu">
      <div className="km-dim" onClick={() => setOpen(false)} />
      <nav className={`km-panel${side === 'left' ? ' km-left' : ''}${compact ? ' km-compact' : ''}`} aria-label="Menu">
        <div className="km-bg" aria-hidden="true">
          <div className="km-layer km-layer-1" />
          <div className="km-layer km-layer-2" />
          <div className="km-layer km-layer-3" />
          <div className="km-shapes">
            <svg className="km-shape km-shape-1" viewBox="0 0 400 400" fill="none">
              <circle className="km-el fa" cx="80" cy="120" r="40" /><circle className="km-el fb" cx="300" cy="80" r="60" />
              <circle className="km-el fc" cx="200" cy="300" r="80" /><circle className="km-el fa" cx="350" cy="280" r="30" />
            </svg>
            <svg className="km-shape km-shape-2" viewBox="0 0 400 400" fill="none">
              <path className="km-el sa" d="M0 200 Q100 100, 200 200 T 400 200" strokeWidth="60" />
              <path className="km-el sb" d="M0 280 Q100 180, 200 280 T 400 280" strokeWidth="40" />
            </svg>
            <svg className="km-shape km-shape-3" viewBox="0 0 400 400" fill="none">
              {[[50, 50, 8], [150, 50, 8], [250, 50, 8], [350, 50, 8], [100, 150, 12], [200, 150, 12], [300, 150, 12], [50, 250, 10], [150, 250, 10], [250, 250, 10], [350, 250, 10], [100, 350, 6], [200, 350, 6], [300, 350, 6]].map(([x, y, r], i) => (
                <circle key={i} className={`km-el ${i % 3 === 0 ? 'fa' : i % 3 === 1 ? 'fb' : 'fc'}`} cx={x} cy={y} r={r} />
              ))}
            </svg>
            <svg className="km-shape km-shape-4" viewBox="0 0 400 400" fill="none">
              <path className="km-el fb" d="M100 100 Q150 50, 200 100 Q250 150, 200 200 Q150 250, 100 200 Q50 150, 100 100" />
              <path className="km-el fc" d="M250 200 Q300 150, 350 200 Q400 250, 350 300 Q300 350, 250 300 Q200 250, 250 200" />
            </svg>
            <svg className="km-shape km-shape-5" viewBox="0 0 400 400" fill="none">
              <line className="km-el sa" x1="0" y1="100" x2="300" y2="400" strokeWidth="30" />
              <line className="km-el sb" x1="100" y1="0" x2="400" y2="300" strokeWidth="25" />
              <line className="km-el sa" x1="200" y1="0" x2="400" y2="200" strokeWidth="20" />
            </svg>
          </div>
        </div>
        <div className="km-content">
          <div className="km-top">
            <span className="km-brand" data-km-fade>Sparrow <small>by TechBliss</small></span>
            <button ref={closeRef} type="button" className="km-trigger km-close" onClick={() => setOpen(false)}>
              <span>Close</span>
              <span className="km-trigger-icon" aria-hidden="true">
                <svg className="km-x" viewBox="0 0 16 16"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
              </span>
            </button>
          </div>
          <ul className="km-list">
            {links.map((l, i) => (
              <li key={`${l.label}-${i}`}
                onMouseEnter={() => showShape((i % 5) + 1)} onMouseLeave={() => hideShape((i % 5) + 1)}
                onFocus={() => showShape((i % 5) + 1)} onBlur={() => hideShape((i % 5) + 1)}>
                {l.href ? (
                  <Link href={l.href} className="km-link" aria-current={path === l.href.split(/[?#]/)[0] ? 'page' : undefined}
                    onClick={() => { l.onClick?.(); setOpen(false); }}>
                    <span className="km-link-inner">{l.label}</span>
                  </Link>
                ) : (
                  <button type="button" className="km-link" onClick={() => { l.onClick?.(); setOpen(false); }}>
                    <span className="km-link-inner">{l.label}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
          {footer && <p className="km-footer" data-km-fade>{footer}</p>}
        </div>
      </nav>
    </div>
  );

  return (
    <>
      {trigger && (
      <button ref={triggerRef} type="button" className={`km-trigger ${className}`.trim()} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>Menu</span>
        <span className="km-trigger-icon" aria-hidden="true">
          <svg viewBox="0 0 16 16"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        </span>
      </button>
      )}
      {mounted ? createPortal(overlay, document.body) : null}
    </>
  );
}
