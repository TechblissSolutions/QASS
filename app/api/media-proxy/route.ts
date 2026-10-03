export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { apiGuard, assertPublicHttpUrl, fetchPublicResource, readResponseLimited } from '@/lib/server';

const MAX_BYTES = 20 * 1024 * 1024;
const TYPES = new Set(['image/png','image/jpeg','image/jpg','image/webp','image/gif','image/avif','image/svg+xml','video/mp4','video/webm','video/quicktime']);

export async function GET(req: NextRequest) {
  const limited = await apiGuard(req, { rateLimit: 240, scope: 'media-proxy' });
  if (limited) return limited;
  try {
    const raw = req.nextUrl.searchParams.get('url') || '';
    const url = await assertPublicHttpUrl(raw);
    const res = await fetchPublicResource(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SparrowMediaProxy/1.0)', Accept: 'image/avif,image/webp,image/*,video/mp4,video/webm,*/*;q=0.8' },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return new NextResponse(null, { status: 404 });
    let type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (type === 'application/octet-stream' || !TYPES.has(type)) {
      const ext = new URL(url).pathname.split('.').pop()?.toLowerCase() || '';
      const byExt: Record<string,string> = { png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',avif:'image/avif',svg:'image/svg+xml',mp4:'video/mp4',webm:'video/webm',mov:'video/quicktime' };
      type = byExt[ext] || type;
    }
    if (!TYPES.has(type)) return new NextResponse(null, { status: 415 });
    const bytes = await readResponseLimited(res, MAX_BYTES);
    return new NextResponse(bytes, { status: 200, headers: {
      'Content-Type': type,
      'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
    }});
  } catch { return new NextResponse(null, { status: 404 }); }
}
