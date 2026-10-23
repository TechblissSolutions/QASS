import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req); if ('response' in auth) return auth.response;
  const { id } = await ctx.params;
  try {
    const admin = getSupabaseAdmin();
    const [{ data: project, error: projectError }, { data: policy, error: policyError }, { data: settings }] = await Promise.all([
      admin.from('projects').select('id,user_id,url').eq('id', id).maybeSingle(),
      admin.from('admin_project_api_policies').select('api_mode_override').eq('project_id', id).maybeSingle(),
      admin.from('project_ai_settings').select('api_mode,settings').eq('project_id', id).maybeSingle(),
    ]);
    if (projectError) throw projectError;
    if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    if (policyError && !String(policyError.message || '').includes('does not exist')) throw policyError;
    const saved = settings?.api_mode || (settings?.settings as any)?.apiMode || 'platform';
    const rawServices = (settings?.settings as any)?.services || {};
    const n8nCredentials = Object.entries(rawServices).map(([service, row]: [string, any]) => ({ service, status: row?.n8nCredential?.status || (row?.apiKeyEncrypted ? 'manual_required' : 'not_configured'), name: row?.n8nCredential?.name || null, credentialId: row?.n8nCredential?.credentialId || null, credentialType: row?.n8nCredential?.credentialType || null, message: row?.n8nCredential?.message || null, updatedAt: row?.n8nCredential?.updatedAt || null })).filter((row: any) => row.status !== 'not_configured');
    const override = policy?.api_mode_override ?? null;
    return NextResponse.json({ project, override, effectiveMode: override || saved, n8nCredentials }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Unable to load project API policy.' }, { status: 503 }); }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req); if ('response' in auth) return auth.response;
  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  if (!body || ![null, 'platform', 'personal'].includes(body.apiModeOverride)) return NextResponse.json({ error: 'apiModeOverride must be platform, personal, or null (let the user choose).' }, { status: 400 });
  try {
    const admin = getSupabaseAdmin();
    const { data: project, error: projectError } = await admin.from('projects').select('id').eq('id', id).maybeSingle();
    if (projectError) throw projectError;
    if (!project) return NextResponse.json({ error: 'Project not found.' }, { status: 404 });
    const { error } = await admin.from('admin_project_api_policies').upsert({ project_id: id, api_mode_override: body.apiModeOverride, updated_at: new Date().toISOString(), updated_by: auth.user.id }, { onConflict: 'project_id' });
    if (error) throw error;
    const { data: savedSettings, error: settingsError } = await admin.from('project_ai_settings').select('api_mode,settings').eq('project_id', id).maybeSingle();
    if (settingsError) throw settingsError;
    const savedMode = savedSettings?.api_mode || (savedSettings?.settings as any)?.apiMode || 'platform';
    await admin.from('admin_audit_log').insert({ actor_user_id: auth.user.id, target_user_id: null, action: 'project_api_mode_policy_changed', details: { project_id: id, api_mode_override: body.apiModeOverride } });
    return NextResponse.json({ ok: true, apiModeOverride: body.apiModeOverride, effectiveMode: body.apiModeOverride || savedMode });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Unable to save project API policy.' }, { status: 503 }); }
}
