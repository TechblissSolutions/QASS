export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { getEntitlementsForToken } from '@/lib/entitlements';
import { createProjectWithLimit } from '@/lib/supabase-admin';
import { normaliseUrl } from '@/lib/utils';

export async function POST(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  try {
    const ent = await getEntitlementsForToken(token);
    if (!ent.user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const url = normaliseUrl(String(body.url || ''));
    if (!url) return NextResponse.json({ error: 'Enter a valid company website.' }, { status: 400 });
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return NextResponse.json({ error: 'Enter a valid public website URL.' }, { status: 400 });
    // Reserve the company row before OAuth so every connection is attached to a stable project ID.
    // Passing null profile/prefs/theme preserves existing company data on duplicate URLs.
    const project = await createProjectWithLimit(url, null, null, null, ent.user.id, ent.maxCompanies);
    if (!project?.id) throw new Error('Unable to save the company workspace.');
    return NextResponse.json({ projectId: project.id, url: project.url }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (e) {
    const message = e instanceof Error && /PLAN_LIMIT|company limit/i.test(e.message)
      ? 'You have reached the company limit for your current plan. Upgrade to add another company.'
      : 'Unable to save this company workspace. Please retry.';
    return NextResponse.json({ error: message }, { status: /company limit/i.test(message) ? 402 : 500 });
  }
}
