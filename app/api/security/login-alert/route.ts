import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/supabase';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { emailShell, escapeHtml, sendTransactionalEmail } from '@/lib/email-notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const user = await getUserFromToken(token).catch(() => null);
  if (!user?.id || !user.email) return NextResponse.json({ error: 'Invalid session.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const deviceId = typeof body.deviceId === 'string' ? body.deviceId.slice(0, 160) : '';
  if (!deviceId) return NextResponse.json({ error: 'Device identifier required.' }, { status: 400 });
  const deviceHash = createHash('sha256').update(deviceId).digest('hex');
  const admin = getSupabaseAdmin();
  try {
    const { data: known } = await admin.from('account_login_devices').select('id').eq('user_id', user.id).eq('device_hash', deviceHash).maybeSingle();
    if (known) return NextResponse.json({ ok: true, newDevice: false });
    const userAgent = req.headers.get('user-agent') || 'Unknown browser/device';
    const { error } = await admin.from('account_login_devices').insert({ user_id: user.id, device_hash: deviceHash, user_agent: userAgent.slice(0, 500), last_seen_at: new Date().toISOString() });
    if (error) throw error;
    const when = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
    const email = await sendTransactionalEmail(user.email, 'New sign-in to your QASS account', emailShell('New sign-in detected', `<p>A sign-in to your QASS account was detected from a device we have not seen before.</p><p><b>Time:</b> ${escapeHtml(when)} IST<br><b>Browser/device:</b> ${escapeHtml(userAgent.slice(0, 250))}</p><p>If this was you, no action is needed. If not, change your password and review your account sessions.</p>`));
    return NextResponse.json({ ok: true, newDevice: true, emailSent: email.sent });
  } catch { return NextResponse.json({ error: 'Could not record this sign-in device.' }, { status: 503 }); }
}
