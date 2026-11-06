import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { STYLES } from '@/lib/constants';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { getOrCreateTrialVisitor, getTrialIdentity, releaseTrialClaim, setTrialCookie, trialTypeWasUsed } from '@/lib/free-trial-server';
import {
  apiGuard,
  errorMessage,
  fetchWithRetry,
  n8nEndpoint,
  n8nHeaders,
  readJsonBody,
  readResponseLimited,
  validateString,
} from '@/lib/server';

export const runtime = 'nodejs';
export const maxDuration = 180;

type JsonRecord = Record<string, unknown>;

function normalizeUsage(value: unknown): { prompt_tokens: number | null; completion_tokens: number | null; total_tokens: number | null } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const usage = value as JsonRecord;
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      if (usage[key] === null || usage[key] === undefined || usage[key] === '') continue;
      const count = Number(usage[key]);
      if (Number.isInteger(count) && count >= 0) return count;
    }
    return null;
  };
  const normalized = {
    prompt_tokens: pick('prompt_tokens', 'promptTokens', 'input_tokens'),
    completion_tokens: pick('completion_tokens', 'completionTokens', 'output_tokens'),
    total_tokens: pick('total_tokens', 'totalTokens'),
  };
  if (normalized.total_tokens === null && normalized.prompt_tokens !== null && normalized.completion_tokens !== null) {
    normalized.total_tokens = normalized.prompt_tokens + normalized.completion_tokens;
  }
  return Object.values(normalized).some((count) => count !== null) ? normalized : null;
}

function readUsage(value: unknown, key: 'prompt_tokens' | 'completion_tokens' | 'total_tokens') {
  return normalizeUsage(value)?.[key] ?? null;
}

function getPublishableContent(value: unknown) {
  let content = typeof value === 'string' ? value.trim() : '';
  const readyToPublish = content.match(/(?:^|\n)#{1,6}\s*Ready[- ]to[- ]Publish Content\s*\n([\s\S]*?)(?=\n#{1,6}\s*(?:Publishing Details|Review Notes)\b|$)/i);
  if (readyToPublish?.[1].trim()) content = readyToPublish[1].trim();
  else content = content.replace(/\n#{1,6}\s*(?:Publishing Details|Review Notes)\b[\s\S]*$/i, '').trim();
  return content
    .replace(/^\s*(?:CONTENT_FORMAT|MEDIA_TYPE|CONTENT_ANGLE|MEDIA_DURATION_SECONDS|MEDIA_SCENE_COUNT)\s*[:\-].*$/gmi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isCompleteBlog(content: string) {
  if (!/^#\s+\S.*/m.test(content)) return false;
  const conclusion = /^#{1,6}\s+conclusion\b[^\r\n]*\r?\n([\s\S]*)$/im.exec(content)?.[1]?.trim();
  if (!conclusion) return false;
  const blocks = conclusion.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  const finalBlock = blocks[blocks.length - 1] || '';
  const wordCount = finalBlock.match(/\b[\p{L}\p{N}'’-]+\b/gu)?.length || 0;
  const endsCleanly = /[.!?]["'’”)\]]*$/.test(finalBlock);
  const isCallToAction = /^(?:>\s*)?(?:CTA\s*:\s*)?(?:try|start|explore|contact|book|join|download|sign up|schedule|request|learn more|choose|take)\b/i.test(finalBlock);
  return endsCleanly && (wordCount >= 10 || (isCallToAction && wordCount >= 4));
}

const GOALS = new Set(['Brand / Product Awareness', 'Engagement']);
const TONES = new Set(['Professional', 'Friendly']);

export async function POST(req: NextRequest) {
  const limited = await apiGuard(req, { rateLimit: 12, requireRedis: true, scope: 'free-trial-generation' });
  if (limited) return limited;

  const requestId = crypto.randomUUID();
  const identity = getTrialIdentity(req);
  let visitorId = '';
  let pendingGenerationId = '';
  let reservedType = '';
  let creditsBeforeReservation = 0;
  let claimReleased = true;

  try {
    const authHeaderName = process.env.N8N_FREE_TRIAL_AUTH_HEADER?.trim() || 'X-Sparrow-Trial-Key';
    const authHeaderValue = process.env.N8N_FREE_TRIAL_AUTH_VALUE?.trim();
    if (!authHeaderValue) throw new Error('Free-trial webhook authentication is not configured on the server.');
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(authHeaderName)) {
      throw new Error('Free-trial webhook authentication header is invalid.');
    }
    const path = process.env.N8N_FREE_TRIAL_PATH?.trim() || '/webhook/sparrow-free-trial-generate';
    const endpoint = n8nEndpoint(path);
    const timeoutValue = Number(process.env.N8N_FREE_TRIAL_TIMEOUT_MS || 170_000);
    const timeout = Number.isFinite(timeoutValue) && timeoutValue > 0 ? timeoutValue : 170_000;

    const raw = await readJsonBody(req, 16 * 1024);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return NextResponse.json({ error: 'Invalid free-trial request.' }, { status: 400 });
    }

    const body = raw as JsonRecord;
    const generationType = validateString(body.generation_type, 'generation_type', 20, true).toLowerCase();
    if (!['linkedin', 'blog'].includes(generationType)) {
      return NextResponse.json({ error: 'Choose LinkedIn or Blog generation.' }, { status: 400 });
    }

    const contentGoal = validateString(body.content_goal, 'content_goal', 100, true);
    const brandTone = validateString(body.brand_tone, 'brand_tone', 40, true);
    const writingStyle = validateString(body.writing_style, 'writing_style', 150, true);
    if (!GOALS.has(contentGoal)) return NextResponse.json({ error: 'Choose a supported content goal.' }, { status: 400 });
    if (!TONES.has(brandTone)) return NextResponse.json({ error: 'Choose a supported brand tone.' }, { status: 400 });
    if (!(STYLES as readonly string[]).includes(writingStyle)) {
      return NextResponse.json({ error: 'Choose a supported writing style.' }, { status: 400 });
    }

    const topic = validateString(body.topic, 'topic', 1000, true);
    const targetAudience = validateString(body.target_audience, 'target_audience', 1000, true);
    const additionalInstructions = validateString(body.additional_instructions, 'additional_instructions', 2000);
    const keywords = validateString(body.keywords, 'keywords', 1000);
    const companyName = validateString(body.company_name, 'company_name', 200);
    const companyWebsite = validateString(body.company_website, 'company_website', 500);
    const companySummary = validateString(body.company_summary, 'company_summary', 2000);
    const companyResearch = validateString(body.company_research, 'company_research', 4000);
    const productOrService = validateString(body.product_or_service, 'product_or_service', 1000);
    const companyContext = companyResearch || companySummary;
    const payload = {
      generation_type: generationType,
      topic,
      target_audience: targetAudience,
      content_goal: contentGoal,
      brand_tone: brandTone,
      writing_style: writingStyle,
      additional_instructions: additionalInstructions,
      keywords,
      company_name: companyName,
      company_website: companyWebsite,
      company_research: companyContext,
      product_or_service: productOrService,
    };

    const { admin, visitor } = await getOrCreateTrialVisitor(identity.visitorHash);
    visitorId = visitor.id;
    if (trialTypeWasUsed(visitor, generationType as 'linkedin' | 'blog')) {
      const response = NextResponse.json({
        error: `Your free ${generationType === 'linkedin' ? 'LinkedIn' : 'Blog'} generation has been used. Sign up to generate more and explore Sparrow.`,
        code: 'TRIAL_TYPE_USED',
        generation_type: generationType,
      }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
      return setTrialCookie(response, identity.token, identity.needsCookie);
    }

    reservedType = generationType;
    creditsBeforeReservation = visitor.credits_remaining;
    const usedColumn = generationType === 'linkedin' ? 'linkedin_used' : 'blog_used';
    claimReleased = false;
    const claim = await admin.from('free_trial_visitors').update({
      [usedColumn]: true,
      credits_remaining: creditsBeforeReservation - 50,
      updated_at: new Date().toISOString(),
    })
      .eq('id', visitor.id)
      .eq(usedColumn, false)
      .eq('credits_remaining', creditsBeforeReservation)
      .gte('credits_remaining', 50)
      .select('id')
      .maybeSingle();
    if (claim.error) throw claim.error;
    if (!claim.data) {
      const response = NextResponse.json({
        error: `Your free ${generationType === 'linkedin' ? 'LinkedIn' : 'Blog'} generation could not be reserved. Refresh your trial status and retry.`,
        code: 'TRIAL_RESERVATION_CONFLICT',
        generation_type: generationType,
        signup_url: '/signup',
      }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
      return setTrialCookie(response, identity.token, identity.needsCookie);
    }

    const { data: generation, error: insertError } = await admin.from('free_trial_generations').insert({
      visitor_id: visitor.id,
      generation_type: generationType,
      status: 'pending',
    }).select('id').single();
    if (insertError || !generation) throw insertError || new Error('Unable to reserve the trial generation.');
    pendingGenerationId = generation.id;

    // If a failure cannot be recorded, the session endpoint recovers stale pending claims.
    const headers = n8nHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' });
    headers[authHeaderName] = authHeaderValue;
    const upstream = await fetchWithRetry(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    }, Number.isFinite(timeout) && timeout > 0 ? timeout : 170_000, 0);

    const responseContentType = upstream.headers.get('content-type') || 'unknown content type';
    const responseText = new TextDecoder().decode(await readResponseLimited(upstream, 512 * 1024));
    let result: unknown;
    try {
      result = JSON.parse(responseText.replace(/^\uFEFF/, '').trim());
    } catch {
      const detail = `The trial webhook returned HTTP ${upstream.status} with ${responseContentType}, not JSON.`;
      const nextStep = upstream.status === 404
        ? 'Confirm the workflow is active in n8n and the app uses its production webhook URL.'
        : upstream.status === 403
          ? 'Confirm the free-trial webhook URL is correct and no upstream proxy is rejecting it; webhook authentication is intentionally deferred during testing.'
          : 'Check the latest n8n execution for this webhook.';
      Sentry.captureMessage('Trial webhook returned a non-JSON response', {
        level: 'error',
        tags: { route: '/api/free-trial/generate', upstream_status: String(upstream.status) },
        extra: { content_type: responseContentType, response_preview: responseText.replace(/\s+/g, ' ').slice(0, 300), request_id: requestId },
      });
      throw new Error(`${detail} ${nextStep} Request ID: ${requestId}.`);
    }

    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error('The trial workflow returned an unexpected response.');
    }

    const data = result as JsonRecord;
    const content = getPublishableContent(data.content);
    if (!upstream.ok || data.success !== true || !content) {
      const message = typeof data.error === 'string' ? data.error.slice(0, 500) : `Trial generation failed (HTTP ${upstream.status}).`;
      throw new Error(message);
    }
    if (generationType === 'blog' && !isCompleteBlog(content)) {
      throw new Error('The Blog draft appears incomplete. Your free try was restored; please retry.');
    }

    const { data: savedGeneration, error: saveGenerationError } = await admin.from('free_trial_generations').update({
      generated_content: content.slice(0, 100_000),
      credits_used: 50,
      prompt_tokens: readUsage(data.usage, 'prompt_tokens'),
      completion_tokens: readUsage(data.usage, 'completion_tokens'),
      total_tokens: readUsage(data.usage, 'total_tokens'),
      usage_metadata_available: Boolean(normalizeUsage(data.usage)),
      status: 'success',
    }).eq('id', pendingGenerationId).eq('status', 'pending').select('id').maybeSingle();
    if (saveGenerationError) throw saveGenerationError;
    if (!savedGeneration) throw new Error('The generated draft could not be saved. Please contact support before retrying.');

    const response = NextResponse.json({
      success: true,
      generation_type: generationType,
      content: content.slice(0, 100_000),
      credits_cost: 50,
      usage: normalizeUsage(data.usage),
      usage_metadata_available: Boolean(normalizeUsage(data.usage)),
      ...(typeof data.publishing_details === 'string' && data.publishing_details.trim()
        ? { publishing_details: data.publishing_details.trim().slice(0, 10_000) }
        : {}),
      ...(typeof data.review_notes === 'string' && data.review_notes.trim()
        ? { review_notes: data.review_notes.trim().slice(0, 10_000) }
        : {}),
      request_id: requestId,
    }, { headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId } });
    return setTrialCookie(response, identity.token, identity.needsCookie);
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/free-trial/generate' } });
    const message = errorMessage(err, 'Trial generation failed. Please retry.');
    const status = /webhook authentication (?:is not configured|header is invalid)/i.test(message)
      ? 503
      : /required|invalid|must be|too large|unsupported|choose/i.test(message) ? 400 : 502;

    if (pendingGenerationId) {
      try {
        const admin = getSupabaseAdmin();
        const { data: failed } = await admin.from('free_trial_generations').update({ status: 'failed' })
          .eq('id', pendingGenerationId).eq('status', 'pending').select('id').maybeSingle();
        if (failed && visitorId) {
          await releaseTrialClaim(visitorId, reservedType as 'linkedin' | 'blog');
          claimReleased = true;
        }
      } catch (cleanupError) {
        Sentry.captureException(cleanupError, { tags: { route: '/api/free-trial/generate', operation: 'release_trial_claim' } });
      }
    } else if (visitorId && reservedType) {
      try {
        await releaseTrialClaim(visitorId, reservedType as 'linkedin' | 'blog');
        claimReleased = true;
      } catch (cleanupError) {
        Sentry.captureException(cleanupError, { tags: { route: '/api/free-trial/generate', operation: 'release_trial_claim' } });
      }
    }

    const trialConsumed = Boolean(visitorId && !claimReleased);
    const response = NextResponse.json({
      error: trialConsumed
        ? `We could not confirm the ${reservedType} result, so that generation is reserved to prevent a duplicate. Refresh to check for a saved draft. Your other trial format remains available if credits remain.`
        : message,
      ...(trialConsumed ? { code: 'TRIAL_GENERATION_RESERVED', generation_type: reservedType, signup_url: '/signup' } : {}),
      request_id: requestId,
    }, {
      status: trialConsumed ? 409 : status,
      headers: { 'Cache-Control': 'no-store', 'X-Request-ID': requestId },
    });
    return setTrialCookie(response, identity.token, identity.needsCookie);
  }
}
