export const runtime = 'nodejs';

export const maxDuration = 300;

import { NextRequest, NextResponse } from 'next/server';

import * as Sentry from '@sentry/nextjs';

import {
  apiGuard,
  assertServerEnv,
  assertPublicHttpUrl,
  fetchWithRetry,
  validateGeneratePayload,
  withGenerationSlot,
  withUserGenerationQuota,
  isN8nErrorHtml,
  validateString,
  n8nHeaders,
  n8nEndpoint,
  readJsonBody,
  readResponseLimited,
  createLiveViewToken,
  errorMessage,
  checkGenerationDedup,
} from '@/lib/server';

import {
  createJob,
  getProject,
  updateJob,
} from '@/lib/supabase';

import { getEntitlementsForToken } from '@/lib/entitlements';

export async function POST(req: NextRequest) {
  const requestId = crypto.randomUUID();

  const limited = await apiGuard(req, {
    requireRedis: true,
    scope: 'generate',
  });

  if (limited) return limited;

  let jobRowId: string | null = null;
  let accessToken: string | undefined;
  let authenticatedUserId: string | null = null;

  try {
    assertServerEnv();

    /*
     * Validate the request body before authentication.
     *
     * This ensures malformed requests return HTTP 400 instead
     * of being incorrectly reported as HTTP 401.
     */
    const raw = await readJsonBody(req, 256 * 1024);

    const data = validateGeneratePayload(raw);

    const projectId = validateString(
      (raw as Record<string, unknown> | null)?.project_id,
      'project_id',
      80
    );

    /*
     * Authentication remains mandatory before any protected
     * generation/database/n8n operation.
     */
    const authHeader = req.headers
      .get('authorization')
      ?.replace(/^Bearer\s+/i, '')
      .trim();

    if (!authHeader) {
      return NextResponse.json(
        {
          error: 'Sign in to generate content.',
          code: 'AUTH_REQUIRED',
        },
        {
          status: 401,
        }
      );
    }

    accessToken = authHeader;

    let entitlement:
      Awaited<
        ReturnType<typeof getEntitlementsForToken>
      > | null = null;

    if (accessToken) {
      entitlement =
        await getEntitlementsForToken(accessToken);

      if (!entitlement.user) {
        throw new Error(
          'Your session has expired. Please sign in again.'
        );
      }

      authenticatedUserId = entitlement.user.id;
    }

    if (!entitlement?.user || !authenticatedUserId) {
      throw new Error(
        'Your session has expired. Please sign in again.'
      );
    }

    if (!projectId) {
      throw new Error(
        'A saved company is required for generation.'
      );
    }

    data.company_website =
      await assertPublicHttpUrl(data.company_website);

    if (data.regenerate) {
      if (!accessToken || !entitlement?.user) {
        throw new Error(
          'Sign in to regenerate content.'
        );
      }

      const ent = entitlement;

      if (!ent.canRegenerate) {
        return NextResponse.json(
          {
            error:
              'Regeneration is a Pro feature. Upgrade your plan to create improved versions.',
            code: 'PREMIUM_REQUIRED',
            feature: 'regeneration',
          },
          {
            status: 402,
          }
        );
      }

      if (!projectId) {
        throw new Error(
          'A saved company is required for regeneration.'
        );
      }

      const ownedProject = await getProject(
        projectId,
        accessToken
      );

      if (!ownedProject) {
        return NextResponse.json(
          {
            error:
              'Company not found or not accessible.',
            code: 'NOT_FOUND',
          },
          {
            status: 404,
          }
        );
      }
    }

    if (
      projectId &&
      !/^[0-9a-f-]{36}$/i.test(projectId)
    ) {
      throw new Error('Invalid project_id.');
    }

    // Phase 6: Prevent duplicate generation from double-clicks
    if (accessToken && projectId) {
      const userId =
        authenticatedUserId ||
        accessToken.slice(0, 16);

      if (
        !(await checkGenerationDedup(
          userId,
          projectId
        ))
      ) {
        return NextResponse.json(
          {
            error:
              'A generation was just started for this company. Please wait a moment.',
            code: 'DUPLICATE_REQUEST',
          },
          {
            status: 429,
            headers: {
              'X-Request-ID': requestId,
            },
          }
        );
      }
    }

    const ownedProject = await getProject(
      projectId,
      accessToken
    );

    if (!ownedProject) {
      return NextResponse.json(
        {
          error:
            'Company not found or not accessible.',
          code: 'NOT_FOUND',
        },
        {
          status: 404,
        }
      );
    }

    try {
      const job = await createJob(
        projectId,
        new Date().toISOString(),
        accessToken
      );

      if (!job) {
        throw new Error(
          'Unable to create the generation job.'
        );
      }

      jobRowId = job.id;

      if (jobRowId) {
        await updateJob(
          jobRowId,
          {
            request_id: requestId,
            last_error: null,
          },
          accessToken
        );
      }
    } catch (dbError) {
      Sentry.captureException(dbError, {
        tags: {
          area: 'supabase',
          operation: 'create_job',
        },
      });

      throw new Error(
        'Unable to save the generation job. Your generation was not started. Please retry.'
      );
    }

    const result =
      await withUserGenerationQuota(
        authenticatedUserId,
        entitlement.plan,
        () =>
          withGenerationSlot(async () => {
            if (jobRowId) {
              await updateJob(
                jobRowId,
                {
                  status: 'running',
                },
                accessToken
              ).catch((err) =>
                Sentry.captureException(err, {
                  tags: {
                    area: 'supabase',
                    operation: 'start_job',
                  },
                })
              );
            }

            const params = new URLSearchParams();

            const regenerationExtra = data.regenerate
              ? [
                  data.extra,
                  `REGENERATION MODE: Create a materially improved new version of the content. Do not copy the previous output verbatim. Improve clarity, hooks, structure, platform fit, specificity and usefulness while preserving verified company facts.
PREVIOUS GENERATED CONTENT:
${data.previous_content}`,
                ]
                  .filter(Boolean)
                  .join('\n\n')
              : data.extra;

            params.append(
              'company_name',
              data.company_name
            );

            params.append(
              'company_website',
              data.company_website
            );

            params.append(
              'company_summary',
              data.company_summary
            );

            params.append(
              'company_details',
              data.company_details
            );

            params.append(
              'target_audience',
              data.target_audience
            );

            params.append(
              'company_research',
              data.company_research
            );

            params.append(
              'product_or_service',
              data.product
            );

            params.append(
              'content_goal',
              data.goal
            );

            params.append(
              'brand_tone',
              data.tone
            );

            params.append(
              'content_style_inspiration',
              data.style
            );

            /*
             * The n8n workflow is intentionally responsible
             * for its fixed output quantity.
             *
             * Do not send a content-count parameter or ask
             * n8n to generate a specific number.
             */

            params.append(
              'additional_instructions',
              regenerationExtra
            );

            data.platforms.forEach((pl) =>
  params.append('social_media_platforms', pl)
);

params.append(
  'selected_content_types',
  data.platforms.join(',')
);
            const endpoint = n8nEndpoint(
              process.env.N8N_GENERATE_PATH!
            );

            const generateTimeoutMs = Number(
              process.env.N8N_GENERATE_TIMEOUT_MS ||
                300_000
            );

            const res = await fetchWithRetry(
              endpoint,
              {
                method: 'POST',
                body: params,
                headers: n8nHeaders({
                  'Content-Type':
                    'application/x-www-form-urlencoded',
                }),
              },
              Number.isFinite(
                generateTimeoutMs
              ) && generateTimeoutMs > 0
                ? generateTimeoutMs
                : 300_000,
              0
            );

            const rawBody =
              new TextDecoder().decode(
                await readResponseLimited(
                  res,
                  5 * 1024 * 1024
                )
              );

            if (
              !res.ok ||
              isN8nErrorHtml(rawBody)
            ) {
              const upstreamDetail =
                rawBody
                  .replace(
                    /<[^>]+>/g,
                    ' '
                  )
                  .replace(/\s+/g, ' ')
                  .trim()
                  .slice(0, 500);

              Sentry.captureMessage(
                'n8n content-generation response was not usable',
                {
                  level: 'error',
                  tags: {
                    area: 'n8n',
                    operation: 'generate',
                    request_id: requestId,
                  },
                  extra: {
                    status: res.status,
                    detail: upstreamDetail,
                  },
                }
              );

              if (res.status === 404) {
                const configuredPath =
                  process.env.N8N_GENERATE_PATH ||
                  '';

                throw new Error(
                  `n8n generation webhook returned 404. Check that N8N_GENERATE_PATH is the active production webhook path (${configuredPath}). Request ${requestId.slice(0, 8)}.`
                );
              }

              throw new Error(
                `Content generation failed on the workflow server (HTTP ${res.status}, request ${requestId.slice(0, 8)}). Please retry.`
              );
            }

            let parsed: unknown = null;

            try {
              parsed = JSON.parse(rawBody);
            } catch {
              /* n8n may return HTML/text */
            }

            /*
             * n8n can serialize a webhook response as an
             * object, a one-item array, or a nested
             * data/result/body object.
             */
            const firstString = (
              keys: string[]
            ): string => {
              const seen = new Set<unknown>();

              const walk = (
                value: unknown,
                depth = 0
              ): string => {
                if (
                  depth > 6 ||
                  value == null ||
                  seen.has(value)
                ) {
                  return '';
                }

                if (typeof value === 'string') {
                  return value;
                }

                if (
                  typeof value !== 'object'
                ) {
                  return '';
                }

                seen.add(value);

                if (Array.isArray(value)) {
                  for (
                    const item of value
                  ) {
                    const found = walk(
                      item,
                      depth + 1
                    );

                    if (found) return found;
                  }

                  return '';
                }

                const obj =
                  value as Record<
                    string,
                    unknown
                  >;

                for (const key of keys) {
                  if (
                    typeof obj[key] ===
                      'string' &&
                    (
                      obj[key] as string
                    ).trim()
                  ) {
                    return obj[key] as string;
                  }
                }

                for (const key of [
                  'data',
                  'result',
                  'body',
                  'response',
                  'output',
                  'json',
                ]) {
                  if (
                    obj[key] &&
                    typeof obj[key] ===
                      'object'
                  ) {
                    const found = walk(
                      obj[key],
                      depth + 1
                    );

                    if (found) return found;
                  }
                }

                return '';
              };

              return walk(parsed);
            };

            const html =
              firstString([
                'html',
                'content',
                'output_html',
                'generated_html',
              ]) || rawBody;

            const jobId =
              firstString([
                'job_id',
                'live_job_id',
                'jobId',
                'liveJobId',
              ]) ||
              html.match(
                /[?&]job_id=([a-zA-Z0-9_-]+)/
              )?.[1] ||
              html.match(
                /job_id%3D([a-zA-Z0-9_-]+)/
              )?.[1] ||
              rawBody.match(
                /[?&]job_id=([a-zA-Z0-9_-]+)/
              )?.[1] ||
              '';

            if (!jobId) {
              throw new Error(
                'Content generation did not return a valid job ID. Please retry.'
              );
            }

            let parsedBrandTheme: unknown =
              null;

            if (
              parsed &&
              typeof parsed === 'object'
            ) {
              const queue: unknown[] = [
                parsed,
              ];

              for (
                let i = 0;
                i < queue.length && i < 20;
                i++
              ) {
                const item = queue[i];

                if (
                  !item ||
                  typeof item !==
                    'object' ||
                  Array.isArray(item)
                ) {
                  continue;
                }

                const obj =
                  item as Record<
                    string,
                    unknown
                  >;

                if (
                  obj.brandTheme &&
                  typeof obj.brandTheme ===
                    'object'
                ) {
                  parsedBrandTheme =
                    obj.brandTheme;
                  break;
                }

                if (
                  obj.brand_theme &&
                  typeof obj.brand_theme ===
                    'object'
                ) {
                  parsedBrandTheme =
                    obj.brand_theme;
                  break;
                }

                for (const key of [
                  'data',
                  'result',
                  'body',
                  'response',
                  'output',
                  'json',
                ]) {
                  if (
                    obj[key] &&
                    typeof obj[key] ===
                      'object'
                  ) {
                    queue.push(obj[key]);
                  }
                }
              }
            }

            const brandTheme =
              parsedBrandTheme &&
              typeof parsedBrandTheme ===
                'object'
                ? parsedBrandTheme
                : data.brand_theme &&
                    typeof data.brand_theme ===
                      'object'
                  ? data.brand_theme
                  : {
                      primary_color:
                        html.match(
                          /color:\s*([#][0-9a-fA-F]{3,8})/
                        )?.[1] ||
                        '#2563eb',

                      secondary_color:
                        html.match(
                          /border-left:\s*4px\s+solid\s+([#][0-9a-fA-F]{3,8})/
                        )?.[1] ||
                        '#10b981',

                      background_color:
                        html.match(
                          /background:\s*([#][0-9a-fA-F]{3,8})/
                        )?.[1] ||
                        '#f8fafc',

                      text_color:
                        html.match(
                          /;\s*color:\s*([#][0-9a-fA-F]{3,8})/
                        )?.[1] ||
                        '#1f2937',

                      logo_url: '',

                      font_family:
                        'Inter, Arial, sans-serif',
                    };

            if (jobRowId) {
              await updateJob(
                jobRowId,
                {
                  job_id: jobId,
                  status: 'running',
                  request_id: requestId,
                  last_error: null,
                },
                accessToken
              ).catch((err) =>
                Sentry.captureException(err, {
                  tags: {
                    area: 'supabase',
                    operation: 'set_job_id',
                  },
                })
              );
            }

            const live_view_token =
              createLiveViewToken(
                jobId,
                authenticatedUserId
              );

            if (jobRowId) {
              await updateJob(
                jobRowId,
                {
                  live_view_token,
                },
                accessToken
              ).catch((err) =>
                Sentry.captureException(err, {
                  tags: {
                    area: 'supabase',
                    operation:
                      'set_live_token',
                  },
                })
              );
            }

            return {
              html,
              brandTheme,
              job_id: jobId,
              jobRowId,
              request_id: requestId,
              live_view_token,
            };
          })
      );

    return NextResponse.json(result, {
      headers: {
        'Cache-Control':
          'private, no-store',
        'X-Request-ID': requestId,
      },
    });
  } catch (err) {
    const message = errorMessage(
      err,
      'Generation failed.'
    );

    if (jobRowId) {
      await updateJob(
        jobRowId,
        {
          status: 'failed',
          finished_at:
            new Date().toISOString(),
          request_id: requestId,
          last_error: errorMessage(
            err,
            'Generation failed.'
          ).slice(0, 1000),
        },
        accessToken
      ).catch((dbError) =>
        Sentry.captureException(
          dbError,
          {
            tags: {
              area: 'supabase',
              operation: 'fail_job',
            },
          }
        )
      );
    }

    const status =
      /session has expired|sign in/i.test(
        message
      )
        ? 401
        : /required|invalid|platform/i.test(
              message
            )
          ? 400
          : /limit|slots busy/i.test(message)
            ? 429
            : 502;

    if (status >= 500) {
      Sentry.captureException(err, {
        tags: {
          route: '/api/generate',
          jobRowId: jobRowId || 'none',
        },
      });
    }

    return NextResponse.json(
      {
        error: message,
        request_id: requestId,
      },
      {
        status,
        headers: {
          'X-Request-ID': requestId,
        },
      }
    );
  }
}