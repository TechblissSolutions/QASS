export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { connectProvider, verifyState, type SocialProvider } from '@/lib/scheduling';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

const allowed = new Set<SocialProvider>(['instagram','facebook','linkedin','x','youtube','wordpress']);
function safeReturnTo(value: unknown) {
  const path = typeof value === 'string' ? value : '/profile';
  if (path.startsWith('/profile') || path.startsWith('/analyse?new=1')) return path;
  return '/profile';
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider: raw } = await params;
  const url = new URL(req.url);
  const base = process.env.NEXT_PUBLIC_APP_URL || url.origin;
  const code = url.searchParams.get('code');
  const stateRaw = url.searchParams.get('state');
  if (!allowed.has(raw as SocialProvider)) return NextResponse.redirect(`${base}/profile?social_error=Unsupported%20provider`);
  if (!stateRaw) return NextResponse.redirect(`${base}/profile?social_error=OAuth%20state%20was%20missing`);
  let returnTo = '/profile';
  let projectId = '';
  try {
    const state = verifyState(stateRaw);
    if (state.provider !== raw || typeof state.userId !== 'string' || typeof state.projectId !== 'string') throw new Error('Invalid OAuth state.');
    returnTo = safeReturnTo(state.returnTo);
    projectId = state.projectId;
    if (!code) throw new Error('OAuth was cancelled.');
    const admin = getSupabaseAdmin();
    const { data: project, error } = await admin.from('projects').select('id').eq('id', projectId).eq('user_id', state.userId).maybeSingle();
    if (error || !project) throw new Error('Company access could not be verified.');
    const redirectUri = `${base}/api/scheduling/oauth/callback/${raw}`;
    await connectProvider(raw as SocialProvider, code, redirectUri, projectId, state.userId, typeof state.verifier === 'string' ? state.verifier : undefined);
    const separator = returnTo.includes('?') ? '&' : '?';
    return NextResponse.redirect(`${base}${returnTo}${separator}project=${encodeURIComponent(projectId)}&social_connected=${encodeURIComponent(raw)}`);
  } catch {
    const separator = returnTo.includes('?') ? '&' : '?';
    return NextResponse.redirect(`${base}${returnTo}${separator}project=${encodeURIComponent(projectId)}&social_error=Unable%20to%20complete%20social%20authorization`);
  }
}
