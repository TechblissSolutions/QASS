export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { apiGuard, assertServerEnv, getStats, errorMessage } from '@/lib/server';
import { pingSupabase } from '@/lib/supabase-admin';
import { getRedis } from '@/lib/redis';

export async function GET(req: NextRequest) {
  const limited = await apiGuard(req, { rateLimit: 10, scope: 'health' }); if (limited) return limited;
  try {
    assertServerEnv();
    const stats = getStats();
    const redis = getRedis();
    let redisOk = false;
    let supabaseOk = false;
    if (redis) { try { await redis.ping(); redisOk = true; } catch (err) { Sentry.captureException(err, { tags: { route: '/api/health', dependency: 'redis' } }); } }
    try { await pingSupabase(); supabaseOk = true; } catch (err) { Sentry.captureException(err, { tags: { route: '/api/health', dependency: 'supabase' } }); }
    const healthy = redisOk && supabaseOk;
    return NextResponse.json({
      status: healthy ? 'ok' : 'degraded',
      version: '2.0.0',
      redis: redisOk,
      supabase: supabaseOk,
      cacheEntries: stats.cacheSize,
    }, { status: healthy ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/health' } });
    return NextResponse.json({ error: 'Health check failed.' }, { status: 500 });
  }
}
