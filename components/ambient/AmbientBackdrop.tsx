'use client';

/**
 * Mounted once in the root layout so it persists across route changes (no re-init cost).
 *
 * - Shows the ambient 3D backdrop + scroll progress line on app pages only.
 * - Replays a short "route enter" animation on every navigation (CSS in ambient-motion.css).
 * - Marketing/auth/analyse/admin pages are left alone: the landing has its own scene,
 *   analyse has its scan scene, admin stays dense and quiet.
 */

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

const AmbientCanvas = dynamic(() => import('./AmbientCanvas'), { ssr: false });

const AMBIENT_ROUTES = ['/create', '/studio', '/dashboard', '/calendar', '/brand', '/profile'];

const isAmbientRoute = (path: string) =>
  AMBIENT_ROUTES.some(route => path === route || path.startsWith(`${route}/`));

export default function AmbientBackdrop() {
  const pathname = usePathname() || '/';
  const enabled = isAmbientRoute(pathname);

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

  if (!enabled) return null;

  return (
    <>
      <div className="ambient-progress" aria-hidden="true" />
      <div className="ambient-backdrop" aria-hidden="true">
        <AmbientCanvas routeKey={pathname} />
      </div>
    </>
  );
}
