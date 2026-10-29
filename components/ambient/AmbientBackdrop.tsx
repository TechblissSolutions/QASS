'use client';

/**
 * Mounted once in the root layout so it persists across route changes.
 *
 * - On workspace pages only: a calm, modern surface behind the content —
 *   warm paper, a drifting pink aurora (port of the Aurora Background component,
 *   plain CSS — no Tailwind/framer-motion), a fine dot grid, and a faint
 *   spotlight that follows the cursor (fine pointers only).
 * - Pure CSS layers (see design-system.css), so it is cheap and never needs a
 *   WebGL context. Cursor tracking is skipped on touch devices and when the
 *   user prefers reduced motion.
 * - Replays a short "route enter" animation on every navigation (ambient-motion.css).
 * - Marketing/auth/analyse/admin pages are left alone.
 */

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

const AMBIENT_ROUTES = ['/create', '/studio', '/dashboard', '/calendar', '/brand', '/profile'];

const isAmbientRoute = (path: string) =>
  AMBIENT_ROUTES.some(route => path === route || path.startsWith(`${route}/`));

export default function AmbientBackdrop() {
  const pathname = usePathname() || '/';
  const enabled = isAmbientRoute(pathname);
  const backdrop = useRef<HTMLDivElement>(null);

  // flag the <html> element so CSS can let the backdrop show through the page background
  useEffect(() => {
    const root = document.documentElement;
    if (enabled) root.setAttribute('data-ambient', 'on');
    else root.removeAttribute('data-ambient');
    return () => root.removeAttribute('data-ambient');
  }, [enabled]);

  // replay the route-enter animation on every navigation inside the ambient area
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    root.classList.remove('route-enter');
    void root.offsetWidth; // force reflow so the animation restarts
    root.classList.add('route-enter');
    const id = window.setTimeout(() => root.classList.remove('route-enter'), 1200);
    return () => {
      window.clearTimeout(id);
      root.classList.remove('route-enter');
    };
  }, [pathname, enabled]);

  // soft spotlight that eases toward the pointer
  useEffect(() => {
    const el = backdrop.current;
    if (!enabled || !el) return;
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!fine || reduce) return;

    let tx = window.innerWidth * 0.7;
    let ty = window.innerHeight * 0.25;
    let x = tx;
    let y = ty;
    let raf = 0;
    const paint = () => {
      el.style.setProperty('--mx', `${x.toFixed(1)}px`);
      el.style.setProperty('--my', `${y.toFixed(1)}px`);
    };
    const tick = () => {
      x += (tx - x) * 0.12;
      y += (ty - y) * 0.12;
      paint();
      raf = Math.abs(tx - x) > 0.5 || Math.abs(ty - y) > 0.5 ? requestAnimationFrame(tick) : 0;
    };
    const onMove = (e: PointerEvent) => {
      tx = e.clientX;
      ty = e.clientY;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    paint();
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(raf);
    };
  }, [enabled]);

  return (
    <>
      {enabled && <div className="ambient-progress" aria-hidden="true" />}
      <div ref={backdrop} className="ambient-backdrop" aria-hidden="true" hidden={!enabled}>
        <div className="sp-aurora" />
        <i className="sp-bg-grid" />
        <i className="sp-bg-spot" />
      </div>
    </>
  );
}
