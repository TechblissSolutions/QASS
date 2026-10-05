export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient, getUserFromToken } from '@/lib/supabase';
import { entitlementsFor, isOwnerEmail, isOwnerUserId, type Plan } from '@/lib/entitlements';
import { apiGuard, errorMessage } from '@/lib/server';
import { log, requestId } from '@/lib/logger';

export async function GET(req: NextRequest) {
  const rid = requestId();
  const limited = await apiGuard(req, { rateLimit: 60, scope: 'account' }); if (limited) return limited;
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return NextResponse.json({ user: null, entitlements: entitlementsFor('free') }, { status: 401, headers: { 'X-Request-ID': rid } });
  try {
    const user = await getUserFromToken(token);
    if (!user) return NextResponse.json({ user: null }, { status: 401, headers: { 'X-Request-ID': rid } });
    const supabase = getSupabaseClient(token);
    let plan: Plan = 'free';
    let role = 'user';
    let fullName: string | null = null;
    if (isOwnerEmail(user.email) || isOwnerUserId(user.id)) { plan='owner'; role='owner'; }
    else if (supabase) {
      const [{ data }, { data: subscription }] = await Promise.all([
        supabase.from('profiles').select('plan,role,full_name').eq('id',user.id).maybeSingle(),
        supabase.from('subscriptions').select('plan,status').eq('user_id',user.id).maybeSingle(),
      ]);
      if (data?.plan === 'pro' || (subscription?.plan === 'pro' && ['active','trialing'].includes(String(subscription.status)))) plan='pro';
      fullName = data?.full_name || String(user.user_metadata?.full_name || '') || null;
      if (data?.role === 'owner') { plan='owner'; role='owner'; }
    }
    log({ level: 'info', route: '/api/account', request_id: rid, user_id: user.id, status: 200 });
    return NextResponse.json({ user:{id:user.id,email:user.email,fullName}, role, entitlements:entitlementsFor(plan) }, { headers: { 'Cache-Control': 'private, no-store', 'X-Request-ID': rid } });
  } catch (err) {
    log({ level: 'error', route: '/api/account', request_id: rid, error: errorMessage(err) });
    return NextResponse.json({ error:errorMessage(err, 'Unable to load account.'), request_id: rid },{status:401, headers: { 'X-Request-ID': rid }});
  }
}
