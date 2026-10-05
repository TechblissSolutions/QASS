'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { clearAuthPersistence, getSupabaseClient } from '@/lib/supabase';
import { getAccessToken } from '@/lib/auth';

type Account = {
  user: { id: string; email?: string; fullName?: string | null };
  role: string;
  entitlements: { plan: string; maxCompanies: number | null; canRegenerate: boolean; canUseAllFeatures: boolean };
};

function initials(account: Account | null) {
  const name = String(account?.user.fullName || '').trim();
  if (name) return name.split(/\s+/).slice(0, 2).map(v => v[0]).join('').toUpperCase();
  const email = String(account?.user.email || '').trim();
  return email ? email[0].toUpperCase() : '?';
}

function displayName(account: Account | null) {
  const name = String(account?.user.fullName || '').trim();
  if (name) return name;
  const email = String(account?.user.email || '').trim();
  return email ? email.split('@')[0] : 'Account';
}

export default function AccountMenu({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const token = await getAccessToken();
      if (!token) return;
      const res = await fetch('/api/account', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json() as Account;
      if (alive) setAccount(data);
    })().catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open]);

  async function signOut() {
    await getSupabaseClient()?.auth.signOut();
    clearAuthPersistence();
    router.replace('/');
  }

  const plan = String(account?.entitlements.plan || 'free');
  const isSignedIn = Boolean(account?.user?.email);

  if (!isSignedIn) {
    return <a className={`account-trigger account-signin ${compact ? 'compact' : ''}`} href="/login">Sign in</a>;
  }

  return <div className={`account-menu ${compact ? 'compact' : ''}`} ref={ref}>
    <button type="button" className="account-trigger" onClick={() => setOpen(v => !v)} aria-expanded={open} aria-haspopup="menu">
      <span className="account-avatar">{initials(account)}</span>
      {!compact && <span className="account-trigger-name">{displayName(account)}</span>}
      <span className="account-chevron">⌄</span>
    </button>
    {open && <div className="account-popover" role="menu">
      <div className="account-popover-head">
        <span className="account-avatar account-avatar-large">{initials(account)}</span>
        <div className="account-popover-identity"><strong>{displayName(account)}</strong><span>{account?.user.email}</span></div>
      </div>
      <div className="account-plan-row"><span>Account</span><strong className={`account-plan account-plan-${plan}`}>{plan === 'owner' ? 'OWNER' : plan === 'pro' ? 'PRO' : 'FREE'}</strong></div>
      <div className="account-meta-row"><span>Company workspaces</span><strong>{account?.entitlements.maxCompanies == null ? 'Unlimited' : account.entitlements.maxCompanies}</strong></div>
      <div className="account-popover-actions">
        <a href="/dashboard" onClick={() => setOpen(false)}>Workspace</a>
        <a href="/pricing" onClick={() => setOpen(false)}>Plans & billing</a>
        <button type="button" onClick={signOut}>Sign out <span>↗</span></button>
      </div>
    </div>}
  </div>;
}
