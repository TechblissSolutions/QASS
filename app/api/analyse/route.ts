export const runtime = 'nodejs';
export const maxDuration = 300;

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { apiGuard, assertServerEnv, assertPublicHttpUrl, botGuard, fetchWithRetry, validateUrl, websiteCacheGet, websiteCacheSet, n8nHeaders, n8nEndpoint, readJsonBody, readResponseLimited, errorMessage } from '@/lib/server';
import { getProjectByUrl, countProjects, updateProject } from '@/lib/supabase';
import { createProjectWithLimit } from '@/lib/supabase-admin';
import { getEntitlementsForToken } from '@/lib/entitlements';

function decodeHtml(value: string) {
  return value.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').trim();
}

function analysisField(html: string, name: string, fallback = '') {
  const safeName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const open = new RegExp(`<([a-z0-9]+)\\b[^>]*\\bname=["']${safeName}["'][^>]*>`, 'i').exec(html);
  if (!open) return fallback;
  const tag = open[0];
  const tagName = open[1].toLowerCase();
  if (tagName === 'textarea') return decodeHtml(new RegExp(`<textarea\\b[^>]*\\bname=["']${safeName}["'][^>]*>([\\s\\S]*?)<\\/textarea>`, 'i').exec(html)?.[1] || fallback);
  if (tagName === 'select') {
    const content = new RegExp(`<select\\b[^>]*\\bname=["']${safeName}["'][^>]*>([\\s\\S]*?)<\\/select>`, 'i').exec(html)?.[1] || '';
    const selected = /<option[^>]*selected[^>]*>([\s\S]*?)<\/option>/i.exec(content)?.[1] || /<option[^>]*>([\s\S]*?)<\/option>/i.exec(content)?.[1] || fallback;
    return decodeHtml(selected);
  }
  return decodeHtml(/\bvalue=["']([^"']*)["']/i.exec(tag)?.[1] || fallback);
}

function extractAnalysisProfile(html: string, url: string) {
  const profile = {
    company_name: analysisField(html, 'company_name'), company_website: analysisField(html, 'company_website', url),
    company_summary: analysisField(html, 'company_summary'), company_details: analysisField(html, 'company_details'),
    target_audience: analysisField(html, 'target_audience'), company_research: analysisField(html, 'company_research'),
    product_options: [...html.matchAll(/<option[^>]*value=["']([^"']+)["'][^>]*>/gi)].map(match => decodeHtml(match[1])).filter(Boolean), product: analysisField(html, 'product_or_service'),
  };
  return profile.company_name || profile.company_summary ? profile : null;
}

export async function POST(req: NextRequest) {
  const rid = crypto.randomUUID();
  const t0 = Date.now();
  const limited = await apiGuard(req, { rateLimit: 10, requireRedis: true, scope: 'analyse' }); if (limited) return limited;
  const bot = botGuard(req); if (bot) return bot;
  try {
    assertServerEnv();
    const data = await readJsonBody(req, 16 * 1024) as { url?: unknown };
    const url = await assertPublicHttpUrl(validateUrl(data?.url));
    const accessToken = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || undefined;
    if (!accessToken) return NextResponse.json({ error: 'Sign in to analyse a company website.', code: 'AUTH_REQUIRED' }, { status: 401, headers: { 'X-Request-ID': rid } });
    let entitlement: Awaited<ReturnType<typeof getEntitlementsForToken>> | null = null;
    let existingProjectId: string | null = null;
    if (accessToken) {
      entitlement = await getEntitlementsForToken(accessToken);
      if (!entitlement.user) throw new Error('Your session has expired. Please sign in again.');
      const existing = await getProjectByUrl(url, accessToken);
      existingProjectId = existing?.id || null;

      // Fail before calling the expensive analysis workflow when a new company
      // would exceed the user's plan. The database RPC remains authoritative
      // and closes the final concurrency/race-condition window.
      if (!existingProjectId && entitlement.maxCompanies !== null) {
        const count = await countProjects(accessToken);
        if (count >= entitlement.maxCompanies) {
          return NextResponse.json({
            error: 'You have reached the company limit for your current plan. Upgrade to add another company.',
            code: 'PLAN_LIMIT',
            feature: 'multiple_companies'
          }, { status: 402, headers: { 'X-Request-ID': rid } });
        }
      }
    }
    let html = websiteCacheGet(url);
    const cacheHit = Boolean(html);
    if (!html) {
      const boundary = '----SparrowFormBoundary' + crypto.randomUUID().replace(/-/g, '');
      const body = `--${boundary}\r\nContent-Disposition: form-data; name="field-0"\r\n\r\n${url}\r\n--${boundary}--\r\n`;
      const endpoint = n8nEndpoint(process.env.N8N_ANALYSE_PATH!);
      const res = await fetchWithRetry(endpoint, { method: 'POST', body, headers: n8nHeaders({ 'Content-Type': `multipart/form-data; boundary=${boundary}` }) }, 120_000, 0);
      html = new TextDecoder().decode(await readResponseLimited(res, 5 * 1024 * 1024));
      if (!res.ok) {
        throw new Error('The analysis service is temporarily unavailable. Please try again.');
      }
      websiteCacheSet(url, html);
    }
    const analyzedProfile = extractAnalysisProfile(html, url);

    let projectId: string | null = existingProjectId;
    if (accessToken && entitlement?.user && !projectId) {
      try {
        const project = await createProjectWithLimit(url, analyzedProfile, null, null, entitlement.user.id, entitlement.maxCompanies);
        projectId = project?.id || null;
      } catch (dbError) {
        const message = errorMessage(dbError, 'Unable to save this company.');
        if (/PLAN_LIMIT|company limit/i.test(message)) return NextResponse.json({ error: 'You have reached the company limit for your current plan. Upgrade to add another company.', code: 'PLAN_LIMIT', feature: 'multiple_companies' }, { status: 402 });
        Sentry.captureException(dbError, { tags: { area: 'supabase', operation: 'create_project' } });
        throw new Error('Unable to save this company right now. Please retry.');
      }
    } else if (accessToken && projectId && analyzedProfile) {
      await updateProject(projectId, { profile: analyzedProfile }, accessToken);
    }

    return NextResponse.json({ html, projectId }, { headers: { 'Cache-Control': 'private, no-store', 'X-Cache': cacheHit ? 'HIT' : 'MISS', 'X-Request-ID': rid } });
  } catch (err) {
    const message = errorMessage(err, 'Analysis failed.');
    const status = /session has expired|sign in/i.test(message) ? 401 : /valid URL|private|missing required|invalid/i.test(message) ? 400 : /plan|company limit/i.test(message) ? 402 : 502;
    if (status >= 500) Sentry.captureException(err, { tags: { route: '/api/analyse', request_id: rid } });
    return NextResponse.json({ error: message, request_id: rid }, { status, headers: { 'X-Request-ID': rid } });
  }
}
