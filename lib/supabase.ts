import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { normaliseUrl } from './utils';

let browserClient: SupabaseClient | null = null;
let browserStorageMode: 'local' | 'session' | null = null;

const PERSISTENCE_KEY = 'sparrow_auth_persistence';

function browserStorage(): Storage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const sessionPreference = window.sessionStorage.getItem(PERSISTENCE_KEY);
    const localPreference = window.localStorage.getItem(PERSISTENCE_KEY);
    if (sessionPreference === 'session') return window.sessionStorage;
    if (localPreference === 'local') return window.localStorage;
  } catch { /* fall back to Supabase's normal browser storage */ }
  return window.localStorage;
}

/** Configure the login persistence chosen by the user before the browser client is created. */
export function setAuthPersistence(rememberMe: boolean) {
  if (typeof window === 'undefined') return;
  try {
    const clearSupabaseKeys = (storage: Storage) => {
      for (let i = storage.length - 1; i >= 0; i -= 1) {
        const key = storage.key(i);
        if (key?.startsWith('sb-') && key.endsWith('-auth-token')) storage.removeItem(key);
      }
    };
    if (rememberMe) {
      clearSupabaseKeys(window.sessionStorage);
      window.sessionStorage.removeItem(PERSISTENCE_KEY);
      window.localStorage.setItem(PERSISTENCE_KEY, 'local');
    } else {
      clearSupabaseKeys(window.localStorage);
      window.localStorage.removeItem(PERSISTENCE_KEY);
      window.sessionStorage.setItem(PERSISTENCE_KEY, 'session');
    }
  } catch { /* storage may be unavailable; Supabase will still attempt its default */ }
  browserClient = null;
  browserStorageMode = null;
}

export function clearAuthPersistence() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(PERSISTENCE_KEY);
    window.sessionStorage.removeItem(PERSISTENCE_KEY);
  } catch { /* ignore */ }
  browserClient = null;
  browserStorageMode = null;
}

export function getSupabaseClient(accessToken?: string): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;

  // Browser client owns the persisted login session. The storage is selected by
  // the user's "Remember me" choice: localStorage survives browser restarts;
  // sessionStorage survives refresh/navigation in the current tab only.
  if (typeof window !== 'undefined' && !accessToken) {
    const storage = browserStorage();
    const mode: 'local' | 'session' = storage === window.sessionStorage ? 'session' : 'local';
    if (!browserClient || browserStorageMode !== mode) {
      browserClient = createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storage,
        },
      });
      browserStorageMode = mode;
    }
    return browserClient;
  }

  // Server/API requests use the user's bearer token so Supabase RLS applies.
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : undefined,
  });
}

export type ProjectRow = {
  id: string; created_at: string; url: string; user_id?: string | null;
  profile: Record<string, unknown> | null; prefs: Record<string, unknown> | null; brand_theme: Record<string, unknown> | null;
};

export type JobRow = {
  id: string; project_id: string; job_id: string | null; status: string; started_at: string; finished_at: string | null;
  request_id: string | null; last_error: string | null; live_view_token: string | null; sections: Record<string, unknown>; schedule: Record<string, unknown>;
};

const projectSelect = 'id,created_at,url,user_id,profile,prefs,brand_theme';
const jobSelect = 'id,project_id,job_id,status,started_at,finished_at,request_id,last_error,live_view_token,sections,schedule';

function normalizedProjectUrl(url: string): string {
  return normaliseUrl(url)
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
}

export async function createProject(url: string, profile: unknown, prefs: unknown, brandTheme: unknown, accessToken?: string) {
  const supabase = getSupabaseClient(accessToken); if (!supabase) return null;
  const { data, error } = await supabase.from('projects').insert({ url, profile, prefs, brand_theme: brandTheme }).select(projectSelect).single();
  if (error) throw error; return data as ProjectRow;
}

export async function updateProject(id: string, patch: Record<string, unknown>, accessToken?: string) {
  const supabase = getSupabaseClient(accessToken); if (!supabase) return null;
  const { data, error } = await supabase.from('projects').update(patch).eq('id', id).select(projectSelect).single();
  if (error) throw error; return data as ProjectRow;
}

export async function getProject(id: string, accessToken?: string) {
  const supabase = getSupabaseClient(accessToken); if (!supabase) return null;
  const { data, error } = await supabase.from('projects').select(projectSelect).eq('id', id).maybeSingle();
  if (error) throw error; return (data as ProjectRow | null);
}

export async function listProjects(limit = 50, accessToken?: string) {
  const supabase = getSupabaseClient(accessToken); if (!supabase) return [];
  const { data, error } = await supabase.from('projects').select(projectSelect).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error; return (data || []) as ProjectRow[];
}

export async function deleteProject(id: string, accessToken?: string) {
  const supabase = getSupabaseClient(accessToken); if (!supabase) throw new Error('Supabase is not configured.');
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error;
}

export async function countProjects(accessToken?: string) {
  const supabase = getSupabaseClient(accessToken); if (!supabase) return 0;
  const { count, error } = await supabase.from('projects').select('id', { count: 'exact', head: true });
  if (error) throw error; return count || 0;
}

export async function projectExistsByUrl(url: string, accessToken?: string) {
  const supabase = getSupabaseClient(accessToken); if (!supabase) return false;
  const { data, error } = await supabase.from('projects').select('id').eq('url', url).limit(1).maybeSingle();
  if (error) throw error; return Boolean(data?.id);
}

export async function getProjectByUrl(url: string, accessToken?: string) {
  const supabase = getSupabaseClient(accessToken); if (!supabase) return null;
  const target = normalizedProjectUrl(url);
  const { data, error } = await supabase
    .from('projects')
    .select(projectSelect)
    .eq('normalized_url', target)
    .maybeSingle();
  if (error) throw error;
  return (data as ProjectRow | null) || null;
}

export async function createJob(projectId: string, startedAt = new Date().toISOString(), accessToken?: string) {
  const supabase = getSupabaseClient(accessToken); if (!supabase) return null;
  const { data, error } = await supabase.from('jobs').insert({ project_id: projectId, status: 'starting', started_at: startedAt, sections: {}, schedule: {} }).select(jobSelect).single();
  if (error) throw error; return data as JobRow;
}

export async function updateJob(id: string, patch: Record<string, unknown>, accessToken?: string) {
  const supabase = getSupabaseClient(accessToken); if (!supabase) return null;
  const { data, error } = await supabase.from('jobs').update(patch).eq('id', id).select(jobSelect).single();
  if (error) throw error; return data as JobRow;
}

export async function getJobByExternalId(jobId: string, accessToken?: string) {
  const supabase = getSupabaseClient(accessToken); if (!supabase) return null;
  const { data, error } = await supabase.from('jobs').select(jobSelect).eq('job_id', jobId).order('started_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error; return data as JobRow | null;
}

export async function listJobs(projectId: string, accessToken?: string, limit = 50) {
  const supabase = getSupabaseClient(accessToken); if (!supabase) return [];
  const { data, error } = await supabase.from('jobs').select(jobSelect).eq('project_id', projectId).order('started_at', { ascending: false }).limit(limit);
  if (error) throw error; return (data || []) as JobRow[];
}

export async function getJob(id: string, accessToken?: string) {
  const supabase = getSupabaseClient(accessToken); if (!supabase) return null;
  const { data, error } = await supabase.from('jobs').select(jobSelect).eq('id', id).maybeSingle();
  if (error) throw error; return data as JobRow | null;
}

export async function getLatestJob(projectId: string, accessToken?: string) {
  const supabase = getSupabaseClient(accessToken); if (!supabase) return null;
  const { data, error } = await supabase.from('jobs').select(jobSelect).eq('project_id', projectId).order('started_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error; return data as JobRow | null;
}

export async function getUserFromToken(accessToken: string) {
  const supabase = getSupabaseClient(accessToken); if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error) throw error; return data.user || null;
}
