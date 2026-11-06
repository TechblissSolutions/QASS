import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { apiGuard } from '@/lib/server';
import { getOrCreateTrialVisitor, getTrialIdentity, releaseTrialClaim, setTrialCookie, trialWasUsed } from '@/lib/free-trial-server';

export const runtime = 'nodejs';
const STALE_PENDING_MS = 5 * 60 * 1000;

export async function GET(req: NextRequest) {
  const limited = await apiGuard(req, { rateLimit: 30, requireRedis: true, scope: 'free-trial-session' });
  if (limited) return limited;

  const identity = getTrialIdentity(req);
  try {
    const { admin, visitor } = await getOrCreateTrialVisitor(identity.visitorHash);
    const stalePendingBefore = new Date(Date.now() - STALE_PENDING_MS).toISOString();
    const [{ data: generations, error: generationError }, { data: lead, error: leadError }, ...latestAttempts] = await Promise.all([
      admin.from('free_trial_generations')
        .select('generation_type, generated_content, created_at')
        .eq('visitor_id', visitor.id)
        .eq('status', 'success')
        .order('created_at', { ascending: false })
        .limit(2),
      admin.from('marketing_leads')
        .select('id')
        .eq('visitor_id', visitor.id)
        .limit(1)
        .maybeSingle(),
      ...(['linkedin', 'blog'] as const).map((type) => admin.from('free_trial_generations')
        .select('id, status, created_at')
        .eq('visitor_id', visitor.id)
        .eq('generation_type', type)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()),
    ]);
    if (generationError) throw generationError;
    if (leadError) throw leadError;

    const visitorUpdatedAt = Date.parse(visitor.updated_at);
    const visitorClaimIsStale = Number.isFinite(visitorUpdatedAt) && Date.now() - visitorUpdatedAt >= STALE_PENDING_MS;
    for (const [index, type] of (['linkedin', 'blog'] as const).entries()) {
      const { data: latestAttempt, error: latestAttemptError } = latestAttempts[index] as {
        data: { id: string; status: string; created_at: string } | null;
        error: Error | null;
      };
      if (latestAttemptError) throw latestAttemptError;
      const usedColumn = type === 'linkedin' ? 'linkedin_used' : 'blog_used';
      if (!visitor[usedColumn]) continue;

      let recoverClaim = !latestAttempt && visitorClaimIsStale;
      if (latestAttempt?.status === 'failed') recoverClaim = true;
      if (latestAttempt?.status === 'pending' && latestAttempt.created_at < stalePendingBefore) {
        const { data: failed, error: failError } = await admin.from('free_trial_generations').update({ status: 'failed' })
          .eq('id', latestAttempt.id).eq('status', 'pending').select('id').maybeSingle();
        if (failError) throw failError;
        recoverClaim = Boolean(failed);
      }
      if (!recoverClaim) continue;

      const { data: successfulType, error: successfulTypeError } = await admin.from('free_trial_generations')
        .select('id').eq('visitor_id', visitor.id).eq('generation_type', type).eq('status', 'success').limit(1).maybeSingle();
      if (successfulTypeError) throw successfulTypeError;
      if (!successfulType) await releaseTrialClaim(visitor.id, type);
    }

    const generation = generations?.[0] || null;

    const { data: refreshedVisitor, error: refreshedError } = await admin.from('free_trial_visitors')
      .select('credits_total, credits_remaining, linkedin_used, blog_used').eq('id', visitor.id).single();
    if (refreshedError) throw refreshedError;
    visitor.credits_total = refreshedVisitor.credits_total;
    visitor.credits_remaining = refreshedVisitor.credits_remaining;
    visitor.linkedin_used = refreshedVisitor.linkedin_used;
    visitor.blog_used = refreshedVisitor.blog_used;

    const used = trialWasUsed(visitor);
    const response = NextResponse.json({
      success: true,
      credits_total: visitor.credits_total,
      credits_remaining: visitor.credits_remaining,
      used,
      linkedin_used: visitor.linkedin_used,
      blog_used: visitor.blog_used,
      used_type: visitor.linkedin_used ? 'linkedin' : visitor.blog_used ? 'blog' : null,
      generation: generation ? {
        type: generation.generation_type,
        content: generation.generated_content || '',
        created_at: generation.created_at,
      } : null,
      generations: (generations || []).map((item) => ({
        type: item.generation_type,
        content: item.generated_content || '',
        created_at: item.created_at,
      })),
      lead_submitted: Boolean(lead),
    }, { headers: { 'Cache-Control': 'no-store' } });
    return setTrialCookie(response, identity.token, identity.needsCookie);
  } catch (error) {
    Sentry.captureException(error, { tags: { route: '/api/free-trial/session' } });
    const response = NextResponse.json({ error: 'Unable to check your trial status. Please refresh and try again.' }, { status: 503 });
    return setTrialCookie(response, identity.token, identity.needsCookie);
  }
}
