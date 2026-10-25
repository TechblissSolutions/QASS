export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getProject, getJob, updateJob } from '@/lib/supabase';
import { getEntitlementsForToken } from '@/lib/entitlements';
import { assertServerEnv } from '@/lib/env';
import { emailShell, escapeHtml, sendTransactionalEmail } from '@/lib/email-notifications';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function limitedRecord(value: unknown, maxBytes = 4 * 1024 * 1024): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const encoded = JSON.stringify(value);
  if (encoded.length > maxBytes) throw new Error('Generated content is too large to save.');
  return value;
}

export async function POST(req: NextRequest) {
  try {
    assertServerEnv();
    const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
    if (!token) return NextResponse.json({ error: 'Sign in to save generation history.' }, { status: 401 });

    const entitlement = await getEntitlementsForToken(token);
    if (!entitlement.user) return NextResponse.json({ error: 'Your session has expired. Please sign in again.' }, { status: 401 });

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const projectId = typeof body?.project_id === 'string' ? body.project_id : '';
    const jobRowId = typeof body?.job_row_id === 'string' ? body.job_row_id : '';
    if (!projectId || !jobRowId) return NextResponse.json({ error: 'project_id and job_row_id are required.' }, { status: 400 });

    const project = await getProject(projectId, token);
    if (!project) return NextResponse.json({ error: 'Company not found or not accessible.' }, { status: 404 });
    const job = await getJob(jobRowId, token);
    if (!job || job.project_id !== projectId) return NextResponse.json({ error: 'Generation job not found or not accessible.' }, { status: 404 });

    const patch: Record<string, unknown> = {};
    if ('sections' in (body || {})) patch.sections = limitedRecord(body?.sections);
    if ('schedule' in (body || {})) patch.schedule = limitedRecord(body?.schedule);
    if (typeof body?.job_id === 'string' || body?.job_id === null) patch.job_id = body.job_id;
    if (typeof body?.status === 'string') patch.status = body.status;
    if (typeof body?.finished_at === 'string' || body?.finished_at === null) patch.finished_at = body.finished_at;
    if (typeof body?.last_error === 'string' || body?.last_error === null) patch.last_error = body.last_error;

    const allowedStatuses = new Set(['starting', 'running', 'partial', 'completed', 'failed', 'cancelled']);
    if (typeof patch.status === 'string' && !allowedStatuses.has(patch.status)) {
      return NextResponse.json({ error: 'Invalid generation status.' }, { status: 400 });
    }
    if (!Object.keys(patch).length) return NextResponse.json({ ok: true });

    const updated = await updateJob(jobRowId, patch, token);
    if (!updated) return NextResponse.json({ error: 'Unable to save generation history.' }, { status: 500 });

    // Notify only on a transition into a terminal state, not on every autosave.
    const terminal = new Set(['completed', 'partial', 'failed', 'cancelled']);
    const nextStatus = typeof patch.status === 'string' ? patch.status : '';
    const previousStatus = String((job as any).status || '');
    if (nextStatus && terminal.has(nextStatus) && nextStatus !== previousStatus && entitlement.user.email) {
      const title = nextStatus === 'completed' ? 'Your QASS content is ready' : nextStatus === 'partial' ? 'Your QASS content is partially ready' : nextStatus === 'failed' ? 'Your QASS generation failed' : 'Your QASS generation was cancelled';
      const detail = nextStatus === 'completed'
        ? 'Your generated content is ready to review in QASS Studio and History.'
        : nextStatus === 'partial'
          ? 'Some generated content may be available. Review the job in QASS History.'
          : nextStatus === 'failed'
            ? 'QASS could not complete this generation. Open History to review the job and retry after checking your settings.'
            : 'This generation job was cancelled.';
      void sendTransactionalEmail(entitlement.user.email, title, emailShell(title, `<p>${escapeHtml(detail)}</p><p><b>Project:</b> ${escapeHtml(projectId)}<br><b>Job:</b> ${escapeHtml(jobRowId)}<br><b>Status:</b> ${escapeHtml(nextStatus)}</p><p>Open QASS to review the job.</p>`)).catch(() => undefined);
    }
    return NextResponse.json({ ok: true, job: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to save generation history.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
