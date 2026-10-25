
export const runtime = 'nodejs';
export const maxDuration = 300;

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import * as Sentry from '@sentry/nextjs';
import {
  apiGuard,
  assertServerEnv,
  assertPublicHttpUrl,
  botGuard,
  fetchWithRetry,
  validateUrl,
  websiteCacheGet,
  websiteCacheSet,
  n8nHeaders,
  n8nEndpoint,
  readJsonBody,
  readResponseLimited,
  errorMessage,
} from '@/lib/server';
import {
  getProjectByUrl,
  countProjects,
  updateProject,
  getSupabaseClient,
} from '@/lib/supabase';
import { createProjectWithLimit } from '@/lib/supabase-admin';
import { getEntitlementsForToken } from '@/lib/entitlements';
import { checkFeatureGate } from '@/lib/admin-auth';

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function analysisField(html: string, name: string, fallback = '') {
  const safeName = escapeRegExp(name);

  const open = new RegExp(
    `<([a-z0-9]+)\\b[^>]*\\bname=["']${safeName}["'][^>]*>`,
    'i',
  ).exec(html);

  if (!open) return fallback;

  const tag = open[0];
  const tagName = open[1].toLowerCase();

  if (tagName === 'textarea') {
    const match = new RegExp(
      `<textarea\\b[^>]*\\bname=["']${safeName}["'][^>]*>([\\s\\S]*?)<\\/textarea>`,
      'i',
    ).exec(html);

    return decodeHtml(match?.[1] || fallback);
  }

  if (tagName === 'select') {
    const content =
      new RegExp(
        `<select\\b[^>]*\\bname=["']${safeName}["'][^>]*>([\\s\\S]*?)<\\/select>`,
        'i',
      ).exec(html)?.[1] || '';

    const selected =
      /<option\b[^>]*\bselected\b[^>]*>([\s\S]*?)<\/option>/i.exec(content)?.[1] ||
      /<option\b[^>]*>([\s\S]*?)<\/option>/i.exec(content)?.[1] ||
      fallback;

    return decodeHtml(selected);
  }

  return decodeHtml(/\bvalue=["']([^"']*)["']/i.exec(tag)?.[1] || fallback);
}

function extractAnalysisProfile(html: string, url: string) {
  const profile = {
    company_name: analysisField(html, 'company_name'),
    company_website: analysisField(html, 'company_website', url),
    company_summary: analysisField(html, 'company_summary'),
    company_details: analysisField(html, 'company_details'),
    target_audience: analysisField(html, 'target_audience'),
    company_research: analysisField(html, 'company_research'),
    product_options: [
      ...html.matchAll(/<option\b[^>]*value=["']([^"']+)["'][^>]*>/gi),
    ]
      .map((match) => decodeHtml(match[1]))
      .filter(Boolean),
    product: analysisField(html, 'product_or_service'),
  };

  return profile.company_name || profile.company_summary ? profile : null;
}

function isValidProjectId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

export async function POST(req: NextRequest) {
  const rid = crypto.randomUUID();
  const limited = await apiGuard(req, {
    rateLimit: 10,
    requireRedis: true,
    scope: 'analyse',
  });

  if (limited) return limited;

  const bot = botGuard(req);
  if (bot) return bot;

  try {
    assertServerEnv();

    const data = (await readJsonBody(req, 16 * 1024)) as {
      url?: unknown;
      socialHandles?: unknown;
    };

    const url = await assertPublicHttpUrl(validateUrl(data?.url));

    const featureBlock = await checkFeatureGate(req, 'website_analysis');
    if (featureBlock) return featureBlock;

    const socialHandles =
      data?.socialHandles &&
      typeof data.socialHandles === 'object' &&
      !Array.isArray(data.socialHandles)
        ? Object.fromEntries(
            Object.entries(data.socialHandles as Record<string, unknown>)
              .filter(
                ([key, value]) =>
                  [
                    'instagram',
                    'facebook',
                    'linkedin',
                    'x',
                    'youtube',
                    'wordpress',
                  ].includes(key) &&
                  typeof value === 'string' &&
                  value.trim(),
              )
              .map(([key, value]) => [
                key,
                String(value).trim().slice(0, 500),
              ]),
          )
        : {};

    const accessToken =
      req.headers
        .get('authorization')
        ?.replace(/^Bearer\s+/i, '')
        .trim() || undefined;

    if (!accessToken) {
      return NextResponse.json(
        {
          error: 'Sign in to analyse a company website.',
          code: 'AUTH_REQUIRED',
        },
        { status: 401, headers: { 'X-Request-ID': rid } },
      );
    }

    const entitlement = await getEntitlementsForToken(accessToken);

    if (!entitlement.user) {
      throw new Error('Your session has expired. Please sign in again.');
    }

    const userClient = getSupabaseClient(accessToken);

    if (!userClient) {
      throw new Error('Supabase is not configured.');
    }

    let project = await getProjectByUrl(url, accessToken);
    let projectId: string | null = project?.id || null;

    // Never call the analysis workflow without the canonical company UUID.
    if (projectId && !isValidProjectId(projectId)) {
      throw new Error(
        'The existing company has an invalid project ID. Please refresh your session and retry.',
      );
    }

    // Check AI mode for existing companies before using Sparrow AI.
    if (projectId) {
      const { data: aiSettings, error: aiSettingsError } = await userClient
        .from('project_ai_settings')
        .select('api_mode, settings')
        .eq('project_id', projectId)
        .maybeSingle();

      if (aiSettingsError) {
        throw new Error(
          'Unable to verify this company’s AI mode. Analysis was stopped to prevent using the wrong AI provider.',
        );
      }

      const { data: modePolicy, error: modePolicyError } = await getSupabaseAdmin()
        .from('admin_project_api_policies').select('api_mode_override').eq('project_id', projectId).maybeSingle();
      if (modePolicyError) throw new Error('Unable to verify administrator API-mode policy. Analysis was stopped. Run the admin dashboard migration.');
      const mode = modePolicy?.api_mode_override || aiSettings?.api_mode ||
        (aiSettings?.settings as Record<string, unknown> | null)?.apiMode;

      if (mode === 'personal') {
        return NextResponse.json(
          {
            error:
              'This company is set to Use My Own APIs. Personal-provider analysis is not wired to the current n8n workflow yet, so the request was blocked rather than falling back to Sparrow AI.',
            code: 'PERSONAL_PROVIDER_NOT_WIRED',
          },
          {
            status: 501,
            headers: { 'X-Request-ID': rid },
          },
        );
      }
    }

    // Enforce company limits before creating a new company.
    if (!projectId && entitlement.maxCompanies !== null) {
      const count = await countProjects(accessToken);

      if (count >= entitlement.maxCompanies) {
        return NextResponse.json(
          {
            error:
              'You have reached the company limit for your current plan. Upgrade to add another company.',
            code: 'PLAN_LIMIT',
            feature: 'multiple_companies',
          },
          {
            status: 402,
            headers: { 'X-Request-ID': rid },
          },
        );
      }
    }

    /*
     * IMPORTANT:
     * Create the company before calling n8n.
     * projectId must be public.projects.id, never a session ID.
     */
    if (!projectId) {
      try {
        project = await createProjectWithLimit(
          url,
          null,
          null,
          null,
          entitlement.user.id,
          entitlement.maxCompanies,
        );

        projectId = project?.id || null;
      } catch (dbError) {
        const message = errorMessage(
          dbError,
          'Unable to create this company.',
        );

        if (/PLAN_LIMIT|company limit/i.test(message)) {
          return NextResponse.json(
            {
              error:
                'You have reached the company limit for your current plan. Upgrade to add another company.',
              code: 'PLAN_LIMIT',
              feature: 'multiple_companies',
            },
            { status: 402, headers: { 'X-Request-ID': rid } },
          );
        }

        Sentry.captureException(dbError, {
          tags: {
            area: 'supabase',
            operation: 'create_project',
          },
        });

        throw new Error('Unable to create this company right now. Please retry.');
      }
    }

    if (!projectId || !isValidProjectId(projectId)) {
      throw new Error(
        'The company was not assigned a valid public.projects.id UUID. Analysis was stopped.',
      );
    }

    // Cache entries contain analysis HTML, not a company-specific project ID.
    // Reuse cached analysis where available, but always save against this project.
    let html = websiteCacheGet(url);
    const cacheHit = Boolean(html);

    if (!html) {
      const boundary =
        '----SparrowFormBoundary' + crypto.randomUUID().replace(/-/g, '');

      // Preserve the existing n8n website field and include the canonical UUID
      // in both the multipart form and query string for compatibility.
      const fields: Record<string, string> = {
        'field-0': url,
        project_id: projectId,
      };

      const body = Object.entries(fields)
        .map(
          ([name, value]) =>
            `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        )
        .join('') + `--${boundary}--\r\n`;

      const endpoint = n8nEndpoint(process.env.N8N_ANALYSE_PATH!);
      const separator = endpoint.includes('?') ? '&' : '?';
      const requestUrl =
        `${endpoint}${separator}project_id=${encodeURIComponent(projectId)}`;

      const res = await fetchWithRetry(
        requestUrl,
        {
          method: 'POST',
          body,
          headers: n8nHeaders({
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
          }),
        },
        120_000,
        0,
      );

      html = new TextDecoder().decode(
        await readResponseLimited(res, 5 * 1024 * 1024),
      );

      if (!res.ok) {
        throw new Error(
          'The analysis service is temporarily unavailable. Please try again.',
        );
      }

      websiteCacheSet(url, html);
    }

    const analyzedProfile = extractAnalysisProfile(html, url);

    // Save analysis results against the UUID created/resolved above.
    if (analyzedProfile) {
      await updateProject(
        projectId,
        {
          profile: {
            ...analyzedProfile,
            ...(Object.keys(socialHandles).length
              ? { social_handles: socialHandles }
              : {}),
          },
        },
        accessToken,
      );
    } else if (Object.keys(socialHandles).length) {
      // Preserve social handles even if the returned HTML has no parseable profile.
      await updateProject(
        projectId,
        {
          profile: {
            social_handles: socialHandles,
            company_website: url,
          },
        },
        accessToken,
      );
    }

    return NextResponse.json(
      {
        html,
        projectId,
        project_id: projectId,
      },
      {
        headers: {
          'Cache-Control': 'private, no-store',
          'X-Cache': cacheHit ? 'HIT' : 'MISS',
          'X-Request-ID': rid,
        },
      },
    );
  } catch (err) {
    const message = errorMessage(err, 'Analysis failed.');

    const status =
      /session has expired|sign in/i.test(message)
        ? 401
        : /valid URL|private|missing required|invalid/i.test(message)
          ? 400
          : /plan|company limit/i.test(message)
            ? 402
            : 502;

    if (status >= 500) {
      Sentry.captureException(err, {
        tags: {
          route: '/api/analyse',
          request_id: rid,
        },
      });
    }

    return NextResponse.json(
      {
        error: message,
        request_id: rid,
      },
      {
        status,
        headers: { 'X-Request-ID': rid },
      },
    );
  }
}
