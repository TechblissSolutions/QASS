import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { ProjectRow } from './supabase';

let adminClient: ReturnType<typeof createClient> | null = null;

function getAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase server configuration is incomplete.');
  if (!adminClient) adminClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return adminClient;
}

export async function createProjectWithLimit(url: string, profile: unknown, prefs: unknown, brandTheme: unknown, userId: string, maxCompanies: number | null) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (getAdmin().rpc as any)('create_project_for_user', {
    p_user_id: userId, p_url: url, p_profile: profile, p_prefs: prefs, p_brand_theme: brandTheme,
    p_max_companies: maxCompanies, p_unlimited: maxCompanies === null,
  });
  if (error) throw error;
  return (data as ProjectRow[] | null)?.[0] || null;
}


export async function pingSupabase() {
  const { error } = await getAdmin().from('profiles').select('id', { head: true, count: 'exact' });
  if (error) throw error;
  return true;
}
