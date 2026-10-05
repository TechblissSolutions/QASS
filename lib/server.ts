import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { edgeMaintenanceEnabled } from './maintenance';
import { getRedis, redisConfigured } from './redis';
import { Agent } from 'undici';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';

const WINDOW_MS = 60_000;
const RATE_LIMIT = Number(process.env.SPARROW_RATE_LIMIT_PER_MINUTE || 30);
const DAILY_LIMIT = Number(process.env.SPARROW_GLOBAL_DAILY_GENERATION_LIMIT || 2000);
const FREE_DAILY_LIMIT = Number(process.env.SPARROW_FREE_DAILY_GENERATION_LIMIT || 10);
const PRO_DAILY_LIMIT = Number(process.env.SPARROW_PRO_DAILY_GENERATION_LIMIT || 100);
const LIVE_TOKEN_TTL_SECONDS = 6 * 60 * 60;
const n8nDispatcher = process.env.N8N_CA_CERT ? new Agent({ connect: { ca: process.env.N8N_CA_CERT, rejectUnauthorized: true } }) : undefined;

type Bucket = { count: number; resetAt: number };
const localBuckets = new Map<string, Bucket>();
const websiteCache = new Map<string, { expiresAt: number; value: string }>();
const appearanceCache = new Map<string, { expiresAt: number; value: unknown }>();
let localDailyCount = 0;
let localDailyDate = localDateKey();
const recentGenerations = new Map<string, number>();

function localDateKey() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

function resetLocalDailyIfNeeded() {
  const today = localDateKey();
  if (today !== localDailyDate) { localDailyDate = today; localDailyCount = 0; }
}

export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function redisFixedWindow(key: string, limit: number, windowSeconds: number) {
  const redis = getRedis();
  if (!redis) return { allowed: true, count: 0, resetSeconds: windowSeconds, shared: false };
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);
  const ttl = Math.max(1, Number(await redis.ttl(key)) || windowSeconds);
  return { allowed: count <= limit, count, resetSeconds: ttl, shared: true };
}

export async function apiGuard(req: NextRequest, options: { rateLimit?: number; requireRedis?: boolean; scope?: string } = {}) {
  const maintenance = enforceMaintenance();
  if (maintenance || await edgeMaintenanceEnabled()) return maintenance || maintenanceResponse();
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown';
  const limit = options.rateLimit ?? RATE_LIMIT;
  const requireRedis = options.requireRedis === true;
  if (process.env.NODE_ENV === 'production' && !redisConfigured() && requireRedis) {
    return NextResponse.json({ error: 'Traffic protection is not configured.' }, { status: 503, headers: { 'Retry-After': '10' } });
  }
  try {
    if (redisConfigured()) {
      const ipKey = createHash('sha256').update(ip).digest('hex');
      const key = `sparrow:rate:${options.scope || 'default'}:${ipKey}`;
      const result = await redisFixedWindow(key, limit, 60);
      if (!result.allowed) {
        return NextResponse.json({ error: 'Too many requests. Please try again in a minute.' }, { status: 429, headers: { 'Retry-After': String(result.resetSeconds) } });
      }
      return null;
    }
  } catch (err) {
    Sentry.captureException(err, { tags: { area: 'redis', operation: 'rate_limit' } });
    if (process.env.NODE_ENV === 'production' && requireRedis) {
      return NextResponse.json({ error: 'Traffic protection is temporarily unavailable. Please retry shortly.' }, { status: 503, headers: { 'Retry-After': '10' } });
    }
  }
  const now = Date.now();
  const bucketKey = `${options.scope || 'default'}:${ip}`;
  const bucket = localBuckets.get(bucketKey);
  if (!bucket || now >= bucket.resetAt) localBuckets.set(bucketKey, { count: 1, resetAt: now + WINDOW_MS });
  else {
    bucket.count += 1;
    if (bucket.count > limit) return NextResponse.json({ error: 'Too many requests. Please try again in a minute.' }, { status: 429, headers: { 'Retry-After': String(Math.ceil((bucket.resetAt - now) / 1000)) } });
  }
  return null;
}

export function botGuard(req: NextRequest) {
  const ua = req.headers.get('user-agent')?.trim();
  if (!ua || /bot|crawler|spider|scraper|headless|curl|wget|python-requests/i.test(ua)) return NextResponse.json({ error: 'Automated clients are not allowed for analysis.' }, { status: 403 });
  return null;
}

export function validateUrl(value: unknown, maxLength = 2048): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) throw new Error('A valid URL is required.');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('A valid URL is required.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only HTTP and HTTPS URLs are allowed.');
  if (url.username || url.password) throw new Error('URLs with embedded credentials are not allowed.');
  return url.toString();
}

export function validateString(value: unknown, name: string, maxLength: number, required = false): string {
  if (value == null) { if (required) throw new Error(`${name} is required.`); return ''; }
  if (typeof value !== 'string' || value.length > maxLength) throw new Error(`${name} is invalid.`);
  if (required && !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

export function validateGeneratePayload(data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid request body.');
  const d = data as Record<string, unknown>;
  const platforms = Array.isArray(d.platforms) ? d.platforms.filter((x): x is string => typeof x === 'string' && x.length <= 80).slice(0, 10) : [];
  if (!platforms.length) throw new Error('At least one platform is required.');
  return {
    company_name: validateString(d.company_name, 'Company name', 200, true), company_website: validateUrl(d.company_website),
    company_summary: validateString(d.company_summary, 'Company summary', 5000), company_details: validateString(d.company_details, 'Company details', 10000),
    target_audience: validateString(d.target_audience, 'Target audience', 3000), company_research: validateString(d.company_research, 'Company research', 15000),
    product: validateString(d.product, 'Product or service', 500), goal: validateString(d.goal, 'Content goal', 300), tone: validateString(d.tone, 'Brand tone', 200),
    style: validateString(d.style, 'Writing style', 200), extra: validateString(d.extra, 'Additional instructions', 5000), regenerate: d.regenerate === true,
    previous_content: validateString(d.previous_content, 'Previous content', 12000),
    platforms,
    brand_theme: d.brand_theme && typeof d.brand_theme === 'object' && !Array.isArray(d.brand_theme) ? d.brand_theme : null,
  };
}

export async function readJsonBody(req: Request, maxBytes: number) {
  const contentLength = Number(req.headers.get('content-length') || 0);
  if (contentLength > maxBytes) throw new Error('Request body is too large.');
  const text = await req.text();
  if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error('Request body is too large.');
  try { return JSON.parse(text); } catch { throw new Error('Invalid JSON request body.'); }
}

function isPrivateIp(address: string) {
  const version = net.isIP(address);
  if (version === 4) {
    const [a,b] = address.split('.').map(Number);
    return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a === 0 || a >= 224;
  }
  const normalized = address.toLowerCase();
  if (normalized.startsWith('::ffff:')) {
    const mapped = normalized.slice('::ffff:'.length);
    if (net.isIP(mapped) === 4) return isPrivateIp(mapped);
    const parts = mapped.split(':');
    if (parts.length === 2 && parts.every(part => /^[0-9a-f]{1,4}$/.test(part))) {
      const high = Number.parseInt(parts[0], 16);
      const low = Number.parseInt(parts[1], 16);
      return isPrivateIp(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
  }
  return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:') || normalized.startsWith('ff');
}

export async function isPrivateHost(rawUrl: string) {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) return true;
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || net.isIP(host)) return net.isIP(host) ? isPrivateIp(host) : true;
  try {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    return records.some(record => isPrivateIp(record.address));
  } catch {
    return true;
  }
}

export async function assertPublicHttpUrl(rawUrl: string) {
  const url = validateUrl(rawUrl);
  if (await isPrivateHost(url)) throw new Error('Private or local network addresses are not allowed.');
  return url;
}

export function n8nHeaders(extra: Record<string, string> = {}) {
  return { ...extra };
}

/** Build n8n endpoints safely. This intentionally tolerates a trailing slash on N8N_BASE
 * and a leading slash on the configured path so we never send requests to `//webhook/...`.
 * A full URL in a path variable is also accepted for migrations/self-hosted setups.
 */
export function n8nEndpoint(path: string) {
  const rawPath = String(path || '').trim();
  if (/^https?:\/\//i.test(rawPath)) return rawPath;
  const base = String(process.env.N8N_BASE || '').trim().replace(/\/+$/, '');
  const cleanPath = rawPath.replace(/^\/+/, '');
  if (!base || !cleanPath) throw new Error('n8n endpoint is not configured correctly.');
  return `${base}/${cleanPath}`;
}


export async function fetchPublicResource(rawUrl: string, init: RequestInit = {}, maxRedirects = 3): Promise<Response> {
  // V12 used the normal Node/Next fetch path for public websites. Keep the
  // important SSRF protections here, but do not force a socket-level IP pin:
  // that custom Undici dispatcher caused HTTPS/CDN sites to fail with the
  // generic `fetch failed` error even though the same URLs worked normally.
  // Every initial URL and every redirect is still validated before fetching.
  let current = await assertPublicHttpUrl(rawUrl);
  for (let attempt = 0; attempt <= maxRedirects; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const signal = init.signal
        ? AbortSignal.any([controller.signal, init.signal])
        : controller.signal;
      const response = await fetch(current, {
        ...init,
        redirect: 'manual',
        cache: 'no-store',
        signal,
      } as RequestInit);
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get('location');
      if (!location || attempt === maxRedirects) return response;
      current = await assertPublicHttpUrl(new URL(location, current).toString());
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('Too many redirects while fetching a public resource.');
}

export async function readResponseLimited(res: Response, maxBytes: number) {
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new Error('Upstream response is too large.');
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) { await reader.cancel(); throw new Error('Upstream response is too large.'); }
        chunks.push(value);
      }
    }
  } finally { reader.releaseLock(); }
  const out = new Uint8Array(total); let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

export async function fetchWithRetry(input: RequestInfo | URL, init: RequestInit = {}, timeoutMs = 15_000, retries = 1) {
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const isN8n = url.startsWith(process.env.N8N_BASE || '__not_n8n__');
    const dispatcher = isN8n ? n8nDispatcher : undefined;
    try {
      const res = await fetch(input, { ...init, signal: controller.signal, cache: 'no-store', ...(dispatcher ? { dispatcher } : {}) } as RequestInit);
      if (res.ok || attempt === retries) return res;
      last = new Error(`Upstream returned ${res.status}`);
      if (isN8n && attempt === retries) Sentry.captureMessage(`n8n returned HTTP ${res.status}`, { level: 'error', tags: { area: 'n8n', operation: 'fetch' }, extra: { url, status: res.status } });
    } catch (err) {
      last = err;
      if (isN8n && attempt === retries) Sentry.captureException(err, { tags: { area: 'n8n', operation: 'fetch' }, extra: { url, attempt } });
      if (attempt === retries) throw err;
    } finally { clearTimeout(timer); }
  }
  throw last instanceof Error ? last : new Error('Upstream request failed.');
}

export async function withGenerationSlot<T>(fn: () => Promise<T>): Promise<T> {
  const redis = getRedis();
  if (redis) {
    const key = `sparrow:generations:${localDateKey()}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, 172800);
    if (count > DAILY_LIMIT) { await redis.decr(key); throw new Error('Daily generation limit reached. Please try again tomorrow.'); }
    try { return await fn(); }
    catch (err) { await redis.decr(key).catch(() => undefined); throw err; }
  }
  if (process.env.NODE_ENV === 'production') throw new Error('Shared traffic protection is not configured.');
  resetLocalDailyIfNeeded();
  if (localDailyCount >= DAILY_LIMIT) throw new Error('Daily generation limit reached. Please try again tomorrow.');
  localDailyCount += 1;
  try { return await fn(); }
  catch (err) { localDailyCount = Math.max(0, localDailyCount - 1); throw err; }
}

export async function withUserGenerationQuota<T>(userId: string, plan: 'free' | 'pro' | 'owner', fn: () => Promise<T>): Promise<T> {
  if (plan === 'owner') return fn();
  const redis = getRedis();
  if (!redis) {
    if (process.env.NODE_ENV === 'production') throw new Error('Generation quota protection is temporarily unavailable. Please retry shortly.');
    return fn();
  }
  const limit = plan === 'pro' ? PRO_DAILY_LIMIT : FREE_DAILY_LIMIT;
  const key = `sparrow:user-generations:${plan}:${userId}:${localDateKey()}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, 172800);
  if (count > limit) { await redis.decr(key); throw new Error(`Daily ${plan} generation limit reached. Please try again tomorrow.`); }
  try { return await fn(); }
  catch (err) { await redis.decr(key).catch(() => undefined); throw err; }
}

export function isMaintenanceMode() { return String(process.env.MAINTENANCE_MODE || 'false').toLowerCase() === 'true'; }
export function maintenanceResponse() { return NextResponse.json({ error: 'Sparrow is temporarily under maintenance. Please try again shortly.' }, { status: 503, headers: { 'Retry-After': '300' } }); }
export function enforceMaintenance() { return isMaintenanceMode() ? maintenanceResponse() : null; }
export function getStats() { resetLocalDailyIfNeeded(); return { cacheSize: websiteCache.size + appearanceCache.size, sharedRateLimit: redisConfigured() }; }

function cacheGet<T>(map: Map<string, { expiresAt: number; value: T }>, key: string): T | undefined { const item = map.get(key); if (!item) return undefined; if (Date.now() >= item.expiresAt) { map.delete(key); return undefined; } return item.value; }
function cacheSet<T>(map: Map<string, { expiresAt: number; value: T }>, key: string, value: T, ttlMs: number) { if (map.size > 500) { const first = map.keys().next().value; if (first) map.delete(first); } map.set(key, { value, expiresAt: Date.now() + ttlMs }); }
export const websiteCacheGet = (key: string) => cacheGet(websiteCache, key);
export const websiteCacheSet = (key: string, value: string) => { if (Buffer.byteLength(value, 'utf8') <= 512 * 1024) cacheSet(websiteCache, key, value, 30 * 60_000); };
export const appearanceCacheGet = (key: string) => cacheGet(appearanceCache, key);
export const appearanceCacheSet = (key: string, value: unknown) => cacheSet(appearanceCache, key, value, 60 * 60_000);

/**
 * Server-side HTML boundary for content returned by the n8n generation workflow.
 *
 * IMPORTANT: this intentionally does NOT change the n8n request/response flow.
 * It only makes the HTML safer before it is returned to the browser or rendered
 * with dangerouslySetInnerHTML.
 *
 * We keep the sanitizer dependency-free because this project is deployed as a
 * Next.js serverless app. The implementation uses a conservative tag/attribute
 * allowlist and treats malformed markup as untrusted input.
 */
const SAFE_HTML_TAGS = new Set([
  'a', 'abbr', 'article', 'aside', 'b', 'blockquote', 'br', 'caption', 'code',
  'div', 'em', 'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5',
  'h6', 'header', 'hr', 'i', 'img', 'li', 'main', 'nav', 'ol', 'p', 'pre',
  'section', 'small', 'span', 'strong', 'sub', 'sup', 'table', 'tbody', 'td',
  'tfoot', 'th', 'thead', 'tr', 'u', 'ul'
]);
// Tags removed together with their content.
const DROP_HTML_TAGS = new Set(['style', 'script', 'iframe', 'object', 'embed', 'form', 'button', 'textarea', 'select', 'option', 'svg', 'math', 'template', 'title']);
// Void tags have no closing tag and no content: remove only the tag itself.
// (Treating <meta>/<link> as block tags used to delete the whole document that followed them.)
const VOID_DROP_HTML_TAGS = new Set(['meta', 'link', 'base', 'input']);
const SAFE_DATA_ATTR = /^data-[a-z0-9_-]{1,60}$/;
const SAFE_ATTRS = new Set(['alt', 'aria-label', 'aria-hidden', 'class', 'colspan', 'height', 'href', 'id', 'loading', 'name', 'rel', 'role', 'rowspan', 'src', 'style', 'target', 'title', 'width']);

function safeUrl(value: string, allowDataImage = false): string {
  const v = value.trim();
  if (!v) return '';
  if (allowDataImage && /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(v)) return v;
  try {
    const u = new URL(v, 'https://sparrow.local');
    if (!['http:', 'https:', 'mailto:'].includes(u.protocol)) return '';
    return v;
  } catch { return ''; }
}

function sanitizeAttrs(raw: string, tag: string): string {
  const attrs: string[] = [];
  const attrRe = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(raw))) {
    const name = m[1].toLowerCase();
    if (name.startsWith('on') || name.startsWith('xmlns') || !(SAFE_ATTRS.has(name) || SAFE_DATA_ATTR.test(name))) continue;
    let value = m[2] ?? m[3] ?? m[4] ?? '';
    if (name === 'style') continue;
    if (name === 'href') {
      value = safeUrl(value);
      if (!value) continue;
    }
    if (name === 'src') {
      value = safeUrl(value, true);
      if (!value) continue;
    }
    if (name === 'target' && !['_blank', '_self', '_parent', '_top'].includes(value)) continue;
    if (name === 'rel') value = value.replace(/[^a-zA-Z0-9 _-]/g, '');
    attrs.push(value ? `${name}="${value.replace(/&(?!(?:[a-z][a-z0-9]{1,31}|#\d{1,7}|#x[0-9a-f]{1,6});)/gi, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }"` : name);
  }
  if (tag === 'a' && attrs.some(a => a.startsWith('target="_blank"')) && !attrs.some(a => a.startsWith('rel='))) attrs.push('rel="noopener noreferrer"');
  return attrs.length ? ' ' + attrs.join(' ') : '';
}

export function sanitizeHtml(html: string) {
  let input = String(html || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!doctype[^>]*>/gi, '');
  for (const tag of VOID_DROP_HTML_TAGS) input = input.replace(new RegExp(`<${tag}\\b[^>]*>`, 'ig'), '');
  // Remove complete dangerous blocks first, then remove any unclosed dangerous block
  // and everything after it. This avoids leaving executable content behind when markup is malformed.
  for (const tag of DROP_HTML_TAGS) {
    input = input.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'ig'), '');
    input = input.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*$`, 'ig'), '');
    input = input.replace(new RegExp(`<${tag}\\b[^>]*/\\s*>`, 'ig'), '');
  }

  // Generated style blocks are not trusted content. The preview renderer supplies
  // its own layout styles, so drop remote/executable CSS at the trust boundary.
  input = input.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '');

  return input.replace(/<\/?\s*([a-zA-Z][\w:-]*)([^>]*)>/g, (full, rawTag: string, rawAttrs: string) => {
    const tag = rawTag.toLowerCase();
    if (!SAFE_HTML_TAGS.has(tag)) return '';
    if (full.startsWith('</')) return `</${tag}>`;
    const selfClosing = /\/\s*>$/.test(full) || tag === 'br' || tag === 'hr' || tag === 'img';
    return `<${tag}${sanitizeAttrs(rawAttrs.replace(/\/\s*$/, ''), tag)}${selfClosing ? ' />' : '>'}`;
  });
}

export function isN8nErrorHtml(html: string) {
  const raw = String(html || '');
  const title = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase() || '';
  const text = raw.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  if (/^(error|internal server error|application error|bad gateway|gateway timeout)$/.test(title)) return true;
  if (/workflow execution failed|internal server error|bad gateway|gateway timeout/.test(text)) return true;
  return /n8n[^.]{0,80}(error|exception|failed)/i.test(text);
}

export function errorMessage(err: unknown, fallback = 'Unexpected server error.') { return err && typeof err === 'object' && 'message' in err && typeof (err as {message?:unknown}).message === 'string' ? String((err as {message:string}).message) : fallback; }

function b64(value: string) { return Buffer.from(value).toString('base64url'); }
function unb64(value: string) { return Buffer.from(value, 'base64url').toString('utf8'); }
export function createLiveViewToken(jobId: string, userId?: string | null) {
  const secret = env('SPARROW_LIVE_VIEW_SECRET');
  const payload = JSON.stringify({ jobId, userId: userId || null, exp: Math.floor(Date.now() / 1000) + LIVE_TOKEN_TTL_SECONDS });
  const encoded = b64(payload); const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}
export function verifyLiveViewToken(token: string, jobId: string) {
  try {
    const secret = env('SPARROW_LIVE_VIEW_SECRET');
    const [encoded, signature] = token.split('.'); if (!encoded || !signature) return null;
    const expected = createHmac('sha256', secret).update(encoded).digest('base64url');
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    const payload = JSON.parse(unb64(encoded));
    if (payload.jobId !== jobId || typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { userId: typeof payload.userId === 'string' ? payload.userId : null };
  } catch { return null; }
}

/** Prevent duplicate generation submissions within a short window. */
export async function checkGenerationDedup(userId: string, projectId: string): Promise<boolean> {
  const key = `sparrow:dedup:generation:${userId}:${projectId}`;
  const redis = getRedis();
  if (redis) {
    try {
      const result = await redis.set(key, String(Date.now()), { nx: true, ex: 10 });
      return result === 'OK';
    } catch (err) {
      Sentry.captureException(err, { tags: { area: 'redis', operation: 'generation_dedup' } });
      if (process.env.NODE_ENV === 'production') throw new Error('Generation protection is temporarily unavailable. Please retry shortly.');
    }
  }

  const now = Date.now();
  const last = recentGenerations.get(key);
  if (last && now - last < 10_000) return false;
  recentGenerations.set(key, now);
  if (recentGenerations.size > 500) {
    for (const [k, t] of recentGenerations) { if (now - t > 30_000) recentGenerations.delete(k); }
  }
  return true;
}

export { assertServerEnv } from './env';
