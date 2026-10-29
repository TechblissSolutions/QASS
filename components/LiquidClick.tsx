'use client';

import './liquid-click.css';
import { useEffect } from 'react';

/**
 * Liquid click for the bars (inspired by the "Waterline" navbar):
 *  - every tap on a bar sends a ripple along it
 *  - the item you tap squashes and stretches like a drop of water
 * Ripples are drawn on a layer outside your React tree, so no page markup is touched.
 * Off switches: ?lq=off, localStorage 'sparrow-lq' = 'off', or reduced motion.
 */
const BARS = '.sp-nav, .pz-nav, .sn, .company-shell-header, .company-sidebar, .dashboard-v6-header, .sparrow-account-header';
const POPS = 'a, button, [role="button"]';

function disabled() {
  try {
    if (new URLSearchParams(window.location.search).get('lq') === 'off') return true;
    return window.localStorage.getItem('sparrow-lq') === 'off';
  } catch {
    return false;
  }
}

export default function LiquidClick() {
  useEffect(() => {
    if (disabled() || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const layers: HTMLElement[] = [];
    const timers = new Set<number>();

    const later = (fn: () => void, ms: number) => {
      const t = window.setTimeout(() => { timers.delete(t); fn(); }, ms);
      timers.add(t);
    };

    const onDown = (e: PointerEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      const bar = el?.closest<HTMLElement>(BARS);
      if (!el || !bar) return;
      const r = bar.getBoundingClientRect();
      if (r.width < 40 || r.height < 24) return;

      // ripple layer, same size and shape as the bar, clipped to it
      while (layers.length >= 4) layers.shift()?.remove();
      const layer = document.createElement('div');
      layer.className = 'lq-layer';
      layer.setAttribute('aria-hidden', 'true');
      layer.style.left = `${r.left}px`;
      layer.style.top = `${r.top}px`;
      layer.style.width = `${r.width}px`;
      layer.style.height = `${r.height}px`;
      layer.style.borderRadius = getComputedStyle(bar).borderRadius;
      layer.style.setProperty('--x', `${(e.clientX - r.left).toFixed(1)}px`);
      layer.style.setProperty('--y', `${(e.clientY - r.top).toFixed(1)}px`);
      layer.style.setProperty('--d', `${Math.round(Math.max(r.width, r.height) * 1.6)}px`);
      for (const cls of ['lq-wave', 'lq-wave lq-wave-2']) {
        const w = document.createElement('i');
        w.className = cls;
        layer.appendChild(w);
      }
      document.body.appendChild(layer);
      layers.push(layer);
      later(() => { layer.remove(); const i = layers.indexOf(layer); if (i >= 0) layers.splice(i, 1); }, 1100);

      // squash-and-stretch on the tapped item
      const item = el.closest<HTMLElement>(POPS);
      if (item && bar.contains(item)) {
        item.classList.remove('lq-pop');
        void item.offsetWidth; // restart on rapid taps
        item.classList.add('lq-pop');
        later(() => item.classList.remove('lq-pop'), 700);
      }
    };

    document.addEventListener('pointerdown', onDown, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', onDown);
      timers.forEach((t) => window.clearTimeout(t));
      layers.forEach((l) => l.remove());
      document.querySelectorAll('.lq-pop').forEach((n) => n.classList.remove('lq-pop'));
    };
  }, []);

  return null;
}
