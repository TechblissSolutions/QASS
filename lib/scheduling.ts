import 'server-only';
import crypto from 'node:crypto';
import { getSupabaseAdmin } from './supabase-admin';

export type SocialProvider = 'linkedin' | 'facebook' | 'instagram' | 'x' | 'youtube' | 'wordpress';
export type ScheduleStatus = 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled';

const KEY = process.env.SPARROW_SOCIAL_ENCRYPTION_KEY || '';

function keyBytes() {
  if (!KEY || KEY.length < 32) throw new Error('SPARROW_SOCIAL_ENCRYPTION_KEY must be configured with at least 32 characters.');
  return crypto.createHash('sha256').update(KEY).digest();
}

export function encryptSecret(value: string | null | undefined) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBytes(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function decryptSecret(value: string | null | undefined) {
  if (!value) return null;
  const [ivRaw, tagRaw, dataRaw] = value.split('.');
  if (!ivRaw || !tagRaw || !dataRaw) throw new Error('Invalid encrypted social credential.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBytes(), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataRaw, 'base64url')), decipher.final()]).toString('utf8');
}

export function signState(payload: Record<string, unknown>) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 10 * 60_000 })).toString('base64url');
  const secret = process.env.SPARROW_LIVE_VIEW_SECRET;
  if (!secret || secret.length < 32) throw new Error('SPARROW_LIVE_VIEW_SECRET must be configured with at least 32 characters.');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyState(value: string) {
  const [body, sig] = value.split('.');
  if (!body || !sig) throw new Error('Invalid OAuth state.');
  const secret = process.env.SPARROW_LIVE_VIEW_SECRET;
  if (!secret || secret.length < 32) throw new Error('OAuth state verification is not configured.');
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const actualBytes = Buffer.from(sig); const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) throw new Error('Invalid OAuth state signature.');
  const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
  if (Number(parsed.exp) < Date.now()) throw new Error('OAuth state expired.');
  return parsed;
}

export const providerMeta: Record<SocialProvider, { label: string; color: string }> = {
  linkedin: { label: 'LinkedIn', color: '#0A66C2' },
  facebook: { label: 'Facebook', color: '#1877F2' },
  instagram: { label: 'Instagram', color: '#E4405F' },
  x: { label: 'X', color: '#111111' },
  youtube: { label: 'YouTube', color: '#FF0000' },
  wordpress: { label: 'WordPress', color: '#21759B' },
};

export function providerConfigured(provider: SocialProvider) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SPARROW_SOCIAL_ENCRYPTION_KEY || process.env.SPARROW_SOCIAL_ENCRYPTION_KEY.length < 32 || !process.env.SPARROW_LIVE_VIEW_SECRET || process.env.SPARROW_LIVE_VIEW_SECRET.length < 32) return false;
  if (provider === 'linkedin') return Boolean(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET);
  if (provider === 'facebook' || provider === 'instagram') return Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET);
  if (provider === 'x') return Boolean(process.env.X_CLIENT_ID && process.env.X_CLIENT_SECRET);
  if (provider === 'youtube') return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  if (provider === 'wordpress') return Boolean(process.env.WORDPRESS_CLIENT_ID && process.env.WORDPRESS_CLIENT_SECRET);
  return false;
}

export function oauthUrl(provider: SocialProvider, state: string, redirectUri: string, codeChallenge?: string) {
  const u = new URL(provider === 'linkedin'
    ? 'https://www.linkedin.com/oauth/v2/authorization'
    : provider === 'x'
      ? 'https://twitter.com/i/oauth2/authorize'
      : provider === 'youtube'
        ? 'https://accounts.google.com/o/oauth2/v2/auth'
        : provider === 'wordpress'
          ? 'https://public-api.wordpress.com/oauth2/authorize'
          : 'https://www.facebook.com/v24.0/dialog/oauth');
  if (provider === 'linkedin') {
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', process.env.LINKEDIN_CLIENT_ID!);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('state', state);
    u.searchParams.set('scope', 'openid profile email w_member_social');
  } else if (provider === 'x') {
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', process.env.X_CLIENT_ID!);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('scope', 'tweet.read tweet.write users.read offline.access');
    u.searchParams.set('state', state);
    u.searchParams.set('code_challenge', crypto.createHash('sha256').update(codeChallenge || '').digest('base64url'));
    u.searchParams.set('code_challenge_method', 'S256');
  } else if (provider === 'facebook' || provider === 'instagram') {
    u.searchParams.set('client_id', process.env.META_APP_ID!);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('state', state);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish');
  } else if (provider === 'youtube') {
    u.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID!);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('state', state);
    u.searchParams.set('scope', 'openid profile email https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload');
    u.searchParams.set('access_type', 'offline');
    u.searchParams.set('prompt', 'consent');
  } else if (provider === 'wordpress') {
    u.searchParams.set('client_id', process.env.WORDPRESS_CLIENT_ID!);
    u.searchParams.set('redirect_uri', redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('state', state);
    u.searchParams.set('scope', 'global');
  }
  return u.toString();
}

async function exchangeCode(provider: SocialProvider, code: string, redirectUri: string, codeVerifier?: string) {
  if (provider === 'linkedin') {
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, client_id: process.env.LINKEDIN_CLIENT_ID!, client_secret: process.env.LINKEDIN_CLIENT_SECRET!, redirect_uri: redirectUri });
    const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (!res.ok) throw new Error(`LinkedIn token exchange failed (${res.status}).`);
    return await res.json() as any;
  }
  if (provider === 'x') {
    const basic = Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString('base64');
    const body = new URLSearchParams({ code, grant_type: 'authorization_code', client_id: process.env.X_CLIENT_ID!, redirect_uri: redirectUri, code_verifier: codeVerifier || '' });
    const res = await fetch('https://api.x.com/2/oauth2/token', { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (!res.ok) throw new Error(`X token exchange failed (${res.status}).`);
    return await res.json() as any;
  }
  if (provider === 'youtube') {
    const body = new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: redirectUri, grant_type: 'authorization_code' });
    const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (!res.ok) throw new Error(`Google token exchange failed (${res.status}).`);
    return await res.json() as any;
  }
  if (provider === 'wordpress') {
    const body = new URLSearchParams({ client_id: process.env.WORDPRESS_CLIENT_ID!, client_secret: process.env.WORDPRESS_CLIENT_SECRET!, redirect_uri: redirectUri, code, grant_type: 'authorization_code' });
    const res = await fetch('https://public-api.wordpress.com/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    if (!res.ok) throw new Error(`WordPress token exchange failed (${res.status}).`);
    return await res.json() as any;
  }
  const body = new URLSearchParams({ client_id: process.env.META_APP_ID!, client_secret: process.env.META_APP_SECRET!, redirect_uri: redirectUri, code });
  const res = await fetch('https://graph.facebook.com/v24.0/oauth/access_token', { method: 'POST', body });
  if (!res.ok) throw new Error(`Meta token exchange failed (${res.status}).`);
  return await res.json() as any;
}

export async function connectProvider(provider: SocialProvider, code: string, redirectUri: string, projectId: string, userId: string, codeVerifier?: string) {
  const tokens = await exchangeCode(provider, code, redirectUri, codeVerifier);
  const admin = getSupabaseAdmin();
  if (!admin) throw new Error('Supabase service role is not configured.');
  const access = tokens.access_token || tokens.data?.access_token;
  if (!access) throw new Error(`No access token returned by ${provider}.`);
  const expires = Number(tokens.expires_in || 0);
  const base = { project_id: projectId, user_id: userId, provider, access_token: encryptSecret(access), refresh_token: encryptSecret(tokens.refresh_token), token_expires_at: expires ? new Date(Date.now() + expires * 1000).toISOString() : null, provider_metadata: { scopes: tokens.scope || tokens.data?.scope || null }, status: 'connected', connected_at: new Date().toISOString(), updated_at: new Date().toISOString() };

  if (provider === 'linkedin') {
    const meRes = await fetch('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${access}` } });
    if (!meRes.ok) throw new Error('LinkedIn account lookup failed.');
    const me = await meRes.json() as any;
    const { error } = await admin.from('social_accounts').upsert({ ...base, provider_account_id: me.sub, account_name: me.name || me.given_name || 'LinkedIn account', account_handle: me.email || null, account_avatar_url: me.picture || null, provider_metadata: { ...(base.provider_metadata as any), sub: me.sub } }, { onConflict: 'project_id,provider,provider_account_id' });
    if (error) throw new Error('Unable to save the authorized LinkedIn account.');
    return;
  }

  if (provider === 'x') {
    const meRes = await fetch('https://api.x.com/2/users/me?user.fields=profile_image_url,username,name', { headers: { Authorization: `Bearer ${access}` } });
    if (!meRes.ok) throw new Error('X account lookup failed.');
    const me = (await meRes.json() as any).data;
    const { error } = await admin.from('social_accounts').upsert({ ...base, provider_account_id: me.id, account_name: me.name || me.username, account_handle: me.username, account_avatar_url: me.profile_image_url || null, provider_metadata: { id: me.id, username: me.username, name: me.name } }, { onConflict: 'project_id,provider,provider_account_id' });
    if (error) throw new Error('Unable to save the authorized X account.');
    return;
  }

  if (provider === 'youtube') {
    const channelsRes = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${access}` } });
    if (!channelsRes.ok) throw new Error('YouTube channel lookup failed. Ensure the Google account has a YouTube channel and the app has YouTube API access.');
    const channels = (await channelsRes.json() as any).items || [];
    if (!channels.length) throw new Error('No YouTube channel was found for this Google account.');
    for (const channel of channels) {
      const snippet = channel.snippet || {};
      const { error } = await admin.from('social_accounts').upsert({ ...base, provider_account_id: channel.id, account_name: snippet.title || 'YouTube channel', account_handle: snippet.customUrl || null, account_avatar_url: snippet.thumbnails?.default?.url || null, provider_metadata: { ...(base.provider_metadata as any), channel_id: channel.id } }, { onConflict: 'project_id,provider,provider_account_id' });
      if (error) throw new Error('Unable to save the authorized YouTube channel.');
    }
    return;
  }

  if (provider === 'wordpress') {
    const meRes = await fetch('https://public-api.wordpress.com/rest/v1.1/me', { headers: { Authorization: `Bearer ${access}` } });
    if (!meRes.ok) throw new Error('WordPress account lookup failed.');
    const me = await meRes.json() as any;
    if (!me.ID) throw new Error('WordPress did not return a verified account identity.');
    const sitesRes = await fetch('https://public-api.wordpress.com/rest/v1.1/me/sites', { headers: { Authorization: `Bearer ${access}` } });
    const sites = sitesRes.ok ? ((await sitesRes.json() as any).sites || []) : [];
    const site = sites.find((x: any) => x?.capabilities?.publish_posts || x?.capabilities?.edit_posts) || sites[0];
    const accountId = site?.ID ? String(site.ID) : String(me.ID);
    const { error } = await admin.from('social_accounts').upsert({ ...base, provider_account_id: accountId, account_name: site?.name || me.display_name || me.username || 'WordPress account', account_handle: site?.URL || (me.username ? `@${me.username}` : null), account_avatar_url: me.avatar_URL || null, provider_metadata: { ...(base.provider_metadata as any), wordpress_user_id: me.ID, site_id: site?.ID || null, site_url: site?.URL || null, username: me.username || null } }, { onConflict: 'project_id,provider,provider_account_id' });
    if (error) throw new Error('Unable to save the authorized WordPress account.');
    return;
  }

  const pagesRes = await fetch(`https://graph.facebook.com/v24.0/me/accounts?fields=id,name,access_token,picture&access_token=${encodeURIComponent(access)}`);
  if (!pagesRes.ok) throw new Error('Meta Page lookup failed.');
  const pages = (await pagesRes.json() as any).data || [];
  let savedRequestedProvider = false;
  for (const page of pages) {
    const { error: pageError } = await admin.from('social_accounts').upsert({ ...base, provider: 'facebook', provider_account_id: page.id, account_name: page.name, account_handle: null, account_avatar_url: page.picture?.data?.url || null, access_token: encryptSecret(page.access_token), provider_metadata: { ...(base.provider_metadata as any), page_id: page.id, page_access_token: true } }, { onConflict: 'project_id,provider,provider_account_id' });
    if (pageError) throw new Error('Unable to save the authorized Facebook Page.');
    if (provider === 'facebook') savedRequestedProvider = true;
    const igRes = await fetch(`https://graph.facebook.com/v24.0/${page.id}?fields=instagram_business_account&access_token=${encodeURIComponent(page.access_token)}`);
    if (igRes.ok) {
      const ig = (await igRes.json() as any).instagram_business_account;
      if (ig?.id) {
        const profileRes = await fetch(`https://graph.facebook.com/v24.0/${ig.id}?fields=username,name,profile_picture_url&access_token=${encodeURIComponent(page.access_token)}`);
        const profile = profileRes.ok ? (await profileRes.json() as any) : {};
        const { error: igError } = await admin.from('social_accounts').upsert({ ...base, provider: 'instagram', provider_account_id: ig.id, account_name: profile.username || profile.name || 'Instagram account', account_handle: profile.username || null, account_avatar_url: profile.profile_picture_url || null, access_token: encryptSecret(page.access_token), provider_metadata: { ...(base.provider_metadata as any), instagram_business_account_id: ig.id, page_id: page.id } }, { onConflict: 'project_id,provider,provider_account_id' });
        if (igError) throw new Error('Unable to save the authorized Instagram account.');
        if (provider === 'instagram') savedRequestedProvider = true;
      }
    }
  }
  if (!savedRequestedProvider) throw new Error(provider === 'instagram' ? 'No eligible Instagram professional account linked to a Facebook Page was found.' : 'No Facebook Pages were returned for this account. Grant Page access and try again.');
}

export type SocialAccount = { id: string; provider: SocialProvider; account_id: string; account_name: string; username: string | null; avatar_url: string | null; status: string; token_expires_at: string | null };

export async function listSocialAccounts(projectId: string, userId: string) {
  const admin = getSupabaseAdmin(); if (!admin) return [];
  const { data, error } = await admin.from('social_accounts').select('id,provider,provider_account_id,account_name,account_handle,account_avatar_url,status,token_expires_at').eq('project_id', projectId).eq('user_id', userId).order('created_at', { ascending: true });
  const mapped = (data || []).map((a: any) => {
    const expired = a.status === 'connected' && a.token_expires_at && new Date(a.token_expires_at).getTime() <= Date.now();
    return { ...a, status: expired ? 'expired' : a.status, account_id: a.provider_account_id, username: a.account_handle, avatar_url: a.account_avatar_url };
  });
  if (error) throw error; return mapped as SocialAccount[];
}

async function postLinkedIn(account: any, post: any) {
  const token = decryptSecret(account.access_token)!;
  const author = account.provider_metadata?.author_urn || `urn:li:person:${account.account_id}`;
  const body: any = { author, commentary: post.caption_text, visibility: 'PUBLIC', distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] }, lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false };
  const res = await fetch('https://api.linkedin.com/rest/posts', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0', 'Linkedin-Version': process.env.LINKEDIN_VERSION || '202601' }, body: JSON.stringify(body) });
  const text = await res.text(); if (!res.ok) throw new Error(`LinkedIn publish failed (${res.status}): ${text.slice(0,500)}`);
  return { id: res.headers.get('x-restli-id') || JSON.parse(text || '{}').id || null };
}

async function postX(account: any, post: any) {
  const token = decryptSecret(account.access_token)!;
  const res = await fetch('https://api.x.com/2/tweets', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: post.caption_text }) });
  const body = await res.json().catch(() => ({})); if (!res.ok) throw new Error(`X publish failed (${res.status}): ${JSON.stringify(body).slice(0,500)}`);
  return { id: body.data?.id || null };
}

async function postFacebook(account: any, post: any) {
  const token = decryptSecret(account.access_token)!;
  const pageId = account.account_id;
  const params = new URLSearchParams({ message: post.caption_text, access_token: token });
  if (post.media_url && post.media_type === 'image') params.set('url', post.media_url);
  const endpoint = post.media_url && post.media_type === 'image' ? `https://graph.facebook.com/v24.0/${pageId}/photos` : `https://graph.facebook.com/v24.0/${pageId}/feed`;
  const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
  const body = await res.json().catch(() => ({})); if (!res.ok) throw new Error(`Facebook publish failed (${res.status}): ${JSON.stringify(body).slice(0,500)}`);
  return { id: body.id || body.post_id || null };
}

async function postInstagram(account: any, post: any) {
  if (!post.media_url || post.media_type !== 'image') throw new Error('Instagram publishing currently requires an image URL.');
  const token = decryptSecret(account.access_token)!;
  const id = account.account_id;
  const create = new URLSearchParams({ image_url: post.media_url, caption: post.caption_text, access_token: token });
  const c = await fetch(`https://graph.facebook.com/v24.0/${id}/media`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: create });
  const cb = await c.json().catch(() => ({})); if (!c.ok) throw new Error(`Instagram media creation failed (${c.status}): ${JSON.stringify(cb).slice(0,500)}`);
  const p = await fetch(`https://graph.facebook.com/v24.0/${id}/media_publish`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ creation_id: cb.id, access_token: token }) });
  const pb = await p.json().catch(() => ({})); if (!p.ok) throw new Error(`Instagram publish failed (${p.status}): ${JSON.stringify(pb).slice(0,500)}`);
  return { id: pb.id || null };
}

export async function publishToProvider(account: any, post: any) {
  if (account.provider === 'linkedin') return postLinkedIn(account, post);
  if (account.provider === 'facebook') return postFacebook(account, post);
  if (account.provider === 'instagram') return postInstagram(account, post);
  if (account.provider === 'x') return postX(account, post);
  throw new Error(`Unsupported provider: ${account.provider}`);
}
