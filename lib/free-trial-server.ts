import 'server-only';

import { createHash, randomBytes } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { getSupabaseAdmin } from '@/lib/supabase-admin';

export const FREE_TRIAL_COOKIE = 'sparrow_free_trial';
const COOKIE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function getTrialIdentity(req: NextRequest) {
  const incoming = req.cookies.get(FREE_TRIAL_COOKIE)?.value || '';
  const token = COOKIE_PATTERN.test(incoming) ? incoming : randomBytes(32).toString('base64url');
  const visitorHash = createHash('sha256').update(token).digest('hex');
  return { token, visitorHash, needsCookie: token !== incoming };
}

export function setTrialCookie(response: NextResponse, token: string, needsCookie: boolean) {
  if (!needsCookie) return response;
  response.cookies.set(FREE_TRIAL_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}

export async function getOrCreateTrialVisitor(visitorHash: string) {
  const admin = getSupabaseAdmin();
  const { error: upsertError } = await admin
    .from('free_trial_visitors')
    .upsert({ visitor_hash: visitorHash }, { onConflict: 'visitor_hash', ignoreDuplicates: true });
  if (upsertError) throw upsertError;

  const { data, error } = await admin
    .from('free_trial_visitors')
    .select('id, credits_total, credits_remaining, linkedin_used, blog_used, updated_at')
    .eq('visitor_hash', visitorHash)
    .single();
  if (error || !data) throw error || new Error('Unable to load free-trial status.');
  return { admin, visitor: data };
}

export function trialWasUsed(visitor: { credits_remaining: number; linkedin_used: boolean; blog_used: boolean }) {
  return visitor.linkedin_used || visitor.blog_used || visitor.credits_remaining <= 0;
}

export function trialTypeWasUsed(visitor: { credits_remaining: number; linkedin_used: boolean; blog_used: boolean }, type: 'linkedin' | 'blog') {
  return visitor.credits_remaining < 50 || visitor[`${type}_used`];
}

export async function releaseTrialClaim(visitorId: string, type: 'linkedin' | 'blog') {
  const admin = getSupabaseAdmin();
  const { error: releaseError } = await admin.rpc('release_free_trial_claim', {
    p_visitor_id: visitorId,
    p_generation_type: type,
    p_credit_cost: 50,
  });
  if (!releaseError) return;

  Sentry.captureException(releaseError, { tags: { area: 'free_trial', operation: 'release_claim_fallback' } });
  const usedColumn = type === 'linkedin' ? 'linkedin_used' : 'blog_used';
  const success = await admin.from('free_trial_generations')
    .select('id')
    .eq('visitor_id', visitorId)
    .eq('generation_type', type)
    .eq('status', 'success')
    .limit(1)
    .maybeSingle();
  if (success.error) {
    throw new Error(`Free-trial claim release RPC failed (${releaseError.message}); success check failed (${success.error.message}).`);
  }
  if (success.data) return;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: visitor, error: visitorError } = await admin.from('free_trial_visitors')
      .select('credits_total, credits_remaining, linkedin_used, blog_used')
      .eq('id', visitorId)
      .single();
    if (visitorError || !visitor) {
      throw new Error(`Free-trial claim release RPC failed (${releaseError.message}); visitor lookup failed (${visitorError?.message || 'no visitor row'}).`);
    }
    if (!visitor[usedColumn]) return;

    const creditsRemaining = Number(visitor.credits_remaining);
    const creditsTotal = Number(visitor.credits_total);
    const nextCredits = Math.min(creditsTotal, creditsRemaining + 50);
    const { data: released, error: fallbackError } = await admin.from('free_trial_visitors').update({
      [usedColumn]: false,
      credits_remaining: nextCredits,
      updated_at: new Date().toISOString(),
    })
      .eq('id', visitorId)
      .eq(usedColumn, true)
      .eq('credits_remaining', creditsRemaining)
      .select('id')
      .maybeSingle();
    if (fallbackError) {
      throw new Error(`Free-trial claim release RPC failed (${releaseError.message}); fallback update failed (${fallbackError.message}).`);
    }
    if (released) return;
  }

  throw new Error(`Free-trial claim release could not be confirmed after the RPC failed (${releaseError.message}).`);
}
