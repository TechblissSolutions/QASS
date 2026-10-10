export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/supabase';
import { oauthUrl, providerConfigured, signState, type SocialProvider } from '@/lib/scheduling';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import crypto from 'node:crypto';

const allowed = new Set<SocialProvider>(['instagram','facebook','linkedin','x','youtube','wordpress']);

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: raw } = await params;
  if (!allowed.has(raw as SocialProvider)) return NextResponse.json({ error: 'Unsupported social provider.' }, { status: 400 });
  const provider = raw as SocialProvider;
  if (!providerConfigured(provider)) return NextResponse.json({ error: 'This social provider is not configured yet.' }, { status: 400 });
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const user = await getUserFromToken(token).catch(() => null);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const projectId = new URL(req.url).searchParams.get('project');
  if (!projectId || !/^[0-9a-f-]{36}$/i.test(projectId)) return NextResponse.json({ error: 'A valid company is required.' }, { status: 400 });
  const admin = getSupabaseAdmin();
  const { data: project, error } = await admin.from('projects').select('id').eq('id', projectId).eq('user_id', user.id).maybeSingle();
  if (error || !project) return NextResponse.json({ error: 'Company not found or access denied.' }, { status: 404 });
  const requestUrl = new URL(req.url);
  const base = process.env.NEXT_PUBLIC_APP_URL || requestUrl.origin;
  const redirectUri = `${base}/api/scheduling/oauth/callback/${provider}`;
  const verifier = crypto.randomBytes(32).toString('base64url');
  const requestedReturn = requestUrl.searchParams.get('returnTo') || '/profile';
  // OAuth redirects may only return to these app-local routes.
  const returnTo = requestedReturn.startsWith('/analyse?new=1') || requestedReturn.startsWith('/profile') ? requestedReturn : '/profile';
  const state = signState({ userId: user.id, projectId, provider, verifier, returnTo });
  try {
    return NextResponse.json({ url: oauthUrl(provider, state, redirectUri, verifier) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: 'Unable to start authorization. Check server OAuth configuration.' }, { status: 500 });
  }
}
