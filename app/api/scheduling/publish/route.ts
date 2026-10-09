export const runtime = 'nodejs';
export const maxDuration = 300;
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { publishToProvider } from '@/lib/scheduling';

function normalizePlatforms(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item: any) => typeof item === 'string' ? { account_id: item } : { account_id: String(item?.account_id || item?.social_account_id || ''), provider: item?.provider }).filter(x => x.account_id);
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization') || '';
  if (cronSecret && auth !== `Bearer ${cronSecret}`) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const admin = getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: 'Supabase service role is not configured.' }, { status: 500 });

  const now = new Date().toISOString();
  const { data: posts, error } = await admin.from('scheduled_posts').select('*').eq('status', 'scheduled').lte('scheduled_at', now).order('scheduled_at', { ascending: true }).limit(20);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results: any[] = [];
  for (const post of posts || []) {
    const { data: claimed } = await admin.from('scheduled_posts').update({ status: 'publishing', updated_at: new Date().toISOString() }).eq('id', post.id).eq('status', 'scheduled').select('id').maybeSingle();
    if (!claimed) continue;

    const platformRefs = normalizePlatforms(post.platforms);
    const accountIds = platformRefs.map(x => x.account_id);
    const { data: accounts } = accountIds.length
      ? await admin.from('social_accounts').select('*').in('id', accountIds).eq('status', 'connected')
      : { data: [] as any[] };
    const accountMap = new Map((accounts || []).map((a: any) => [a.id, a]));

    const media = Array.isArray(post.media) ? post.media[0] : null;
    const publishPost = {
      ...post,
      caption_text: post.caption || '',
      media_url: media?.url || media?.media_url || null,
      media_type: media?.type || media?.media_type || null,
    };

    let failures = 0;
    let publishedCount = 0;
    for (const ref of platformRefs) {
      const account = accountMap.get(ref.account_id);
      if (!account) { failures++; continue; }
      try {
        const published = await publishToProvider(account, publishPost);
        publishedCount++;
        await admin.from('social_publish_logs').insert({
          scheduled_post_id: post.id,
          social_account_id: account.id,
          user_id: post.user_id,
          project_id: post.project_id,
          provider: account.provider,
          status: 'published',
          provider_post_id: published.id || null,
          attempted_at: new Date().toISOString(),
          published_at: new Date().toISOString(),
        });
      } catch (err) {
        failures++;
        const message = err instanceof Error ? err.message : 'Publishing failed.';
        await admin.from('social_publish_logs').insert({
          scheduled_post_id: post.id,
          social_account_id: account.id,
          user_id: post.user_id,
          project_id: post.project_id,
          provider: account.provider,
          status: 'failed',
          error_message: message,
          attempted_at: new Date().toISOString(),
        });
      }
    }

    const status = failures === 0 && publishedCount > 0 ? 'published' : publishedCount > 0 ? 'partially_published' : 'failed';
    await admin.from('scheduled_posts').update({
      status,
      published_at: publishedCount > 0 ? new Date().toISOString() : null,
      last_error: failures ? `${failures} destination(s) failed.` : null,
      updated_at: new Date().toISOString(),
    }).eq('id', post.id);
    results.push({ id: post.id, status, failures, published: publishedCount });
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}
