export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { apiGuard, assertPublicHttpUrl, fetchPublicResource, readResponseLimited } from '@/lib/server';
import { requestId } from '@/lib/logger';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/ico']);
const EXT_TYPES: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon' };

export async function GET(req: NextRequest) {
  const rid = requestId();
  const limited = await apiGuard(req, { rateLimit: 240, scope: 'brand-logo' });
  if (limited) return limited;
  try {
    const src = req.nextUrl.searchParams.get('src');
    if (!src || src.length > 2048) return new NextResponse(null, { status: 400, headers: { 'X-Request-ID': rid } });
    const url = await assertPublicHttpUrl(src);
    const res = await fetchPublicResource(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SparrowBrandLogo/1.0)', Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8' } });
    if (!res.ok) return new NextResponse(null, { status: 404, headers: { 'X-Request-ID': rid } });
    let type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const buffer = await readResponseLimited(res, MAX_LOGO_BYTES);
    // Many company sites serve logos without a useful MIME type. Infer the type
    // from the file extension and, for SVG, from the actual bytes before rejecting it.
    if (!ALLOWED_TYPES.has(type)) {
      const ext = new URL(url).pathname.split('.').pop()?.toLowerCase() || '';
      if (EXT_TYPES[ext]) type = EXT_TYPES[ext];
      if (!ALLOWED_TYPES.has(type)) {
        const head = new TextDecoder().decode(buffer.slice(0, 512)).trimStart();
        if (/^(?:<\?xml[^>]*>\s*)?<svg\b/i.test(head)) type = 'image/svg+xml';
        else if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) type = 'image/png';
        else if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) type = 'image/jpeg';
        else if (buffer.length >= 12 && new TextDecoder().decode(buffer.slice(0, 12)) === 'RIFF' && new TextDecoder().decode(buffer.slice(8, 12)) === 'WEBP') type = 'image/webp';
      }
    }
    if (!ALLOWED_TYPES.has(type)) return new NextResponse(null, { status: 415, headers: { 'X-Request-ID': rid } });
    return new NextResponse(buffer, { status: 200, headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': type === 'image/svg+xml' ? "default-src 'none'; sandbox" : "default-src 'none'", 'Cross-Origin-Resource-Policy': 'same-origin', 'X-Request-ID': rid } });
  } catch {
    return new NextResponse(null, { status: 404, headers: { 'X-Request-ID': rid } });
  }
}
