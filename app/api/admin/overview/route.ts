import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-admin';
import { requireAdmin } from '@/lib/admin-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req);
  if ('response' in auth) return auth.response;
  try {
    const admin = getSupabaseAdmin();
    const usersList: any[] = [];
    let page = 1;
    while (true) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      usersList.push(...data.users);
      if (data.users.length < 1000) break;
      page += 1;
    }
    const [{ data: projects, error: projectsError }, { data: jobs, error: jobsError }, { data: profiles }] = await Promise.all([
      admin.from('projects').select('id,user_id,url,created_at').order('created_at', { ascending: false }).limit(5000),
      admin.from('jobs').select('id,project_id,status,started_at').order('started_at', { ascending: false }).limit(5000),
      admin.from('profiles').select('id,email,full_name,plan,role,created_at').limit(5000),
    ]);
    if (projectsError || jobsError) throw new Error('Unable to load admin data. Check service-role configuration and database schema.');
    const users = usersList.map((u) => {
      const profile = profiles?.find((p: any) => p.id === u.id);
      const userProjects = (projects || []).filter((p: any) => p.user_id === u.id);
      return { id: u.id, email: u.email || profile?.email || '', fullName: profile?.full_name || u.user_metadata?.full_name || '', createdAt: u.created_at, lastSignInAt: u.last_sign_in_at || null, plan: profile?.plan || 'free', role: profile?.role || 'user', projectCount: userProjects.length, projects: userProjects.map((p: any) => ({ id: p.id, url: p.url, createdAt: p.created_at, jobs: (jobs || []).filter((j: any) => j.project_id === p.id).length })) };
    });
    const recentJobs = (jobs || []).slice(0, 12).map((job: any) => ({ ...job, projectUrl: projects?.find((p: any) => p.id === job.project_id)?.url || 'Unknown project' }));
    return NextResponse.json({ summary: { users: usersList.length, projects: projects?.length || 0, jobs: jobs?.length || 0, activeUsers30d: usersList.filter((u) => u.last_sign_in_at && Date.now() - new Date(u.last_sign_in_at).getTime() < 30 * 86400000).length }, users, recentJobs }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to load admin dashboard.' }, { status: 503 });
  }
}
