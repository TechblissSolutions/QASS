import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/supabase';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { isOwnerEmail, isOwnerUserId } from '@/lib/entitlements';

export async function requireAdmin(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { response: NextResponse.json({ error: 'Authentication required.' }, { status: 401 }) } as const;
  let user;
  try { user = await getUserFromToken(token); } catch { user = null; }
  if (!user) return { response: NextResponse.json({ error: 'Invalid session.' }, { status: 401 }) } as const;
  let allowed = isOwnerEmail(user.email) || isOwnerUserId(user.id);
  if (!allowed) {
    try {
      const { data } = await getSupabaseAdmin().from('profiles').select('role').eq('id', user.id).maybeSingle();
      allowed = data?.role === 'owner';
    } catch { allowed = false; }
  }
  if (!allowed) return { response: NextResponse.json({ error: 'Administrator access required.' }, { status: 403 }) } as const;
  return { user } as const;
}

/** Returns a 403 when a platform feature is disabled; authorized admins bypass platform gates. */
export async function checkFeatureGate(req: NextRequest, key: string) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  let user;
  try { user = await getUserFromToken(token); } catch { user = null; }
  if (!user) return NextResponse.json({ error: 'Invalid session.' }, { status: 401 });
  let admin = isOwnerEmail(user.email) || isOwnerUserId(user.id);
  if (!admin) {
    try {
      const { data } = await getSupabaseAdmin().from('profiles').select('role').eq('id', user.id).maybeSingle();
      admin = data?.role === 'owner';
    } catch { /* continue as a regular user; flag check below will fail closed */ }
  }
  if (admin) return null;
  try {
    const adminClient = getSupabaseAdmin();
    const { data: override, error: overrideError } = await adminClient.from('admin_user_feature_overrides').select('enabled').eq('user_id', user.id).eq('feature_key', key).maybeSingle();
    if (overrideError && !String(overrideError.message || '').toLowerCase().includes('does not exist')) return NextResponse.json({ error: 'User feature controls are temporarily unavailable.' }, { status: 503 });
    const { data, error } = await adminClient.from('admin_feature_flags').select('enabled').eq('key', key).maybeSingle();
    if (error) return NextResponse.json({ error: 'Feature controls are temporarily unavailable.' }, { status: 503 });
    // A platform-wide kill switch always wins. Per-user overrides only refine an enabled platform feature.
    if (data && data.enabled === false) return NextResponse.json({ error: 'This feature is temporarily disabled by the platform administrator.' }, { status: 403 });
    if (override && override.enabled === false) return NextResponse.json({ error: 'This feature has been disabled for your account by the platform administrator.' }, { status: 403 });
    return null;
  } catch { return NextResponse.json({ error: 'Feature controls are temporarily unavailable.' }, { status: 503 }); }
}
