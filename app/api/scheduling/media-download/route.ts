export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { apiGuard, assertPublicHttpUrl, fetchPublicResource, readResponseLimited } from '@/lib/server';

const MAX_BYTES = 20 * 1024 * 1024;
const TYPES = new Set(['image/png','image/jpeg','image/jpg','image/webp','image/gif','image/avif']);
const EXT: Record<string,string> = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', gif:'image/gif', avif:'image/avif' };

export async function GET(req: NextRequest) {
  const limited = await apiGuard(req, { rateLimit: 120, scope: 'media-download' });
  if (limited) return limited;
  try {
    const raw = req.nextUrl.searchParams.get('url') || '';
    const url = await assertPublicHttpUrl(raw);
    const res = await fetchPublicResource(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SparrowMediaDownload/1.0)', Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return new NextResponse('Image unavailable.', { status: 404 });
    let type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!TYPES.has(type)) {
      const ext = new URL(url).pathname.split('.').pop()?.toLowerCase() || '';
      type = EXT[ext] || type;
    }
    if (!TYPES.has(type)) return new NextResponse('Unsupported image type.', { status: 415 });
    const bytes = await readResponseLimited(res, MAX_BYTES);
    const ext = type === 'image/jpeg' || type === 'image/jpg' ? 'jpg' : type.split('/')[1];
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        'Content-Type': type === 'image/jpg' ? 'image/jpeg' : type,
        'Content-Disposition': `attachment; filename="sparrow-post.${ext}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new NextResponse('Unable to download image.', { status: 404 });
  }
}
