export const runtime = 'nodejs';
export const maxDuration = 300;

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import {
  apiGuard, assertPublicHttpUrl, assertServerEnv, errorMessage, n8nEndpoint, n8nHeaders,
  readJsonBody, fetchWithRetry, readResponseLimited, validateString
} from '@/lib/server';
import { getProject, getUserFromToken } from '@/lib/supabase';
import { checkFeatureGate } from '@/lib/admin-auth';

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
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return NextResponse.json({ error: 'Invalid media request.' }, { status: 400 });
    }
    const body = raw as Record<string, unknown>;

    const mediaType = String(body.media_type || body.mediaType || '').trim().toLowerCase();
    if (!['image', 'video'].includes(mediaType)) {
      return NextResponse.json({ error: 'media_type must be image or video.' }, { status: 400 });
    }

    const defaultAction = `create_${mediaType}`;
    const mediaAction = String(body.media_action || body.action || defaultAction)
      .trim().toLowerCase().replace(/[\s-]+/g, '_');
    const allowedActions = new Set([
      'create_image', 'create_video', 'image_to_video', 'url_to_image',
      'url_to_video', 'image_variation', 'video_variation', 'image_carousel',
    ]);
    const imageActions = new Set(['create_image', 'url_to_image', 'image_variation', 'image_carousel']);
    const videoActions = new Set(['create_video', 'url_to_video', 'image_to_video', 'video_variation']);
    if (!allowedActions.has(mediaAction) ||
        (mediaType === 'image' && !imageActions.has(mediaAction)) ||
        (mediaType === 'video' && !videoActions.has(mediaAction))) {
      return NextResponse.json({ error: 'media_action is not supported for this media type.' }, { status: 400 });
    }

    const projectId = validateString(body.project_id, 'project_id', 80);
    if (projectId) {
      if (!/^[0-9a-f-]{36}$/i.test(projectId) || !(await getProject(projectId, token))) {
        return NextResponse.json({ error: 'Company not found or not accessible.' }, { status: 404 });
      }
    }

    const optionalPublicHttpsUrl = async (value: unknown, name: string) => {
      if (value == null || value === '') return '';
      const url = await assertPublicHttpUrl(validateString(value, name, 2048, true));
      if (new URL(url).protocol !== 'https:') throw new Error(`${name} must use HTTPS.`);
      return url;
    };
    let sourceUrl = '';
    let sourceImageUrl = '';
    try {
      sourceUrl = await optionalPublicHttpsUrl(body.source_url || body.url, 'source_url');
      sourceImageUrl = await optionalPublicHttpsUrl(body.source_image_url || body.image_url, 'source_image_url');
    } catch (err) {
      return NextResponse.json({ error: errorMessage(err, 'Source URL must be a public HTTPS URL.') }, { status: 400 });
    }
    if (['url_to_image', 'url_to_video'].includes(mediaAction) && !sourceUrl) {
      return NextResponse.json({ error: `${mediaAction} requires a public HTTPS source_url.` }, { status: 400 });
    }
    if (mediaAction === 'image_to_video' && !sourceImageUrl) {
      return NextResponse.json({ error: 'image_to_video requires a public HTTPS source_image_url.' }, { status: 400 });
    }

    const payload: Record<string, unknown> = {
      ...body,
      media_type: mediaType,
      media_action: mediaAction,
      card_id: validateString(body.card_id || body.cardId, 'card_id', 100),
      platform: validateString(body.platform || `${mediaType} Studio`, 'platform', 80, true),
      title: validateString(body.title, 'title', 300),
      content: validateString(body.content, 'content', 16000),
      prompt: String(body.prompt || body.visual_prompt || body.video_prompt || '').trim().slice(0, 8000),
      brand_theme: body.brand_theme && typeof body.brand_theme === 'object' ? body.brand_theme : {},
      ...(sourceUrl ? { source_url: sourceUrl } : {}),
      ...(sourceImageUrl ? { source_image_url: sourceImageUrl } : {}),
      include_logo: true,
    };

    const variationCount = Number(body.variation_count ?? body.slide_count ?? 1);
    const variationIndex = Number(body.variation_index ?? 1);
    if (!Number.isInteger(variationCount) || variationCount < 1 || variationCount > 6 ||
        !Number.isInteger(variationIndex) || variationIndex < 1 || variationIndex > variationCount) {
      return NextResponse.json({ error: 'variation_count must be 1–6 and variation_index must be within that count.' }, { status: 400 });
    }
    payload.variation_count = variationCount;
    payload.variation_index = variationIndex;

    if (!payload.prompt || String(payload.prompt).length < 10) {
      return NextResponse.json({ error: 'A usable media prompt is required.' }, { status: 400 });
    }

    const featureBlock = await checkFeatureGate(req, 'media_generation');
    if (featureBlock) return featureBlock;

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
