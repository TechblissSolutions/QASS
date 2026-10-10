export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromToken } from '@/lib/supabase';
import { listSocialAccounts, providerConfigured, providerMeta, type SocialProvider } from '@/lib/scheduling';

const providers: SocialProvider[] = ['instagram','facebook','linkedin','x','youtube','wordpress'];

export async function GET(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i,'').trim();
  if (!token) return NextResponse.json({ error:'Authentication required.' }, { status:401 });
  const user = await getUserFromToken(token).catch(()=>null);
  if (!user) return NextResponse.json({ error:'Authentication required.' }, { status:401 });
  const projectId = new URL(req.url).searchParams.get('project');
  if (!projectId) return NextResponse.json({ error:'project is required.' }, { status:400 });
  const accounts = await listSocialAccounts(projectId, user.id);
  return NextResponse.json({ accounts, providers: providers.map(id=>({ id, ...providerMeta[id], configured: providerConfigured(id) })) }, { headers:{'Cache-Control':'private, no-store'} });
}


export async function DELETE(req: NextRequest) {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i,'').trim();
  if (!token) return NextResponse.json({ error:'Authentication required.' }, { status:401 });
  const user = await getUserFromToken(token).catch(()=>null);
  if (!user) return NextResponse.json({ error:'Authentication required.' }, { status:401 });
  const url = new URL(req.url);
  const projectId = url.searchParams.get('project');
  const accountId = url.searchParams.get('account');
  if (!projectId || !accountId) return NextResponse.json({ error:'project and account are required.' }, { status:400 });
  const admin = (await import('@/lib/supabase-admin')).getSupabaseAdmin();
  if (!admin) return NextResponse.json({ error:'Supabase service role is not configured.' }, { status:500 });
  const { error } = await admin.from('social_accounts').delete().eq('id',accountId).eq('project_id',projectId).eq('user_id',user.id);
  if (error) return NextResponse.json({ error:error.message }, { status:500 });
  return NextResponse.json({ success:true });
}
