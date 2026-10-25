import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requireAdmin } from '@/lib/admin-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ('response' in auth) return auth.response;
  try {
    const { data, error } = await getSupabaseAdmin().from('admin_feature_flags').select('key,label,description,enabled,updated_at').order('sort_order');
    if (error) throw error;
    return NextResponse.json({ features: data || [] }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return NextResponse.json({ error: 'Feature flags are not ready. Run supabase_admin_dashboard.sql in Supabase first.' }, { status: 503 }); }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ('response' in auth) return auth.response;
  try {
    const body = await req.json();
    if (typeof body.key !== 'string' || typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'A feature key and enabled boolean are required.' }, { status: 400 });
    const { data, error } = await getSupabaseAdmin().from('admin_feature_flags').update({ enabled: body.enabled, updated_at: new Date().toISOString(), updated_by: auth.user.id }).eq('key', body.key).select('key,label,description,enabled,updated_at').single();
    if (error || !data) return NextResponse.json({ error: 'Could not update feature. Check that the admin migration has been run.' }, { status: 503 });
    return NextResponse.json({ feature: data }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return NextResponse.json({ error: 'Invalid feature update.' }, { status: 400 }); }
}
