export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { apiGuard, assertServerEnv, fetchWithRetry, isN8nErrorHtml, validateString, sanitizeHtml, n8nHeaders, n8nEndpoint, verifyLiveViewToken, errorMessage, readResponseLimited } from '@/lib/server';
import { getJobByExternalId, getUserFromToken } from '@/lib/supabase';

export async function GET(req: NextRequest) {
  const requestId = crypto.randomUUID();
  const limited = await apiGuard(req, { rateLimit: 120, scope: 'live-view' }); if (limited) return limited;
  try {
    assertServerEnv();
    const jobId = validateString(req.nextUrl.searchParams.get('job_id'), 'job_id', 200, true);
    const section = validateString(req.nextUrl.searchParams.get('section'), 'section', 50, true);
    if (!/^[a-zA-Z0-9_-]+$/.test(jobId) || !/^[a-zA-Z0-9_-]+$/.test(section)) throw new Error('Invalid polling parameters.');

    const liveToken = req.headers.get('x-sparrow-live-token')?.trim();
    const bearer = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
    if (!liveToken && !bearer) return NextResponse.json({ error: 'This generation is not accessible.', request_id: requestId }, { status: 401 });
    const tokenPayload = liveToken ? verifyLiveViewToken(liveToken, jobId) : null;
    if (liveToken && !tokenPayload) return NextResponse.json({ error: 'This generation link has expired or is invalid.', request_id: requestId }, { status: 403 });

    // Authenticated jobs bind the signed live-view capability to the user.
    // Require the caller's current Supabase session to match that identity.
    if (tokenPayload?.userId) {
      if (!bearer) return NextResponse.json({ error: 'Authentication is required for this generation.', request_id: requestId }, { status: 401 });
      const user = await getUserFromToken(bearer);
      if (!user || user.id !== tokenPayload.userId) return NextResponse.json({ error: 'This generation is not accessible.', request_id: requestId }, { status: 403 });
    } else if (!liveToken && bearer) {
      const ownedJob = await getJobByExternalId(jobId, bearer);
      if (!ownedJob) return NextResponse.json({ error: 'This generation is not accessible.', request_id: requestId }, { status: 403 });
    }

    const params = new URLSearchParams({ job_id: jobId, section });
    for (const key of ['primary', 'secondary', 'background', 'text']) {
      const value = req.nextUrl.searchParams.get(key);
      if (value && /^#[0-9a-f]{6}$/i.test(value)) params.set(key, value);
    }
    const endpoint = `${n8nEndpoint(process.env.N8N_LIVE_VIEW_PATH!)}?${params.toString()}`;
    const res = await fetchWithRetry(endpoint, { headers: n8nHeaders() }, 15_000, 1);
    const html = new TextDecoder().decode(await readResponseLimited(res, 3 * 1024 * 1024));
    if (!res.ok || isN8nErrorHtml(html)) {
      const detail = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400);
      Sentry.captureMessage('n8n live-view response was not usable yet', { level: 'warning', tags: { area: 'n8n', operation: 'live_view', request_id: requestId, job_id: jobId, section }, extra: { status: res.status, detail } });
      return new NextResponse('', { status: 200, headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId, 'X-Sparrow-Live-Status': 'pending' } });
    }
    // n8n answers with a "waiting" shell (meta refresh + .waiting card) until the section file exists.
    if (/http-equiv=["']?refresh/i.test(html) || /class=["'][^"']*\bwaiting\b/i.test(html)) {
      return new NextResponse('', { status: 200, headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId, 'X-Sparrow-Live-Status': 'pending' } });
    }
    if (!html.trim()) return new NextResponse('', { status: 200, headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId, 'X-Sparrow-Live-Status': 'pending' } });
    return new NextResponse(sanitizeHtml(html), { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Request-ID': requestId } });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/live-view' } });
    const message = errorMessage(err, 'Live content is temporarily unavailable.');
    return NextResponse.json({ error: message, request_id: requestId }, { status: 502, headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId } });
  }
}
