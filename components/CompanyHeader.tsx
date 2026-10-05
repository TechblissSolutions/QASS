'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { listProjects, type ProjectRow, deleteProject, getSupabaseClient } from '@/lib/supabase';
import { useStore } from '@/lib/store';
import { fetchBrandAppearance, brandThemeComplete, mergeTheme } from '@/lib/brand-client';
import { companyInitials, companyNameFromUrl } from '@/lib/utils';
import BrandTheme from './BrandTheme';
import AccountMenu from './AccountMenu';
import SmartLogo from './SmartLogo';

export default function CompanyHeader() {
  const { s, set, reset } = useStore();
  const pathname = usePathname();
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let alive = true;
    void listProjects(50).then(rows => { if (alive) setProjects(rows); }).catch(() => {});
    return () => { alive = false; };
  }, [s.projectId]);

  // Fetch the logo/colours at most once per company (NOT on every theme change, which looped and hit 429).
  const triedBrand = useRef<string>('');
  useEffect(() => {
    if (!s.projectId || !s.url) return;
    if (triedBrand.current === s.projectId) return;
    if (brandThemeComplete(s.brandTheme)) { triedBrand.current = s.projectId; return; }
    triedBrand.current = s.projectId;
    let alive = true;
    void (async () => {
      const fetched = await fetchBrandAppearance(s.url, true);
      if (!fetched || !alive) return;
      const nextTheme = mergeTheme(s.brandTheme, fetched);
      set({ brandTheme: nextTheme as any });
      const supabase = getSupabaseClient();
      if (supabase) void supabase.from('projects').update({ brand_theme: nextTheme }).eq('id', s.projectId!);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.projectId, s.url]);

  if (!s.projectId || !s.profile) return null;
  const name = String(s.profile.company_name || companyNameFromUrl(s.url) || 'Company');
  const logo = String(s.brandTheme?.logo_url || '');
  const primary = String(s.brandTheme?.primary_color || '#111111');
  const onPrimary = 'var(--client-on-primary, #fff)';
  const href = (route: string) => `${route}?project=${encodeURIComponent(s.projectId || '')}${s.jobRowId && route === '/studio' ? `&job=${encodeURIComponent(s.jobRowId)}` : ''}`;
  const historyHref = `/dashboard/project/${encodeURIComponent(s.projectId)}`;
  const nav = [['Studio', '/studio'], ['Calendar', '/calendar'], ['History', historyHref]] as const;
  const active = (route: string) => route.startsWith('/dashboard/project') ? pathname.startsWith('/dashboard/project') : pathname === route;

  const switchCompany = (id: string) => {
    setOpen(false);
    reset();
    router.push(`/studio?project=${encodeURIComponent(id)}`);
  };

  const removeCompany = async () => {
    if (!window.confirm(`Delete ${name}? This permanently removes the company workspace and its saved generations.`)) return;
    setDeleting(true);
    try {
      await deleteProject(s.projectId!);
      reset();
      router.replace('/dashboard');
    } catch {
      window.alert('Could not delete this company. Please try again.');
    } finally { setDeleting(false); }
  };

  return <>
    <BrandTheme />
    <header className="company-shell-header" style={{ '--company-primary': primary, '--company-on-primary': onPrimary } as React.CSSProperties}>
      <div className="company-shell-inner">
        <button className="company-shell-brand" onClick={() => router.push('/dashboard')} aria-label="Back to companies">
          <span className="company-shell-logo">{logo ? <SmartLogo src={'/api/brand-logo?src=' + encodeURIComponent(logo)} alt="" fallback={companyInitials(name)} /> : <b>{companyInitials(name)}</b>}</span>
          <span className="company-shell-company-name">{name}</span>
        </button>
        <div className="company-shell-switcher">
          <button className="company-shell-switch" onClick={() => setOpen(v => !v)} aria-expanded={open}>Switch company <span>⌄</span></button>
          {open && <div className="company-shell-menu">
            {projects.map(p => {
              const n = String((p.profile as any)?.company_name || companyNameFromUrl(p.url));
              return <button key={p.id} className={p.id === s.projectId ? 'selected' : ''} onClick={() => switchCompany(p.id)}><span className="switcher-logo">{String((p.brand_theme as any)?.logo_url || '') ? <SmartLogo src={'/api/brand-logo?src=' + encodeURIComponent(String((p.brand_theme as any)?.logo_url))} alt="" /> : <b>{companyInitials(n)}</b>}</span><span>{n}</span>{p.id === s.projectId && <i>✓</i>}</button>;
            })}
            <button className="company-shell-add" onClick={() => { setOpen(false); router.push('/analyse?new=1'); }}>＋ Add company</button>
            <button className="company-shell-delete" disabled={deleting} onClick={removeCompany}>{deleting ? 'Deleting…' : 'Delete this company'}</button>
          </div>}
        </div>
        <nav className="company-shell-nav" aria-label="Company workspace">
          {nav.map(([label, route]) => <Link key={label} className={active(route) ? 'active' : ''} href={route.startsWith('/dashboard/project') ? route : href(route)}>{label}</Link>)}
        </nav>
        <Link className="company-shell-all" href="/dashboard">All companies</Link>
        <AccountMenu compact />
      </div>
    </header>
    <aside className="company-sidebar" style={{ '--company-primary': primary, '--company-on-primary': onPrimary } as React.CSSProperties}>
      <div className="company-sidebar-logo">{logo ? <SmartLogo src={'/api/brand-logo?src=' + encodeURIComponent(logo)} alt="" fallback={companyInitials(name)} /> : <b>{companyInitials(name)}</b>}</div>
      <div className="company-sidebar-name">{name}</div>
      <nav>
        {nav.map(([label, route]) => <Link key={label} className={active(route) ? 'active' : ''} href={route.startsWith('/dashboard/project') ? route : href(route)}><span className="sidebar-nav-icon">{label === 'Studio' ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.7 6.3L20 11l-6.3 1.7L12 19l-1.7-6.3L4 11l6.3-1.7L12 3Z"/></svg> : label === 'Calendar' ? <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M7 3.5v4M17 3.5v4M3.5 9.5h17"/></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7.5a7 7 0 1 1-1.1 8.1"/><path d="M7 3.5v4h4"/><path d="M17 16.5v4h-4"/></svg>}</span><strong>{label}</strong></Link>)}
      </nav>
    </aside>
  </>;
}
