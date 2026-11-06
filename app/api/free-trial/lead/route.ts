import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { apiGuard, errorMessage, readJsonBody, validateString } from '@/lib/server';
import { getOrCreateTrialVisitor, getTrialIdentity, setTrialCookie, trialWasUsed } from '@/lib/free-trial-server';

export const runtime = 'nodejs';

type JsonRecord = Record<string, unknown>;

export async function POST(req: NextRequest) {
  const limited = await apiGuard(req, { rateLimit: 8, requireRedis: true, scope: 'free-trial-lead' });
  if (limited) return limited;

  const identity = getTrialIdentity(req);
  try {
    const raw = await readJsonBody(req, 16 * 1024);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return setTrialCookie(NextResponse.json({ error: 'Invalid lead form submission.' }, { status: 400 }), identity.token, identity.needsCookie);
    }
    const body = raw as JsonRecord;
    const name = validateString(body.name, 'name', 200, true);
    const email = validateString(body.email, 'email', 320, true).toLowerCase();
    const companyName = validateString(body.company_name, 'company_name', 200, true);
    const phone = validateString(body.phone, 'phone', 80);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return setTrialCookie(NextResponse.json({ error: 'Enter a valid work email address.' }, { status: 400 }), identity.token, identity.needsCookie);
    }

    const { admin, visitor } = await getOrCreateTrialVisitor(identity.visitorHash);
    if (!trialWasUsed(visitor)) {
      return setTrialCookie(NextResponse.json({ error: 'Generate your free trial draft before submitting your details.' }, { status: 409 }), identity.token, identity.needsCookie);
    }

    const { data: generated, error: generationError } = await admin
      .from('free_trial_generations')
      .select('id')
      .eq('visitor_id', visitor.id)
      .eq('status', 'success')
      .limit(1)
      .maybeSingle();
    if (generationError) throw generationError;
    if (!generated) {
      return setTrialCookie(NextResponse.json({ error: 'Your generated draft could not be found. Generate a draft before submitting your details.' }, { status: 409 }), identity.token, identity.needsCookie);
    }

    const { data: existingLead, error: existingError } = await admin
      .from('marketing_leads')
      .select('id')
      .eq('visitor_id', visitor.id)
      .limit(1)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existingLead) {
      return setTrialCookie(NextResponse.json({ success: true, lead_submitted: true }, { headers: { 'Cache-Control': 'no-store' } }), identity.token, identity.needsCookie);
    }

    const { error: insertError } = await admin.from('marketing_leads').insert({
      visitor_id: visitor.id,
      name,
      email,
      company_name: companyName,
      phone: phone || null,
      marketing_consent: body.marketing_consent === true,
    });
    if (insertError) throw insertError;

    return setTrialCookie(NextResponse.json({ success: true, lead_submitted: true }, { headers: { 'Cache-Control': 'no-store' } }), identity.token, identity.needsCookie);
  } catch (error) {
    Sentry.captureException(error, { tags: { route: '/api/free-trial/lead' } });
    const message = errorMessage(error, 'Unable to save your details. Please retry.');
    const status = /required|invalid|must be|too large/i.test(message) ? 400 : 503;
    const response = NextResponse.json({ error: message, request_id: crypto.randomUUID() }, { status, headers: { 'Cache-Control': 'no-store' } });
    return setTrialCookie(response, identity.token, identity.needsCookie);
  }
}
