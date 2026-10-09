import { cleanGeneratedHtml, cleanGeneratedText } from '@/lib/content-cleanup';
export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient, getUserFromToken } from '@/lib/supabase';

function auth(req: NextRequest) {
  return req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim() || '';
}
function textFromHtml(html: string) {
  return cleanGeneratedText(cleanGeneratedHtml(String(html || '')).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/\s+/g, ' ').trim());
}
function normalizePlatforms(value: unknown): Array<{ account_id: string; provider?: string }> {
  if (!Array.isArray(value)) return [];
  return value.map((item: any) => {
    if (typeof item === 'string') return { account_id: item };
    return { account_id: String(item?.account_id || item?.social_account_id || ''), provider: item?.provider ? String(item.provider) : undefined };
  }).filter(x => x.account_id);
}

async function enrichPosts(supabase: any, posts: any[]) {
  const accountIds = [...new Set(posts.flatMap(p => normalizePlatforms(p.platforms).map(x => x.account_id)))];
  let accounts: any[] = [];
  if (accountIds.length) {
    const { data } = await supabase.from('social_accounts')
      .select('id,provider,account_name,account_handle,account_avatar_url,status')
      .in('id', accountIds);
    accounts = data || [];
  }
  const accountMap = new Map(accounts.map(a => [a.id, a]));
  return posts.map((p: any) => {
    const platforms = normalizePlatforms(p.platforms).map((x: any) => ({
      id: x.account_id,
      social_account_id: x.account_id,
      provider: x.provider || accountMap.get(x.account_id)?.provider || '',
      status: p.status,
      social_accounts: accountMap.get(x.account_id) || null,
    }));
    const media = Array.isArray(p.media) ? p.media : [];
    const firstMedia = media[0] || null;
    return {
      ...p,
      title: p.title || '',
      caption_html: p.content_html || `<p>${String(p.caption || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`,
      caption_text: p.caption || textFromHtml(p.content_html || ''),
      media_url: firstMedia?.url || firstMedia?.media_url || null,
      media_type: firstMedia?.type || firstMedia?.media_type || null,
      source_job_id: p.job_id || null,
      source_piece_id: p.brand_snapshot?.source_piece_id || null,
      editor_settings: { fontFamily: p.brand_snapshot?.typography?.fontFamily || 'Inter', fontSize: p.brand_snapshot?.typography?.fontSize || '16px', use_brand_style: true, brand_theme: p.brand_snapshot || null },
      platforms,
    };
  });
}

export async function GET(req: NextRequest) {
  const token = auth(req);
  if (!token) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const user = await getUserFromToken(token).catch(() => null);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const projectId = new URL(req.url).searchParams.get('project');
  if (!projectId) return NextResponse.json({ error: 'project is required.' }, { status: 400 });
  const supabase = getSupabaseClient(token);
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 });

  const [{ data: posts, error: postsError }, { data: jobs, error: jobsError }] = await Promise.all([
    supabase.from('scheduled_posts').select('*').eq('project_id', projectId).eq('user_id', user.id).order('scheduled_at', { ascending: true }).limit(300),
    supabase.from('jobs').select('id,project_id,started_at,status,sections').eq('project_id', projectId).order('started_at', { ascending: false }).limit(100),
  ]);
  if (postsError) return NextResponse.json({ error: postsError.message }, { status: 500 });
  if (jobsError) return NextResponse.json({ error: jobsError.message }, { status: 500 });

  const generated: any[] = [];
  for (const job of jobs || []) {
    const sections = (job.sections || {}) as Record<string, any[]>;
    for (const list of Object.values(sections)) {
      for (const piece of list || []) generated.push({
        jobId: job.id,
        pieceId: piece.id,
        generatedAt: job.started_at,
        generationStatus: job.status,
        title: piece.title || 'Untitled post',
        captionHtml: piece.bodyHtml || '',
        captionText: piece.bodyText || textFromHtml(piece.bodyHtml || ''),
        channel: piece.channel || '',
        format: piece.format || piece.section || '',
        mediaUrl: piece.mediaUrl || null,
        mediaType: piece.mediaType || null,
      });
    }
  }

  const scheduled = await enrichPosts(supabase, posts || []);
  return NextResponse.json({ scheduled, generated }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(req: NextRequest) {
  const token = auth(req);
  if (!token) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const user = await getUserFromToken(token).catch(() => null);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });

  const { projectId, sourceJobId, sourcePieceId, title, captionHtml, captionText, mediaUrl, mediaType, scheduledAt, timezone = 'Asia/Kolkata', editorSettings = {}, accountIds = [] } = body;
  if (!projectId || !scheduledAt || !Array.isArray(accountIds) || accountIds.length === 0) {
    return NextResponse.json({ error: 'projectId, scheduledAt and at least one social account are required.' }, { status: 400 });
  }

  const supabase = getSupabaseClient(token);
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 });

  const { data: accounts, error: accountError } = await supabase.from('social_accounts')
    .select('id,provider,account_name')
    .eq('project_id', projectId).eq('user_id', user.id).eq('status', 'connected').in('id', accountIds);
  if (accountError || !accounts || accounts.length !== accountIds.length) {
    return NextResponse.json({ error: 'One or more selected social accounts are unavailable.' }, { status: 400 });
  }

  const brandSnapshot = { ...(editorSettings?.brand_theme || {}), source_piece_id: sourcePieceId || null, typography: { fontFamily: editorSettings?.fontFamily || null, fontSize: editorSettings?.fontSize || null } };
  const media = mediaUrl ? [{ url: mediaUrl, type: mediaType || 'image', source: 'uploaded' }] : [];
  const platforms = accounts.map((a: any) => ({ account_id: a.id, provider: a.provider }));
  const payload = {
    project_id: projectId,
    user_id: user.id,
    job_id: sourceJobId || null,
    title: title || null,
    caption: textFromHtml(captionText || textFromHtml(captionHtml || '')),
    content_html: cleanGeneratedHtml(captionHtml || ''),
    platforms,
    media,
    brand_snapshot: brandSnapshot,
    scheduled_at: scheduledAt,
    timezone,
    status: 'scheduled',
  };
  const { data: post, error } = await supabase.from('scheduled_posts').insert(payload).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Keep the media table useful for future multi-media posts, without making it a dependency of scheduling.
  if (mediaUrl) {
    try {
      await supabase.from('scheduled_post_media').insert({
        scheduled_post_id: post.id,
        user_id: user.id,
        project_id: projectId,
        media_url: mediaUrl,
        media_type: mediaType || 'image',
        source: 'uploaded',
        sort_order: 0,
      });
    } catch {
      // Media metadata is supplemental; the scheduled post itself remains valid.
    }
  }

  return NextResponse.json({ post }, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const token = auth(req);
  if (!token) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const user = await getUserFromToken(token).catch(() => null);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const body = await req.json().catch(() => null);
  const id = body?.id;
  if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });

  const supabase = getSupabaseClient(token);
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 });

  const { data: existing, error: existingError } = await supabase.from('scheduled_posts').select('*').eq('id', id).eq('user_id', user.id).maybeSingle();
  if (existingError || !existing) return NextResponse.json({ error: 'Scheduled post not found.' }, { status: 404 });

  const patch: any = { updated_at: new Date().toISOString() };
  if ('title' in body) patch.title = body.title || null;
  if ('captionHtml' in body) patch.content_html = cleanGeneratedHtml(body.captionHtml || '');
  if ('captionText' in body) patch.caption = textFromHtml(body.captionText || '');
  if ('scheduledAt' in body) patch.scheduled_at = body.scheduledAt;
  if ('timezone' in body) patch.timezone = body.timezone;
  if ('status' in body) patch.status = body.status;
  if ('editorSettings' in body) {
    patch.brand_snapshot = { ...(body.editorSettings?.brand_theme || {}), source_piece_id: existing.brand_snapshot?.source_piece_id || null, typography: { fontFamily: body.editorSettings?.fontFamily || existing.brand_snapshot?.typography?.fontFamily || null, fontSize: body.editorSettings?.fontSize || existing.brand_snapshot?.typography?.fontSize || null } };
  }
  if ('mediaUrl' in body) patch.media = body.mediaUrl ? [{ url: body.mediaUrl, type: body.mediaType || 'image', source: 'uploaded' }] : [];

  if (Array.isArray(body.accountIds)) {
    const { data: accounts, error: accountError } = await supabase.from('social_accounts')
      .select('id,provider').eq('project_id', existing.project_id).eq('user_id', user.id).eq('status', 'connected').in('id', body.accountIds);
    if (accountError || !accounts || accounts.length !== body.accountIds.length) {
      return NextResponse.json({ error: 'One or more selected social accounts are unavailable.' }, { status: 400 });
    }
    patch.platforms = accounts.map((a: any) => ({ account_id: a.id, provider: a.provider }));
  }

  const { data: post, error } = await supabase.from('scheduled_posts').update(patch).eq('id', id).eq('user_id', user.id).select('*').single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ post });
}

export async function DELETE(req: NextRequest) {
  const token = auth(req);
  if (!token) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const user = await getUserFromToken(token).catch(() => null);
  if (!user) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required.' }, { status: 400 });
  const supabase = getSupabaseClient(token);
  if (!supabase) return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 });
  const { error } = await supabase.from('scheduled_posts').update({ status: 'cancelled', cancelled_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id).eq('user_id', user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
