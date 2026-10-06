export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

import {
  apiGuard,
  assertPublicHttpUrl,
  appearanceCacheGet,
  appearanceCacheSet,
  fetchPublicResource,
  isPrivateHost,
  readResponseLimited,
} from '@/lib/server';

const DEFAULTS = {
  logo_url: '',
  primary_color: '',
  secondary_color: '',
  background_color: '',
  text_color: '',
  font_family: '',
};

/* ============================================================
   COLOR HELPERS
   ============================================================ */

function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((x) =>
        Math.max(0, Math.min(255, x))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 60) {
    [r, g, b] = [c, x, 0];
  } else if (h < 120) {
    [r, g, b] = [x, c, 0];
  } else if (h < 180) {
    [r, g, b] = [0, c, x];
  } else if (h < 240) {
    [r, g, b] = [0, x, c];
  } else if (h < 300) {
    [r, g, b] = [x, 0, c];
  } else {
    [r, g, b] = [c, 0, x];
  }

  return rgbToHex(
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  );
}

function normaliseColor(value: string): string {
  let v = String(value || '')
    .trim()
    .replace(/!important\s*$/i, '')
    .trim();

  if (!v || /^(transparent|inherit|currentcolor)$/i.test(v)) {
    return '';
  }

  if (/^#[0-9a-f]{8}$/i.test(v)) {
    v = v.slice(0, 7);
  }

  if (/^#[0-9a-f]{6}$/i.test(v)) {
    return v.toLowerCase();
  }

  const short = v.match(/^#([0-9a-f]{3})$/i);

  if (short) {
    return (
      '#' +
      short[1]
        .split('')
        .map((x) => x + x)
        .join('')
        .toLowerCase()
    );
  }

  const rgb = v.match(
    /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/i,
  );

  if (rgb) {
    return rgbToHex(
      Number(rgb[1]),
      Number(rgb[2]),
      Number(rgb[3]),
    );
  }

  const hsl = v.match(
    /^hsla?\(\s*([\d.+-]+)(?:deg)?\s*[, ]\s*([\d.+-]+)%\s*[, ]\s*([\d.+-]+)%/i,
  );

  if (hsl) {
    return hslToHex(
      Number(hsl[1]),
      Number(hsl[2]),
      Number(hsl[3]),
    );
  }

  return '';
}

/* ============================================================
   LOGO HELPERS
   ============================================================ */

function isSocialImage(value: string): boolean {
  const hay = String(value || '').toLowerCase();

  const patterns = [
    /facebook/,
    /instagram/,
    /linkedin/,
    /twitter/,
    /(^|[^a-z])x\.com/,
    /youtube/,
    /whatsapp/,
    /telegram/,
    /tiktok/,
    /pinterest/,
    /snapchat/,
    /reddit/,
    /discord/,
    /threads/,
    /social[-_ ]?icon/,
    /social[-_ ]?media/,
    /share[-_ ]?icon/,
    /share[-_ ]?button/,
  ];

  return patterns.some((pattern) => pattern.test(hay));
}

function isClearlyBadLogoCandidate(value: string): boolean {
  const hay = String(value || '').toLowerCase();

  if (!hay) {
    return true;
  }

  const patterns = [
    /sprite/,
    /banner/,
    /hero/,
    /slider/,
    /carousel/,
    /payment/,
    /tracking/,
    /pixel/,
    /avatar/,
    /profile/,
    /placeholder/,
    /captcha/,
    /favicon/,
    /apple-touch-icon/,
    /loader/,
    /spinner/,
    /close/,
    /menu-icon/,
    /hamburger/,
    /search-icon/,
    /arrow/,
    /chevron/,
    /badge/,
    /rating/,
    /star/,
    /qr[-_ ]?code/,
  ];

  return patterns.some((pattern) => pattern.test(hay));
}

function isNonCompanyBrandImage(value: string): boolean {
  const hay = String(value || '').toLowerCase();

  /*
   * These are common places where websites display:
   * - customer logos
   * - partner logos
   * - client logos
   * - portfolio logos
   * - case-study logos
   *
   * These must never become the company's own logo.
   */
  const patterns = [
    /client[-_ ]?logo/,
    /customer[-_ ]?logo/,
    /partner[-_ ]?logo/,
    /trusted[-_ ]?brand/,
    /our[-_ ]?clients/,
    /our[-_ ]?partners/,
    /client[-_ ]?section/,
    /customer[-_ ]?section/,
    /partner[-_ ]?section/,
    /portfolio/,
    /case[-_ ]?study/,
    /case[-_ ]?studies/,
    /testimonial/,
    /featured[-_ ]?clients/,
    /featured[-_ ]?partners/,
    /logo[-_ ]?slider/,
    /logo[-_ ]?carousel/,
    /clients[-_ ]?slider/,
    /partners[-_ ]?slider/,
    /clients[-_ ]?carousel/,
    /partners[-_ ]?carousel/,
  ];

  return patterns.some((pattern) => pattern.test(hay));
}

function isKnownThirdPartyBrand(value: string): boolean {
  const hay = String(value || '').toLowerCase();

  /*
   * These are deliberately only used as a safety net.
   *
   * A third-party logo such as Flipkart should never become the
   * company's logo just because the image filename contains
   * "logo".
   */
  const patterns = [
    /flipkart/,
    /amazon/,
    /myntra/,
    /meesho/,
    /google/,
    /microsoft/,
    /apple/,
    /meta/,
    /facebook/,
    /instagram/,
    /linkedin/,
    /youtube/,
    /twitter/,
    /tata/,
    /jindal/,
    /adani/,
    /reliance/,
    /infosys/,
    /tcs/,
    /wipro/,
    /zoho/,
    /redington/,
    /ingram/,
    /crayon/,
  ];

  return patterns.some((pattern) => pattern.test(hay));
}

function isUsableLogoUrl(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const logoUrl = value.trim();

  if (!logoUrl) {
    return false;
  }

  try {
    const parsed = new URL(logoUrl);

    if (!/^https?:$/i.test(parsed.protocol)) {
      return false;
    }

    const haystack =
      `${parsed.hostname} ${parsed.pathname} ${parsed.search}`.toLowerCase();

    if (isSocialImage(haystack)) {
      return false;
    }

    if (isClearlyBadLogoCandidate(haystack)) {
      return false;
    }

    if (isNonCompanyBrandImage(haystack)) {
      return false;
    }

    if (isKnownThirdPartyBrand(haystack)) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

/* ============================================================
   ATTRIBUTE PARSER
   ============================================================ */

function parseAttributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};

  for (const match of tag.matchAll(
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g,
  )) {
    out[match[1].toLowerCase()] = (
      match[2] ??
      match[3] ??
      match[4] ??
      ''
    ).trim();
  }

  return out;
}

/* ============================================================
   URL HELPER
   ============================================================ */

function makeAbsoluteUrl(
  raw: string,
  baseUrl: string,
): string {
  let src = String(raw || '').trim();

  if (!src) {
    return '';
  }

  if (src.startsWith('data:')) {
    return '';
  }

  if (src.startsWith('//')) {
    src = 'https:' + src;
  }

  try {
    return new URL(src, baseUrl).href;
  } catch {
    return '';
  }
}

/* ============================================================
   LOGO CANDIDATE
   ============================================================ */

type LogoCandidate = {
  src: string;
  score: number;
  reason: string;
};

/* ============================================================
   GET
   ============================================================ */

export async function GET(req: NextRequest) {
  const limited = await apiGuard(req, {
    rateLimit: 120,
    scope: 'brand-appearance',
  });

  if (limited) {
    return limited;
  }

  try {
    /*
     * Brand extraction is independent of n8n/generation configuration.
     * Do not block an existing company workspace just because
     * generation environment variables are unavailable.
     */
    const rawUrl = req.nextUrl.searchParams.get('url');

    if (!rawUrl) {
      return NextResponse.json(
        {
          error: 'Brand website URL is required.',
        },
        {
          status: 400,
        },
      );
    }

    const url = await assertPublicHttpUrl(rawUrl);

    const forceRefresh =
      req.nextUrl.searchParams.get('refresh') === '1';

    /* ============================================================
       CACHE
       ============================================================ */

    const cached = forceRefresh
      ? null
      : appearanceCacheGet(url);

    /*
     * Never return a cached social/partner/client/third-party logo.
     * If the cached logo is invalid, continue with a fresh scrape.
     */
    if (
      cached &&
      typeof cached === 'object' &&
      isUsableLogoUrl(
        (cached as Record<string, unknown>).logo_url,
      )
    ) {
      return NextResponse.json(cached, {
        headers: {
          'X-Cache': 'HIT',
        },
      });
    }

    /* ============================================================
       FETCH WEBSITE
       ============================================================ */

    const res = await fetchPublicResource(url, {
      headers: {
        'User-Agent': 'SparrowBrandFetcher/1.0',
        Accept: 'text/html,application/xhtml+xml',
      },
    });

    if (!res.ok) {
      Sentry.captureMessage(
        'Brand website fetch returned a non-OK response.',
        {
          level: 'warning',
          tags: {
            route: '/api/brand-appearance',
          },
          extra: {
            url,
            upstreamStatus: res.status,
          },
        },
      );

      return NextResponse.json(
        {
          error: 'Brand website could not be fetched.',
          upstream_status: res.status,
        },
        {
          status: 502,
          headers: {
            'X-Cache': 'MISS',
          },
        },
      );
    }

    const html = new TextDecoder().decode(
      await readResponseLimited(
        res,
        5 * 1024 * 1024,
      ),
    );

    /* ============================================================
       STYLESHEETS
       ============================================================ */

    const stylesheetHrefs = [
      ...html.matchAll(
        /<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi,
      ),
    ]
      .map((match) => match[1])
      .slice(0, 5);

    const cssParts = await Promise.all(
      stylesheetHrefs.map(async (href) => {
        try {
          const cssUrl = new URL(
            href,
            url,
          ).toString();

          if (await isPrivateHost(cssUrl)) {
            return '';
          }

          const cssRes =
            await fetchPublicResource(
              cssUrl,
              {
                headers: {
                  'User-Agent':
                    'Mozilla/5.0 (compatible; SparrowBrandTheme/1.0)',
                  Accept:
                    'text/css,*/*;q=0.1',
                },
                signal:
                  AbortSignal.timeout(5000),
              },
            );

          if (!cssRes.ok) {
            return '';
          }

          return (
            '\n' +
            new TextDecoder().decode(
              await readResponseLimited(
                cssRes,
                1024 * 1024,
              ),
            ).slice(
              0,
              250000,
            )
          );
        } catch {
          return '';
        }
      }),
    );

    const stylesheetText =
      cssParts.join('');

    /* ============================================================
       LOGO EXTRACTION
       ============================================================ */

    const candidates: LogoCandidate[] = [];

    const headerMatches = [
      ...html.matchAll(
        /<(header|nav)\b[\s\S]*?<\/\1>/gi,
      ),
    ];

    const headerHtml = headerMatches
      .map((match) => match[0])
      .join('\n');

    let hostname = '';

    try {
      hostname = new URL(url)
        .hostname
        .replace(/^www\./i, '')
        .split('.')[0]
        .toLowerCase();
    } catch {
      hostname = '';
    }

    const hostnameWords = hostname
      .split(/[-_]/)
      .filter(Boolean);

    /*
     * Extract page title as an additional company-identity signal.
     */
    const titleMatch = html.match(
      /<title[^>]*>([\s\S]*?)<\/title>/i,
    );

    const pageTitle = titleMatch
      ? titleMatch[1]
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase()
      : '';

    /*
     * ------------------------------------------------------------
     * IMG TAGS
     * ------------------------------------------------------------
     */

    for (const match of html.matchAll(
      /<img\b[^>]*>/gi,
    )) {
      const tag = match[0];

      const attrs =
        parseAttributes(tag);

      const raw =
        attrs['src'] ||
        attrs['data-src'] ||
        attrs['data-lazy-src'] ||
        attrs['data-original'] ||
        (
          attrs['srcset'] ||
          attrs['data-srcset'] ||
          attrs['data-lazy-srcset'] ||
          ''
        )
          .split(',')
          .map((part) =>
            part
              .trim()
              .split(/\s+/)[0],
          )
          .find(Boolean) ||
        '';

      const src =
        makeAbsoluteUrl(
          raw,
          url,
        );

      if (!src) {
        continue;
      }

      const tagIndex =
        match.index ?? -1;

      /*
       * Look around the image so we can determine whether it is
       * inside a partner/client/customer section.
       */
      const contextStart =
        Math.max(
          0,
          tagIndex - 1800,
        );

      const contextEnd =
        Math.min(
          html.length,
          tagIndex + 1800,
        );

      const context =
        html
          .slice(
            contextStart,
            contextEnd,
          )
          .toLowerCase();

      const hay =
        [
          attrs['class'] || '',
          attrs['id'] || '',
          attrs['alt'] || '',
          attrs['title'] || '',
          attrs['name'] || '',
          src,
        ].join(' ');

      const hayLower =
        hay.toLowerCase();

      /* ----------------------------------------------------------
         HARD REJECTIONS
         ---------------------------------------------------------- */

      if (
        isSocialImage(
          hayLower,
        )
      ) {
        continue;
      }

      if (
        isClearlyBadLogoCandidate(
          hayLower,
        )
      ) {
        continue;
      }

      if (
        isKnownThirdPartyBrand(
          hayLower,
        )
      ) {
        continue;
      }

      /*
       * IMPORTANT:
       *
       * A partner/client logo is NOT allowed merely because
       * its alt text contains the word "logo".
       *
       * This is what prevents Flipkart from becoming TechBliss'
       * logo.
       */
      const partnerContext =
        /client|customer|partner|portfolio|case[-_ ]?stud|testimonial|trusted|featured[-_ ]?(client|partner|brand)|our[-_ ]?(clients|customers|partners)/i.test(
          context,
        );

      const isInsideHeader =
        Boolean(
          headerHtml &&
          headerHtml.includes(tag),
        );

      const isExplicitSiteLogo =
        /(?:site|company|website|main|header)[-_ ]?logo/i.test(
          hayLower,
        ) ||
        /wordmark|masthead|site[-_ ]?title|navbar[-_ ]?brand/i.test(
          hayLower,
        );

      /*
       * If the image is in a partner/client area and it is not
       * clearly the site's own header/brand logo, reject it.
       */
      if (
        partnerContext &&
        !isInsideHeader &&
        !isExplicitSiteLogo
      ) {
        continue;
      }

      /*
       * Reject known third-party brand names appearing in the
       * surrounding context unless the image is clearly the
       * site's own header logo.
       */
      if (
        !isInsideHeader &&
        !isExplicitSiteLogo &&
        isKnownThirdPartyBrand(
          context,
        )
      ) {
        continue;
      }

      /* ----------------------------------------------------------
         SCORING
         ---------------------------------------------------------- */

      let score = 0;

      let reason =
        'generic image';

      if (
        /\blogo\b/i.test(
          hayLower,
        )
      ) {
        score += 25;
        reason =
          'explicit logo name';
      }

      if (
        /(?:site|company|website|main|header)[-_ ]?logo/i.test(
          hayLower,
        )
      ) {
        score += 15;
        reason =
          'site/company logo';
      }

      if (
        /wordmark|masthead|site[-_ ]?title|navbar[-_ ]?brand/i.test(
          hayLower,
        )
      ) {
        score += 10;
      }

      if (
        isInsideHeader
      ) {
        score += 12;
      }

      if (
        /\blogo\b/i.test(
          [
            attrs['alt'] || '',
            attrs['title'] || '',
          ].join(' '),
        )
      ) {
        score += 15;
      }

      if (
        hostname &&
        hayLower.includes(
          hostname,
        )
      ) {
        score += 8;
      }

      if (
        hostnameWords.some(
          (word) =>
            word.length >= 4 &&
            hayLower.includes(word),
        )
      ) {
        score += 5;
      }

      if (
        /(?:^|[/_-])logo(?:[/_.?-]|$)/i.test(
          src,
        )
      ) {
        score += 12;
      }

      if (
        /\.svg(?:[?#]|$)/i.test(
          src,
        )
      ) {
        score += 3;
      }

      if (
        /\/(?:logo|logos|branding)\//i.test(
          src,
        )
      ) {
        score += 5;
      }

      /*
       * If the image is near the site's own hostname/company
       * wording, give it a small bonus.
       */
      const nearbyText =
        context
          .replace(
            /<[^>]+>/g,
            ' ',
          )
          .replace(
            /\s+/g,
            ' ',
          )
          .trim();

      if (
        hostnameWords.some(
          (word) =>
            word.length >= 4 &&
            nearbyText.includes(
              word,
            ),
        )
      ) {
        score += 4;
      }

      /*
       * A filename such as flipkart-logo.png is a strong
       * third-party signal.
       */
      if (
        isKnownThirdPartyBrand(
          src,
        )
      ) {
        score -= 100;
      }

      /*
       * Do not allow weak candidates.
       */
      if (score > 0) {
        candidates.push({
          src,
          score,
          reason,
        });
      }
    }

    /*
     * ------------------------------------------------------------
     * JSON-LD LOGO
     * ------------------------------------------------------------
     */

    for (const match of html.matchAll(
      /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    )) {
      try {
        const json =
          JSON.parse(
            match[1],
          );

        const walk =
          (
            node: unknown,
          ): string => {
            if (
              !node ||
              typeof node !==
                'object'
            ) {
              return '';
            }

            const obj =
              node as Record<
                string,
                unknown
              >;

            const logo =
              obj.logo;

            if (
              typeof logo ===
              'string'
            ) {
              return logo;
            }

            if (
              logo &&
              typeof logo ===
                'object' &&
              typeof (
                logo as Record<
                  string,
                  unknown
                >
              ).url ===
                'string'
            ) {
              return (
                logo as Record<
                  string,
                  string
                >
              ).url;
            }

            for (
              const value of
                Object.values(
                  obj,
                )
            ) {
              const found =
                walk(value);

              if (found) {
                return found;
              }
            }

            return '';
          };

        const src =
          makeAbsoluteUrl(
            walk(json),
            url,
          );

        if (
          src &&
          isUsableLogoUrl(
            src,
          )
        ) {
          candidates.push({
            src,
            score: 60,
            reason:
              'JSON-LD organization logo',
          });
        }
      } catch {
        /*
         * Ignore malformed JSON-LD.
         */
      }
    }

    /*
     * ------------------------------------------------------------
     * LINK ICONS
     * ------------------------------------------------------------
     */

    for (const match of html.matchAll(
      /<link\b[^>]*>/gi,
    )) {
      const attrs =
        parseAttributes(
          match[0],
        );

      const rel = (
        attrs['rel'] || ''
      ).toLowerCase();

      const src =
        makeAbsoluteUrl(
          attrs['href'] || '',
          url,
        );

      if (!src) {
        continue;
      }

      if (
        !isUsableLogoUrl(
          src,
        )
      ) {
        continue;
      }

      if (
        rel.includes(
          'apple-touch-icon',
        )
      ) {
        candidates.push({
          src,
          score: 4,
          reason:
            'apple touch icon',
        });
      } else if (
        rel.includes('icon')
      ) {
        candidates.push({
          src,
          score: 2,
          reason:
            'site icon',
        });
      }
    }

    /*
     * ------------------------------------------------------------
     * OPEN GRAPH IMAGE
     * ------------------------------------------------------------
     *
     * OG image is intentionally very low priority.
     */

    for (const match of html.matchAll(
      /<meta\b[^>]*>/gi,
    )) {
      const attrs =
        parseAttributes(
          match[0],
        );

      if (
        (
          attrs['property'] ||
          ''
        ).toLowerCase() !==
        'og:image'
      ) {
        continue;
      }

      const src =
        makeAbsoluteUrl(
          attrs['content'] || '',
          url,
        );

      if (
        src &&
        isUsableLogoUrl(
          src,
        )
      ) {
        candidates.push({
          src,
          score: 1,
          reason:
            'Open Graph image',
        });
      }
    }

    /*
     * ------------------------------------------------------------
     * FINAL LOGO FILTER
     * ------------------------------------------------------------
     */

    const validCandidates =
      candidates.filter(
        (candidate) =>
          isUsableLogoUrl(
            candidate.src,
          ),
      );

    validCandidates.sort(
      (a, b) =>
        b.score - a.score,
    );

    let logo = '';

    for (
      const candidate of
        validCandidates
    ) {
      if (
        isUsableLogoUrl(
          candidate.src,
        )
      ) {
        logo =
          candidate.src;

        break;
      }
    }

    /*
     * ------------------------------------------------------------
     * FINAL FAVICON FALLBACK
     * ------------------------------------------------------------
     */

    if (!logo) {
      try {
        logo =
          'https://www.google.com/s2/favicons?domain=' +
          new URL(url).hostname +
          '&sz=128';
      } catch {
        logo = '';
      }
    }

    /* ============================================================
       COLORS
       ============================================================ */

    const allColors:
      Record<string, number> =
      {};

    /*
     * ------------------------------------------------------------
     * THEME COLOR
     * ------------------------------------------------------------
     */

    let themeColor = '';

    const themeMeta =
      html.match(
        /<meta\b[^>]*name=["']theme-color["'][^>]*content=["']([^"']+)["'][^>]*>/i,
      );

    if (themeMeta) {
      themeColor =
        themeMeta[1].trim();
    }

    /*
     * ------------------------------------------------------------
     * HEX COLORS
     * ------------------------------------------------------------
     */

    const combinedSource =
      html +
      '\n' +
      stylesheetText;

    const hexRe =
      /#([0-9a-fA-F]{6})\b/g;

    let colorMatch:
      RegExpExecArray | null;

    while (
      (
        colorMatch =
          hexRe.exec(
            combinedSource,
          )
      ) !== null
    ) {
      const hex =
        '#' +
        colorMatch[1]
          .toLowerCase();

      allColors[hex] =
        (allColors[hex] || 0) +
        1;
    }

    /*
     * ------------------------------------------------------------
     * RGB COLORS
     * ------------------------------------------------------------
     */

    const rgbRe =
      /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g;

    while (
      (
        colorMatch =
          rgbRe.exec(
            combinedSource,
          )
      ) !== null
    ) {
      const hex =
        rgbToHex(
          parseInt(
            colorMatch[1],
            10,
          ),
          parseInt(
            colorMatch[2],
            10,
          ),
          parseInt(
            colorMatch[3],
            10,
          ),
        );

      allColors[hex] =
        (allColors[hex] || 0) +
        1;
    }

    /*
     * ------------------------------------------------------------
     * HSL COLORS
     * ------------------------------------------------------------
     */

    const hslRe =
      /hsla?\(\s*([\d.+-]+)(?:deg)?\s*[, ]\s*([\d.+-]+)%\s*[, ]\s*([\d.+-]+)%/gi;

    while (
      (
        colorMatch =
          hslRe.exec(
            combinedSource,
          )
      ) !== null
    ) {
      const hex =
        hslToHex(
          Number(
            colorMatch[1],
          ),
          Number(
            colorMatch[2],
          ),
          Number(
            colorMatch[3],
          ),
        );

      allColors[hex] =
        (allColors[hex] || 0) +
        1;
    }

    /*
     * ------------------------------------------------------------
     * INLINE STYLES
     * ------------------------------------------------------------
     */

    const styleRe =
      /style="[^"]*(?:background(?:-color)?|color|border-color)\s*:\s*([^;"]+)/gi;

    while (
      (
        colorMatch =
          styleRe.exec(
            html,
          )
      ) !== null
    ) {
      const value =
        colorMatch[1].trim();

      const hexMatch =
        value.match(
          /#([0-9a-fA-F]{6})\b/,
        );

      if (hexMatch) {
        const hex =
          '#' +
          hexMatch[1]
            .toLowerCase();

        allColors[hex] =
          (allColors[hex] || 0) +
          3;
      }

      const rgbMatch =
        value.match(
          /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/,
        );

      if (rgbMatch) {
        const hex =
          rgbToHex(
            parseInt(
              rgbMatch[1],
              10,
            ),
            parseInt(
              rgbMatch[2],
              10,
            ),
            parseInt(
              rgbMatch[3],
              10,
            ),
          );

        allColors[hex] =
          (allColors[hex] || 0) +
          3;
      }
    }

    /*
     * ------------------------------------------------------------
     * STYLE BLOCKS
     * ------------------------------------------------------------
     */

    const styleBlocks =
      html.match(
        /<style[^>]*>([\s\S]*?)<\/style>/gi,
      ) || [];

    for (
      const block of
        styleBlocks
    ) {
      const innerHex =
        /#([0-9a-fA-F]{6})\b/g;

      while (
        (
          colorMatch =
            innerHex.exec(
              block,
            )
        ) !== null
      ) {
        const hex =
          '#' +
          colorMatch[1]
            .toLowerCase();

        allColors[hex] =
          (allColors[hex] || 0) +
          2;
      }

      const innerRgb =
        /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g;

      while (
        (
          colorMatch =
            innerRgb.exec(
              block,
            )
        ) !== null
      ) {
        const hex =
          rgbToHex(
            parseInt(
              colorMatch[1],
              10,
            ),
            parseInt(
              colorMatch[2],
              10,
            ),
            parseInt(
              colorMatch[3],
              10,
            ),
          );

        allColors[hex] =
          (allColors[hex] || 0) +
          2;
      }
    }

    /*
     * ------------------------------------------------------------
     * MEANINGFUL COLORS
     * ------------------------------------------------------------
     *
     * Remove:
     * - grayscale colours
     * - near-white colours
     * - near-black colours
     */

    const meaningful: [
      string,
      number,
    ][] = [];

    for (
      const [
        hex,
        count,
      ] of Object.entries(
        allColors,
      )
    ) {
      const r =
        parseInt(
          hex.slice(1, 3),
          16,
        );

      const g =
        parseInt(
          hex.slice(3, 5),
          16,
        );

      const b =
        parseInt(
          hex.slice(5, 7),
          16,
        );

      const isGray =
        Math.abs(r - g) < 25 &&
        Math.abs(g - b) < 25;

      const isTooLight =
        r > 220 &&
        g > 220 &&
        b > 220;

      const isTooDark =
        r < 30 &&
        g < 30 &&
        b < 30;

      if (
        !isGray &&
        !isTooLight &&
        !isTooDark
      ) {
        meaningful.push([
          hex,
          count,
        ]);
      }
    }

    meaningful.sort(
      (a, b) =>
        b[1] - a[1],
    );

    /* ============================================================
       CSS VARIABLES
       ============================================================ */

    let backgroundColor = '';
    let textColor = '';
    let fontFamily = '';

    const styleSource = [
      html,
      stylesheetText,
      ...styleBlocks,
    ].join('\n');

    const readCssVarColor = (
      names: string[],
    ): string => {
      for (
        const name of names
      ) {
        const re =
          new RegExp(
            `--${name}\\s*:\\s*([^;}]+)`,
            'i',
          );

        const match =
          styleSource.match(
            re,
          );

        if (match) {
          const color =
            normaliseColor(
              match[1].trim(),
            );

          if (color) {
            return color;
          }
        }
      }

      return '';
    };

    const variablePrimary =
      readCssVarColor([
        'primary-color',
        'brand-primary',
        'color-primary',
        'primary',
      ]);

    const variableSecondary =
      readCssVarColor([
        'secondary-color',
        'brand-secondary',
        'color-secondary',
        'secondary',
      ]);

    const variableBackground =
      readCssVarColor([
        'background-color',
        'brand-background',
        'color-background',
        'background',
        'bg',
      ]);

    const variableText =
      readCssVarColor([
        'text-color',
        'brand-text',
        'color-text',
        'text',
        'foreground',
      ]);

    /* ============================================================
       BODY / ROOT COLORS
       ============================================================ */

    const bodyMatch =
      styleSource.match(
        /(?:body|html|:root)[^{]*\{[^}]*\}/i,
      );

    if (bodyMatch) {
      const block =
        bodyMatch[0];

      const bg =
        block.match(
          /background(?:-color)?\s*:\s*([^;}]+)/i,
        );

      const fg =
        block.match(
          /(?:^|[;\s])color\s*:\s*([^;}]+)/i,
        );

      const ff =
        block.match(
          /font-family\s*:\s*([^;}]+)/i,
        );

      if (bg) {
        backgroundColor =
          normaliseColor(
            bg[1],
          );
      }

      if (fg) {
        textColor =
          normaliseColor(
            fg[1],
          );
      }

      if (ff) {
        fontFamily =
          ff[1]
            .trim()
            .replace(
              /["']/g,
              '',
            );
      }
    }

    if (!fontFamily) {
      const ff =
        styleSource.match(
          /font-family\s*:\s*([^;}]+)/i,
        );

      if (ff) {
        fontFamily =
          ff[1]
            .trim()
            .replace(
              /["']/g,
              '',
            );
      }
    }

    backgroundColor =
      variableBackground ||
      backgroundColor;

    textColor =
      variableText ||
      textColor;

    /* ============================================================
       BACKGROUND FALLBACK
       ============================================================ */

    if (!backgroundColor) {
      const bgCandidates =
        Object.entries(
          allColors,
        )
          .map(
            ([hex, count]) =>
              [
                hex,
                count,
              ] as [
                string,
                number,
              ],
          )
          .filter(
            ([hex]) => {
              const r =
                parseInt(
                  hex.slice(
                    1,
                    3,
                  ),
                  16,
                );

              const g =
                parseInt(
                  hex.slice(
                    3,
                    5,
                  ),
                  16,
                );

              const b =
                parseInt(
                  hex.slice(
                    5,
                    7,
                  ),
                  16,
                );

              return (
                r > 235 &&
                g > 235 &&
                b > 235
              );
            },
          )
          .sort(
            (x, y) =>
              y[1] - x[1],
          );

      backgroundColor =
        bgCandidates[0]?.[0] ||
        '';
    }

    /* ============================================================
       TEXT FALLBACK
       ============================================================ */

    if (!textColor) {
      const textCandidates =
        Object.entries(
          allColors,
        )
          .map(
            ([hex, count]) =>
              [
                hex,
                count,
              ] as [
                string,
                number,
              ],
          )
          .filter(
            ([hex]) => {
              const r =
                parseInt(
                  hex.slice(
                    1,
                    3,
                  ),
                  16,
                );

              const g =
                parseInt(
                  hex.slice(
                    3,
                    5,
                  ),
                  16,
                );

              const b =
                parseInt(
                  hex.slice(
                    5,
                    7,
                  ),
                  16,
                );

              return (
                r < 90 &&
                g < 90 &&
                b < 90
              );
            },
          )
          .sort(
            (x, y) =>
              y[1] - x[1],
          );

      textColor =
        textCandidates[0]?.[0] ||
        '';
    }

    if (!backgroundColor) {
      backgroundColor =
        '#ffffff';
    }

    if (!textColor) {
      textColor =
        '#111827';
    }

    /* ============================================================
       PRIMARY COLOR
       ============================================================ */

    /*
     * IMPORTANT:
     *
     * Do NOT prioritize <meta name="theme-color"> here.
     *
     * theme-color is browser/UI metadata and can legitimately
     * be white even when the company's actual brand colour is
     * blue, red, orange, etc.
     *
     * Priority:
     *
     * 1. Explicit CSS primary variable
     * 2. Meaningful website brand colour
     * 3. theme-color only as final fallback
     */

    const primary =
      variablePrimary ||
      (
        meaningful.length > 0
          ? meaningful[0][0]
          : ''
      ) ||
      normaliseColor(
        themeColor,
      );

    /* ============================================================
       SECONDARY COLOR
       ============================================================ */

    const secondary =
      variableSecondary ||
      (
        meaningful.length > 1
          ? meaningful[1][0]
          : primary
      );

    /* ============================================================
       FINAL RESULT
       ============================================================ */

    const result = {
      ...DEFAULTS,

      logo_url:
        logo,

      primary_color:
        primary,

      secondary_color:
        secondary,

      background_color:
        backgroundColor,

      text_color:
        textColor,

      font_family:
        fontFamily,
    };

    appearanceCacheSet(
      url,
      result,
    );

    return NextResponse.json(
      result,
      {
        headers: {
          'X-Cache': 'MISS',
        },
      },
    );
  } catch (err) {
    Sentry.captureException(
      err,
      {
        tags: {
          route:
            '/api/brand-appearance',
        },
      },
    );

    const message =
      err instanceof Error
        ? err.message
        : 'Brand appearance extraction failed.';

    return NextResponse.json(
      {
        error: message,
      },
      {
        status: 502,
        headers: {
          'X-Cache': 'MISS',
        },
      },
    );
  }
}