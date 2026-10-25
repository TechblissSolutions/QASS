'use client';

/**
 * Sparrow futuristic motion layer (behaviour only, no theme changes).
 * - Cursor glow, 3D card tilt, magnetic primary buttons, scroll reveal with depth.
 * - All of it is skipped for reduced-motion users and touch devices.
 */

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

const TILT = '.dashboard-v6-card, .sq, .pricing-card, .previous-post-item, .admin-feature-mini, .landing-social-card, .auth-card';
const MAGNETIC = '.btn-primary, .auth-submit, .landing-v6-primary, .landing-v6-cta';
const REVEAL = '.dashboard-v6-card, .sq, .pricing-card, .panel, .profile-panel, .admin-panel, .landing-social-card, .schedule-page-head, .page-head';

/** Safe mode: add ?fx=off to any URL (or set localStorage sparrow-fx=off) to disable the whole layer. */
function fxDisabled() {
  try {
    if (new URLSearchParams(window.location.search).get('fx') === 'off') return true;
    return window.localStorage.getItem('sparrow-fx') === 'off';
  } catch {
    return false;
  }
}

export default function FuturisticFX() {
  const pathname = usePathname();

  // One-time: glow element, pointer tracking, tilt, magnetic buttons
  useEffect(() => {
    const root = document.documentElement;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (fxDisabled()) return;
    root.classList.add('fx-ready');
    if (reduced) return () => root.classList.remove('fx-ready');

    let glow: HTMLDivElement | null = null;
    let raf = 0;
    let ev: PointerEvent | null = null;
    let tilted: HTMLElement | null = null;
    let pulled: HTMLElement | null = null;

    if (fine) {
      glow = document.createElement('div');
      glow.className = 'fx-cursor-glow';
      glow.setAttribute('aria-hidden', 'true');
      document.body.appendChild(glow);
    }

    const release = (el: HTMLElement | null) => {
      if (!el) return;
      el.classList.add('fx-tilt-reset');
      el.classList.remove('fx-tilt');
      el.style.removeProperty('--fx-rx');
      el.style.removeProperty('--fx-ry');
      window.setTimeout(() => el.classList.remove('fx-tilt-reset'), 540);
    };

    const frame = () => {
      raf = 0;
      if (!ev) return;
      try {
      const { clientX: x, clientY: y, target } = ev;
      root.classList.add('fx-pointer');
      glow?.style.setProperty('--fx-x', `${x}px`);
      glow?.style.setProperty('--fx-y', `${y}px`);
      root.style.setProperty('--fx-px', ((x / window.innerWidth) * 2 - 1).toFixed(3));
      root.style.setProperty('--fx-py', ((y / window.innerHeight) * 2 - 1).toFixed(3));

      const el = target instanceof Element ? target : null;

      const card = el?.closest<HTMLElement>(TILT) ?? null;
      if (card && card.offsetWidth < 720) {
        const r = card.getBoundingClientRect();
        const px = (x - r.left) / r.width - 0.5;
        const py = (y - r.top) / r.height - 0.5;
        if (tilted !== card) release(tilted);
        tilted = card;
        card.classList.remove('fx-tilt-reset');
        card.classList.add('fx-tilt');
        card.style.setProperty('--fx-rx', `${(-py * 6).toFixed(2)}deg`);
        card.style.setProperty('--fx-ry', `${(px * 8).toFixed(2)}deg`);
      } else if (tilted) {
        release(tilted);
        tilted = null;
      }

      const btn = el?.closest<HTMLElement>(MAGNETIC) ?? null;
      if (btn) {
        const r = btn.getBoundingClientRect();
        pulled = btn;
        btn.style.setProperty('--fx-mx', `${((x - (r.left + r.width / 2)) * 0.12).toFixed(1)}px`);
        btn.style.setProperty('--fx-my', `${((y - (r.top + r.height / 2)) * 0.2).toFixed(1)}px`);
      } else if (pulled) {
        pulled.style.removeProperty('--fx-mx');
        pulled.style.removeProperty('--fx-my');
        pulled = null;
      }
      } catch {
        /* never let a visual effect break the page */
      }
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      ev = e;
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const onLeave = () => {
      root.classList.remove('fx-pointer');
      release(tilted);
      tilted = null;
    };

    document.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);

    return () => {
      document.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      if (raf) cancelAnimationFrame(raf);
      glow?.remove();
      root.classList.remove('fx-ready', 'fx-pointer');
    };
  }, []);

  // Scroll reveal: re-scan on route change and when new cards render
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (fxDisabled()) return;
    // The dashboard must always open instantly: no reveal animation there
    if (pathname === '/dashboard' || pathname?.startsWith('/dashboard/')) return;
    const seen = new WeakSet<Element>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) {
            en.target.classList.add('fx-in');
            io.unobserve(en.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' },
    );

    const scan = () => {
      let i = 0;
      document.querySelectorAll<HTMLElement>(REVEAL).forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        // Only animate items that start below the fold, so nothing flashes on load
        if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return;
        el.setAttribute('data-fx-reveal', '');
        el.style.setProperty('--fx-delay', `${Math.min(i++, 5) * 70}ms`);
        io.observe(el);
      });
    };

    scan();
    let t = 0;
    const mo = new MutationObserver(() => {
      window.clearTimeout(t);
      t = window.setTimeout(scan, 120);
    });
    mo.observe(document.body, { childList: true, subtree: true });

    return () => {
      io.disconnect();
      mo.disconnect();
      window.clearTimeout(t);
    };
  }, [pathname]);

  return null;
}
