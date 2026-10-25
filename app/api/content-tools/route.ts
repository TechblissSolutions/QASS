export const runtime = 'nodejs';
export const maxDuration = 300;

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { checkFeatureGate } from '@/lib/admin-auth';
import {
  apiGuard,
  assertPublicHttpUrl,
  assertServerEnv,
  errorMessage,
  fetchWithRetry,
  n8nEndpoint,
  n8nHeaders,
  readJsonBody,
  readResponseLimited,
  validateString,
} from '@/lib/server';
import { getProject, getUserFromToken } from '@/lib/supabase';

const ACTIONS = new Set([
  'email_swipe',
  'email_variations',
  'email_clone',
  'url_to_email',
  'translate_email',
]);

type JsonRecord = Record<string, unknown>;

export async function POST(req: NextRequest) {
  const limited = await apiGuard(req, { requireRedis: true, scope: 'content-tools' });
  if (limited) return limited;

  const requestId = crypto.randomUUID();
  try {
    assertServerEnv();

    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
    if (!token || !(await getUserFromToken(token))) {
      return NextResponse.json({ error: 'Sign in to use Email Studio.', code: 'AUTH_REQUIRED' }, { status: 401 });
    }

    const raw = await readJsonBody(req, 64 * 1024);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return NextResponse.json({ error: 'Invalid content-tools request.' }, { status: 400 });
    }
    const body = raw as JsonRecord;
    const action = validateString(body.action || body.operation, 'action', 40, true)
      .toLowerCase().replace(/[\s-]+/g, '_');
    if (!ACTIONS.has(action)) {
      return NextResponse.json({ error: 'Unsupported email action.' }, { status: 400 });
    }

    const emailRequired = ['email_swipe', 'email_variations', 'email_clone', 'translate_email'].includes(action);
    const email = validateString(body.email || body.email_content || body.content, 'email', 30000, emailRequired);
    const decision = validateString(body.decision || body.swipe_action, 'decision', 20).toLowerCase();
    if (action === 'email_swipe' && !['save', 'discard'].includes(decision)) {
      return NextResponse.json({ error: 'Choose save or discard for this email.' }, { status: 400 });
    }

    const targetLanguage = validateString(body.target_language || body.language, 'target_language', 100, action === 'translate_email');
    const sourceInput = validateString(body.source_url || body.url, 'source_url', 2048, action === 'url_to_email');
    let sourceUrl = '';
    if (sourceInput) {
      try {
        sourceUrl = await assertPublicHttpUrl(sourceInput);
      } catch (err) {
        return NextResponse.json({ error: errorMessage(err, 'source_url must be a public HTTPS URL.') }, { status: 400 });
      }
      if (new URL(sourceUrl).protocol !== 'https:') {
        return NextResponse.json({ error: 'source_url must use HTTPS.' }, { status: 400 });
      }
    }

    const countValue = body.count == null ? 3 : Number(body.count);
    if (!Number.isInteger(countValue) || countValue < 2 || countValue > 8) {
      return NextResponse.json({ error: 'Email variation count must be between 2 and 8.' }, { status: 400 });
    }

    const projectId = validateString(body.project_id, 'project_id', 80);
    if (projectId && (!/^[0-9a-f-]{36}$/i.test(projectId) || !(await getProject(projectId, token)))) {
      return NextResponse.json({ error: 'Company not found or not accessible.' }, { status: 404 });
    }

    const emailId = validateString(body.email_id || body.card_id, 'email_id', 200);
    const featureBlock = await checkFeatureGate(req, 'generation');
    if (featureBlock) return featureBlock;

    const payload = {
      action,
      email,
      decision,
      email_id: emailId,
      source_url: sourceUrl,
      target_language: targetLanguage,
      subject: validateString(body.subject, 'subject', 500),
      target_audience: validateString(body.target_audience || body.audience, 'target_audience', 2000),
      tone: validateString(body.tone || body.brand_tone, 'tone', 500),
      count: countValue,
      instructions: validateString(body.instructions, 'instructions', 4000),
      project_id: projectId,
    };

    const contentToolsPath = process.env.N8N_CONTENT_TOOLS_PATH?.trim();
    if (!contentToolsPath) {
      return NextResponse.json({ error: 'Email tools are not configured. Set N8N_CONTENT_TOOLS_PATH on the server.', request_id: requestId }, { status: 503 });
    }
    const endpoint = n8nEndpoint(contentToolsPath);
    const timeout = Number(process.env.N8N_CONTENT_TOOLS_TIMEOUT_MS || 120_000);
    const response = await fetchWithRetry(endpoint, {
      method: 'POST',
      headers: n8nHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }),
      body: JSON.stringify(payload),
    }, Number.isFinite(timeout) && timeout > 0 ? timeout : 120_000, 0);

    const text = new TextDecoder().decode(await readResponseLimited(response, 1024 * 1024));
    let result: unknown;
    try { result = JSON.parse(text); } catch {
      return NextResponse.json({ error: 'The content workflow returned an unreadable response.', request_id: requestId }, { status: 502 });
    }
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      return NextResponse.json({ error: 'The content workflow returned an unexpected response.', request_id: requestId }, { status: 502 });
    }

    const data = result as JsonRecord;
    if (!response.ok || data.success === false) {
      const message = typeof data.error === 'string' ? data.error.slice(0, 500) : `Email generation failed (HTTP ${response.status}).`;
      const status = response.status >= 400 && response.status < 500 ? response.status : 502;
      return NextResponse.json({ error: message, request_id: requestId }, { status, headers: { 'Cache-Control': 'no-store' } });
    }

    return NextResponse.json(data, {
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
    });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/content-tools' } });
    return NextResponse.json({ error: errorMessage(err, 'Email tools are temporarily unavailable.'), request_id: requestId }, {
      status: 502,
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
    });
  }
}