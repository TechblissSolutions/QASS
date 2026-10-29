'use client';

import './aurora.css';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

type Tier = 'full' | 'soft' | null;

/**
 * Soft drifting glows (pink, purple, peach) behind the page, only where a page has no animated background of its own.
 *  null  : landing (own glows), admin (excluded), login / signup / pricing (AuthScene orbs),
 *          company workspaces (their own brand + 3D background)
 *  soft  : dashboard, profile, analyse (gentle, sits behind the existing 3D background)
 *  full  : utility pages (not-found, maintenance, error) and any other page
 */
function tierFor(p: string): Tier {
  if (p === '/' || p === '/admin' || p.startsWith('/admin/')) return null;
  if (p === '/login' || p === '/signup' || p === '/pricing') return null;
  if (p.startsWith('/dashboard/')) return null;
  if (['/studio', '/create', '/calendar', '/brand'].some((r) => p === r || p.startsWith(`${r}/`))) return null;
  if (p === '/dashboard' || p === '/profile' || p.startsWith('/profile/')) return null; // Velaris backdrop (AmbientBackdrop) covers these
  if (p === '/analyse' || p.startsWith('/analyse/')) return 'soft';
  return 'full';
}

function disabled() {
  try {
    if (new URLSearchParams(window.location.search).get('aurora') === 'off') return true;
    return window.localStorage.getItem('sparrow-aurora') === 'off';
  } catch {
    return false;
  }
}

export default function AuroraBackdrop() {
  const pathname = usePathname() || '/';

  useEffect(() => {
    const root = document.documentElement;
    const tier = disabled() ? null : tierFor(pathname);
    if (tier) root.setAttribute('data-aurora', tier);
    else root.removeAttribute('data-aurora');
    return () => root.removeAttribute('data-aurora');
  }, [pathname]);

  return (
    <div className="ab" aria-hidden="true">
      <i /><i /><i /><i />
    </div>
  );
}
