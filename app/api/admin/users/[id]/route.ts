import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { emailShell, escapeHtml, sendTransactionalEmail } from '@/lib/email-notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const USER_FEATURES = ['generation','scheduling','social_connections','website_analysis','media_generation','history','brand_dna','personal_apis'] as const;

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req); if ('response' in auth) return auth.response;
  const { id } = await ctx.params;
  try {
    const admin = getSupabaseAdmin();
    const [{ data: profile, error: profileError }, { data: overrides, error: overrideError }] = await Promise.all([
      admin.from('profiles').select('id,plan').eq('id', id).maybeSingle(),
      admin.from('admin_user_feature_overrides').select('feature_key,enabled').eq('user_id', id),
    ]);
    if (profileError || overrideError) throw new Error('User controls are not ready. Run the latest admin SQL migration.');
    const features = Object.fromEntries(USER_FEATURES.map(key => [key, overrides?.find((x: any) => x.feature_key === key)?.enabled ?? null]));
    return NextResponse.json({ plan: profile?.plan === 'pro' ? 'premium' : (profile?.plan || 'free'), features }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Unable to load user controls.' }, { status: 503 }); }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req); if ('response' in auth) return auth.response;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null); if (!body) return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  const admin = getSupabaseAdmin();
  try {
    if (body.action === 'plan') {
      if (!['free','premium'].includes(body.plan)) return NextResponse.json({ error: 'Plan must be free or premium.' }, { status: 400 });
      const { error } = await admin.from('profiles').update({ plan: body.plan === 'premium' ? 'pro' : 'free' }).eq('id', id);
      if (error) throw error;
      await admin.from('admin_audit_log').insert({ actor_user_id: auth.user.id, target_user_id: id, action: 'user_plan_changed', details: { plan: body.plan } });
      const { data: target } = await admin.auth.admin.getUserById(id);
      if (target.user?.email) void sendTransactionalEmail(target.user.email, 'Your QASS plan was updated', emailShell('Your plan was updated', `<p>An administrator changed your QASS plan to <b>${escapeHtml(body.plan)}</b>.</p>`)).catch(() => undefined);
      return NextResponse.json({ ok: true, plan: body.plan });
    }
    if (body.action === 'feature') {
      if (!USER_FEATURES.includes(body.key) || typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'A valid feature key and enabled boolean are required.' }, { status: 400 });
      const { error } = await admin.from('admin_user_feature_overrides').upsert({ user_id: id, feature_key: body.key, enabled: body.enabled, updated_by: auth.user.id, updated_at: new Date().toISOString() }, { onConflict: 'user_id,feature_key' });
      if (error) throw error;
      await admin.from('admin_audit_log').insert({ actor_user_id: auth.user.id, target_user_id: id, action: 'user_feature_changed', details: { key: body.key, enabled: body.enabled } });
      const { data: target } = await admin.auth.admin.getUserById(id);
      if (target.user?.email) void sendTransactionalEmail(target.user.email, 'A QASS feature setting changed', emailShell('A feature setting changed', `<p>An administrator ${body.enabled ? 'enabled' : 'disabled'} the <b>${escapeHtml(body.key)}</b> feature for your account.</p>`)).catch(() => undefined);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Could not save user controls.' }, { status: 503 }); }
}
