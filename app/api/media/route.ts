export const runtime = 'nodejs';
export const maxDuration = 300;

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import {
  apiGuard, assertServerEnv, errorMessage, n8nEndpoint, n8nHeaders,
  readJsonBody, fetchWithRetry, readResponseLimited, validateString
} from '@/lib/server';
import { getUserFromToken } from '@/lib/supabase';

const MEDIA_TIMEOUT_MS = 600_000;

export async function POST(req: NextRequest) {
  const limited = await apiGuard(req, { requireRedis: true, scope: 'media' });
  if (limited) return limited;

  const requestId = crypto.randomUUID();
  try {
    assertServerEnv();

    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
    if (!token || !(await getUserFromToken(token))) {
      return NextResponse.json({ error: 'Sign in to generate media.', code: 'AUTH_REQUIRED' }, { status: 401 });
    }

    const raw = await readJsonBody(req, 128 * 1024);
    const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

    const mediaType = String(body.media_type || body.mediaType || '').trim().toLowerCase();
    if (!['image', 'video'].includes(mediaType)) {
      return NextResponse.json({ error: 'media_type must be image or video.' }, { status: 400 });
    }

    const payload: Record<string, unknown> = {
      ...body,
      media_type: mediaType,
      card_id: validateString(body.card_id || body.cardId, 'card_id', 100),
      platform: validateString(body.platform, 'platform', 80),
      title: String(body.title || '').slice(0, 300),
      content: String(body.content || '').slice(0, 16000),
      prompt: String(body.prompt || body.visual_prompt || body.video_prompt || '').trim().slice(0, 8000),
      brand_theme: body.brand_theme && typeof body.brand_theme === 'object' ? body.brand_theme : {},
      include_logo: true,
    };

    if (!payload.prompt || String(payload.prompt).length < 10) {
      return NextResponse.json({ error: 'A usable media prompt is required.' }, { status: 400 });
    }

    const endpoint = n8nEndpoint(process.env.N8N_MEDIA_PATH || '');
    const timeout = Number(process.env.N8N_MEDIA_TIMEOUT_MS || MEDIA_TIMEOUT_MS);
    const response = await fetchWithRetry(
      endpoint,
      {
        method: 'POST',
        headers: n8nHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
        body: JSON.stringify(payload),
      },
      Number.isFinite(timeout) && timeout > 0 ? timeout : MEDIA_TIMEOUT_MS,
      0,
    );

    const rawBody = new TextDecoder().decode(await readResponseLimited(response, 2 * 1024 * 1024));
    let data: any = {};
    try { data = JSON.parse(rawBody); } catch { data = {}; }

    if (!response.ok || !data.success || !data.media_url) {
      const message = String(data.error || `Media generation failed (HTTP ${response.status}).`).replace(/[<>]/g, '').slice(0, 500);
      return NextResponse.json({ error: message, request_id: requestId }, { status: response.status >= 400 && response.status < 500 ? response.status : 502 });
    }

    const mediaUrl = String(data.media_url || '').trim();
    if (!/^https?:\/\//i.test(mediaUrl)) {
      return NextResponse.json({ error: 'The media service returned an invalid media URL.', request_id: requestId }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      media_url: mediaUrl,
      media_type: mediaType,
      request_id: requestId,
      provider_request_id: data.request_id || '',
      status: data.status || 'completed',
      card_id: payload.card_id,
    }, { headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId } });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/media' } });
    return NextResponse.json({ error: errorMessage(err, 'Media generation failed.'), request_id: requestId }, { status: 502 });
  }
}
