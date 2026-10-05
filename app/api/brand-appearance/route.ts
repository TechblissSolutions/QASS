export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { apiGuard, assertServerEnv, assertPublicHttpUrl, appearanceCacheGet, appearanceCacheSet, fetchWithRetry, fetchPublicResource, isPrivateHost, readResponseLimited } from '@/lib/server';

const DEFAULTS = { logo_url: '', primary_color: '', secondary_color: '', background_color: '', text_color: '', font_family: '' };

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(x => Math.max(0, Math.min(255, x)).toString(16).padStart(2, '0')).join('');
}

function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgbToHex(Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255));
}

function normaliseColor(value: string): string {
  let v = String(value || '').trim().replace(/!important\s*$/i, '').trim();
  if (!v || /^(transparent|inherit|currentcolor)$/i.test(v)) return '';
  if (/^#[0-9a-f]{8}$/i.test(v)) v = v.slice(0, 7);
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase();
  const short = v.match(/^#([0-9a-f]{3})$/i);
  if (short) return '#' + short[1].split('').map(x => x + x).join('').toLowerCase();
  const rgb = v.match(/^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/i);
  if (rgb) return rgbToHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
  const hsl = v.match(/^hsla?\(\s*([\d.+-]+)(?:deg)?\s*[, ]\s*([\d.+-]+)%\s*[, ]\s*([\d.+-]+)%/i);
  if (hsl) return hslToHex(Number(hsl[1]), Number(hsl[2]), Number(hsl[3]));
  return '';
}

export async function GET(req: NextRequest) {
  const limited = await apiGuard(req, { rateLimit: 120, scope: 'brand-appearance' }); if (limited) return limited;
  try {
    // Brand extraction is independent of n8n/generation configuration.
    // Do not block an existing company workspace just because generation env is unavailable.
    const rawUrl = req.nextUrl.searchParams.get('url');
    if (!rawUrl) return NextResponse.json({ error: 'Brand website URL is required.' }, { status: 400 });
    const url = await assertPublicHttpUrl(rawUrl);
    const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1';
    const cached = forceRefresh ? null : appearanceCacheGet(url);
    if (cached) return NextResponse.json(cached, { headers: { 'X-Cache': 'HIT' } });
    const res = await fetchPublicResource(url, {
      headers: { 'User-Agent': 'SparrowBrandFetcher/1.0', 'Accept': 'text/html,application/xhtml+xml' },
    });
    if (!res.ok) {
      Sentry.captureMessage('Brand website fetch returned a non-OK response.', {
        level: 'warning',
        tags: { route: '/api/brand-appearance' },
        extra: { url, upstreamStatus: res.status },
      });
      return NextResponse.json(
        { error: 'Brand website could not be fetched.', upstream_status: res.status },
        { status: 502, headers: { 'X-Cache': 'MISS' } },
      );
    }
    const html = new TextDecoder().decode(await readResponseLimited(res, 5 * 1024 * 1024));
    const stylesheetHrefs = [...html.matchAll(/<link[^>]+rel=[\"']stylesheet[\"'][^>]*href=[\"']([^\"']+)[\"'][^>]*>/gi)].map(m => m[1]).slice(0, 5);
    const cssParts = await Promise.all(stylesheetHrefs.map(async href => {
      try {
        const cssUrl = new URL(href, url).toString();
        if (await isPrivateHost(cssUrl)) return '';
        const cssRes = await fetchPublicResource(cssUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SparrowBrandTheme/1.0)', Accept: 'text/css,*/*;q=0.1' }, signal: AbortSignal.timeout(5000) });
        return cssRes.ok ? '\n' + new TextDecoder().decode(await readResponseLimited(cssRes, 1024 * 1024)).slice(0, 250000) : '';
      } catch { return ''; }
    }));
    const stylesheetText = cssParts.join('');


    // ── LOGO ──
    // Parse real <img>/<link>/<meta> tags (any attribute order, single or double quotes)
    // and rank candidates. Header/nav images and anything named "logo" win; og:image is last
    // because it is usually a hero photo, not the logo.
    const attrsOf = (tag: string) => {
      const out: Record<string, string> = {};
      for (const m of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) out[m[1].toLowerCase()] = (m[2] ?? m[3] ?? m[4] ?? '').trim();
      return out;
    };
    const toAbs = (raw: string) => {
      let src = String(raw || '').trim();
      if (!src || src.startsWith('data:')) return '';
      if (src.startsWith('//')) src = 'https:' + src;
      try { return new URL(src, url).href; } catch { return ''; }
    };
    const candidates: { src: string; score: number }[] = [];
    const headerHtml = (html.match(/<(?:header|nav)\b[\s\S]*?<\/(?:header|nav)>/i) || [''])[0];
    for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
      const at = attrsOf(m[0]);
      const raw = at['src'] || at['data-src'] || at['data-lazy-src'] || at['data-original'] ||
        (at['srcset'] || at['data-srcset'] || at['data-lazy-srcset'] || '').split(',')[0]?.trim().split(/\s+/)[0] || '';
      const src = toAbs(raw);
      if (!src) continue;
      const hay = (at['class'] || '') + ' ' + (at['id'] || '') + ' ' + (at['alt'] || '') + ' ' + src;
      let score = 0;
      if (/logo/i.test(hay)) score += 10;
      if (/brand|site-?title|navbar/i.test(hay)) score += 3;
      if (headerHtml && headerHtml.includes(m[0])) score += 6;
      if (/sprite|banner|hero|slider|payment|icon-(?:facebook|twitter|instagram)|avatar|tracking|pixel/i.test(hay)) score -= 8;
      if (score > 0) candidates.push({ src, score });
    }
    for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
      try {
        const walk = (node: any): string => {
          if (!node || typeof node !== 'object') return '';
          const l = node.logo;
          if (typeof l === 'string') return l;
          if (l && typeof l === 'object' && typeof l.url === 'string') return l.url;
          for (const v of Object.values(node)) { const f = walk(v); if (f) return f; }
          return '';
        };
        const src = toAbs(walk(JSON.parse(m[1])));
        if (src) candidates.push({ src, score: 9 });
      } catch { /* ignore invalid JSON-LD */ }
    }
    for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
      const at = attrsOf(m[0]);
      const rel = (at['rel'] || '').toLowerCase();
      const src = toAbs(at['href'] || '');
      if (!src) continue;
      if (rel.includes('apple-touch-icon')) candidates.push({ src, score: 4 });
      else if (rel.includes('icon')) candidates.push({ src, score: 2 });
    }
    for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
      const at = attrsOf(m[0]);
      if ((at['property'] || '').toLowerCase() === 'og:image') { const src = toAbs(at['content'] || ''); if (src) candidates.push({ src, score: 1 }); }
    }
    candidates.sort((x, y) => y.score - x.score);
    let logo = candidates[0]?.src || '';
    if (!logo) { try { logo = 'https://www.google.com/s2/favicons?domain=' + new URL(url).hostname + '&sz=128'; } catch {} }

    // ── COLORS ──
    const allColors: Record<string, number> = {};

    // 1. Check <meta name="theme-color">
    let themeColor = '';
    const themeMeta = html.match(/<meta\b[^>]*name=[\"']theme-color[\"'][^>]*content=[\"']([^\"']+)[\"'][^>]*>/i);
    if (themeMeta) themeColor = themeMeta[1].trim();

    // 2. Extract hex colors (#rrggbb and #rgb)
    const hexRe = /#([0-9a-fA-F]{6})\b/g;
    let m;
    while ((m = hexRe.exec(html + '\n' + stylesheetText)) !== null) {
      const hex = '#' + m[1].toLowerCase();
      allColors[hex] = (allColors[hex] || 0) + 1;
    }

    // 3. Extract rgb() and rgba() colors
    const rgbRe = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g;
    while ((m = rgbRe.exec(html + '\n' + stylesheetText)) !== null) {
      const hex = rgbToHex(parseInt(m[1]), parseInt(m[2]), parseInt(m[3]));
      allColors[hex] = (allColors[hex] || 0) + 1;
    }

    // 3b. Extract HSL/HSLA colors as used by modern CSS frameworks.
    const hslRe = /hsla?\(\s*([\d.+-]+)(?:deg)?\s*[, ]\s*([\d.+-]+)%\s*[, ]\s*([\d.+-]+)%/gi;
    while ((m = hslRe.exec(html + '\n' + stylesheetText)) !== null) {
      const hex = hslToHex(Number(m[1]), Number(m[2]), Number(m[3]));
      allColors[hex] = (allColors[hex] || 0) + 1;
    }

    // 4. Extract colors from style="" attributes on key elements
    const styleRe = /style="[^"]*(?:background(?:-color)?|color|border-color)\s*:\s*([^;"]+)/gi;
    while ((m = styleRe.exec(html)) !== null) {
      const val = m[1].trim();
      const hexMatch = val.match(/#([0-9a-fA-F]{6})\b/);
      if (hexMatch) { const h = '#' + hexMatch[1].toLowerCase(); allColors[h] = (allColors[h] || 0) + 3; } // extra weight for inline styles
      const rgbMatch = val.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (rgbMatch) { const h = rgbToHex(parseInt(rgbMatch[1]), parseInt(rgbMatch[2]), parseInt(rgbMatch[3])); allColors[h] = (allColors[h] || 0) + 3; }
    }

    // 5. Extract from <style> blocks - look for body, header, nav, a, .btn colors
    const styleBlocks = html.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || [];
    for (const block of styleBlocks) {
      const innerHex = /#([0-9a-fA-F]{6})\b/g;
      while ((m = innerHex.exec(block)) !== null) {
        const hex = '#' + m[1].toLowerCase();
        allColors[hex] = (allColors[hex] || 0) + 2; // extra weight for stylesheet colors
      }
      const innerRgb = /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/g;
      while ((m = innerRgb.exec(block)) !== null) {
        const hex = rgbToHex(parseInt(m[1]), parseInt(m[2]), parseInt(m[3]));
        allColors[hex] = (allColors[hex] || 0) + 2;
      }
    }

    // Filter out grays, near-white, near-black
    const meaningful: [string, number][] = [];
    for (const [hex, count] of Object.entries(allColors)) {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      const isGray = Math.abs(r - g) < 25 && Math.abs(g - b) < 25;
      const isTooLight = r > 220 && g > 220 && b > 220;
      const isTooDark = r < 30 && g < 30 && b < 30;
      if (!isGray && !isTooLight && !isTooDark) {
        meaningful.push([hex, count]);
      }
    }
    meaningful.sort((a, b) => b[1] - a[1]);

    // Prefer exact colors declared by the site's CSS variables/root styles before
    // falling back to frequency-based color discovery. This restores the V12-style
    // "read the real website palette and apply it as-is" behavior.
    let backgroundColor = '';
    let textColor = '';
    let fontFamily = '';
    const styleSource = [html, stylesheetText, ...styleBlocks].join('\n');
    const readCssVarColor = (names: string[]) => {
      for (const name of names) {
        const re = new RegExp(`--${name}\\s*:\\s*([^;}]*)`, 'i');
        const match = styleSource.match(re);
        if (match) {
          const color = normaliseColor(match[1].trim());
          if (color) return color;
        }
      }
      return '';
    };
    const variablePrimary = readCssVarColor(['primary-color', 'brand-primary', 'color-primary', 'primary']);
    const variableSecondary = readCssVarColor(['secondary-color', 'brand-secondary', 'color-secondary', 'secondary']);
    const variableBackground = readCssVarColor(['background-color', 'brand-background', 'color-background', 'background', 'bg']);
    const variableText = readCssVarColor(['text-color', 'brand-text', 'color-text', 'text', 'foreground']);

    const bodyMatch = styleSource.match(/(?:body|html|:root)[^{]*\{[^}]*\}/i);
    if (bodyMatch) {
      const block = bodyMatch[0];
      const bg = block.match(/background(?:-color)?\s*:\s*([^;}]+)/i);
      const fg = block.match(/(?:^|[;\s])color\s*:\s*([^;}]+)/i);
      const ff = block.match(/font-family\s*:\s*([^;}]+)/i);
      if (bg) backgroundColor = normaliseColor(bg[1]);
      if (fg) textColor = normaliseColor(fg[1]);
      if (ff) fontFamily = ff[1].trim().replace(/["']/g, '');
    }
    if (!fontFamily) {
      const ff = styleSource.match(/font-family\s*:\s*([^;}]+)/i);
      if (ff) fontFamily = ff[1].trim().replace(/["']/g, '');
    }

    backgroundColor = variableBackground || backgroundColor;
    textColor = variableText || textColor;

    if (!backgroundColor) {
      const bgCandidates = Object.entries(allColors)
        .map(([hex,count]) => [hex,count] as [string,number])
        .filter(([hex]) => {
          const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
          return r > 235 && g > 235 && b > 235;
        })
        .sort((x,y)=>y[1]-x[1]);
      backgroundColor = bgCandidates[0]?.[0] || '';
    }
    if (!textColor) {
      const textCandidates = Object.entries(allColors)
        .map(([hex,count]) => [hex,count] as [string,number])
        .filter(([hex]) => {
          const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
          return r < 90 && g < 90 && b < 90;
        })
        .sort((x,y)=>y[1]-x[1]);
      textColor = textCandidates[0]?.[0] || '';
    }

    if (!backgroundColor) backgroundColor = '#ffffff';
    if (!textColor) textColor = '#111827';

    const primary = variablePrimary || normaliseColor(themeColor) || (meaningful.length > 0 ? meaningful[0][0] : '');
    const secondary = variableSecondary || (meaningful.length > 1 ? meaningful[1][0] : primary);

    const result = {
      logo_url: logo,
      primary_color: primary,
      secondary_color: secondary,
      background_color: backgroundColor,
      text_color: textColor,
      font_family: fontFamily,
    };
    appearanceCacheSet(url, result);
    return NextResponse.json(result, { headers: { 'X-Cache': 'MISS' } });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/brand-appearance' } });
    const message = err instanceof Error ? err.message : 'Brand appearance extraction failed.';
    return NextResponse.json(
      { error: message },
      { status: 502, headers: { 'X-Cache': 'MISS' } },
    );
  }
}
