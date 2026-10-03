'use client';
import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { AppState, Piece } from './types';
import { SEC_META, GIVE_UP_MS } from './constants';
import { fetchBrandAppearance, brandThemeComplete, mergeTheme } from './brand-client';
import { getSupabaseClient, getJob, getLatestJob, getProject, type JobRow, type ProjectRow } from './supabase';
import { persistJobState } from './job-persistence';

export const DEFAULT_PREFS: AppState['prefs'] = {
  platforms: ['Instagram', 'LinkedIn'],
  goal: 'Brand / Product Awareness',
  tone: 'Professional',
  style: 'Seth Godin',
  extra: '',
};

const DEFAULTS: AppState = {
  projectId: null, jobRowId: null, url: '', profile: null, prefs: DEFAULT_PREFS,
  jobId: null, liveViewToken: null, jobStarted: 0, finishedAt: null, generationRequestId: null,
  brandTheme: null, generationStatus: 'idle', sections: {}, schedule: {},
};

interface Ctx {
  s: AppState;
  set: (p: Partial<AppState>) => void;
  reset: () => void;
  loadProject: (projectId: string) => Promise<'brand' | 'studio' | false>;
  loadProjectJob: (projectId: string, jobId: string) => Promise<'brand' | 'studio' | false>;
  pieces: () => Piece[];
  piece: (id: string) => Piece | undefined;
  ready: boolean;
}
const Store = createContext<Ctx | null>(null);

async function hydrateBrandTheme(project: ProjectRow): Promise<Record<string, unknown> | null> {
  const current = (project.brand_theme || {}) as Record<string, unknown>;
  // Saved theme is complete: use it, no network call. Old projects missing a logo/colours are
  // refreshed once from the website (shared de-duplicated request, so no 429 storms).
  if (brandThemeComplete(current)) return current;
  const fetched = await fetchBrandAppearance(project.url, true);
  if (!fetched) return Object.keys(current).length ? current : null;
  const theme = mergeTheme(current, fetched);
  const supabase = getSupabaseClient();
  if (supabase) void supabase.from('projects').update({ brand_theme: theme }).eq('id', project.id);
  return theme;
}

function mergeProject(base: AppState, project: ProjectRow, job?: JobRow | null): AppState {
  const profile = project.profile as AppState['profile'];
  const prefs = (project.prefs || {}) as Partial<AppState['prefs']>;
  const brandTheme = project.brand_theme as AppState['brandTheme'];
  const staleActiveJob = Boolean(job && ['starting','running'].includes(job.status) && Date.now() - new Date(job.started_at).getTime() > GIVE_UP_MS);
  const effectiveJob = staleActiveJob ? { ...job!, status: 'idle', job_id: null, live_view_token: null, request_id: null, finished_at: job!.finished_at } as JobRow : job;
  return {
    ...base,
    projectId: project.id,
    url: project.url,
    profile: profile || null,
    prefs: { ...DEFAULT_PREFS, ...prefs },
    brandTheme: brandTheme || null,
    jobRowId: effectiveJob?.id || null,
    jobId: effectiveJob?.job_id || null,
    liveViewToken: effectiveJob?.live_view_token || null,
    generationRequestId: effectiveJob?.request_id || null,
    jobStarted: effectiveJob ? new Date(effectiveJob.started_at).getTime() : 0,
    finishedAt: effectiveJob?.finished_at || null,
    generationStatus: effectiveJob?.status === 'completed' ? 'completed' : effectiveJob?.status === 'cancelled' ? 'cancelled' : effectiveJob?.status === 'failed' ? 'failed' : effectiveJob?.status === 'partial' ? 'partial' : effectiveJob?.status === 'starting' ? 'starting' : effectiveJob?.job_id ? 'running' : 'idle',
    sections: (effectiveJob?.sections as AppState['sections']) || {},
    schedule: (effectiveJob?.schedule as AppState['schedule']) || {},
  };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [s, _set] = useState<AppState>(DEFAULTS);
  const [ready, setReady] = useState(false);

  const set = useCallback((patch: Partial<AppState>) => _set(prev => ({ ...prev, ...patch })), []);
  const reset = useCallback(() => _set(DEFAULTS), []);

  const loadProjectJob = useCallback(async (projectId: string, jobId: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) return false;
    try {
      const project = await getProject(projectId);
      if (!project) return false;
      const theme = await hydrateBrandTheme(project);
      if (theme) project.brand_theme = theme;
      const job = await getJob(jobId);
      if (!job || job.project_id !== projectId) return false;
      _set(prev => {
        const merged = mergeProject(prev, project, job);
        const localIsSameGeneration = prev.projectId === projectId && Boolean(prev.jobId) && prev.jobId === job.job_id;
        const localHasContent = Object.keys(prev.sections || {}).length > 0;
        const dbHasContent = Object.keys(merged.sections || {}).length > 0;
        if (localIsSameGeneration && localHasContent && !dbHasContent) {
          return { ...merged, sections: prev.sections, schedule: prev.schedule, generationStatus: prev.generationStatus, finishedAt: prev.finishedAt };
        }
        return merged;
      });
      return job.job_id ? 'studio' : 'brand';
    } catch { return false; }
  }, []);

  const loadProject = useCallback(async (projectId: string) => {
    const supabase = getSupabaseClient();
    if (!supabase) return false;
    try {
      const project = await getProject(projectId);
      if (!project) return false;
      const [theme, job] = await Promise.all([hydrateBrandTheme(project), getLatestJob(project.id)]);
      if (theme) project.brand_theme = theme;
      _set(prev => mergeProject(prev, project, job));
      const stale = Boolean(job && ['starting','running'].includes(job.status) && Date.now() - new Date(job.started_at).getTime() > GIVE_UP_MS);
      return job?.job_id && !stale ? 'studio' : theme || project.brand_theme ? 'studio' : 'brand';
    } catch { return false; }
  }, []);

  // The URL is the durable workspace identity. On a refresh, reconstruct the active
  // company (and optionally a specific generation) from Supabase before pages render.
  useEffect(() => {
    let cancelled = false;
    const hydrate = async () => {
      if (typeof window === 'undefined') return;
      const params = new URLSearchParams(window.location.search);
      const projectId = params.get('project');
      const jobId = params.get('job');
      if (!projectId) { if (!cancelled) setReady(true); return; }
      const destination = jobId
        ? await loadProjectJob(projectId, jobId)
        : await loadProject(projectId);
      if (cancelled) return;
      if (!destination) {
        _set(DEFAULTS);
      }
      setReady(true);
    };
    void hydrate();
    return () => { cancelled = true; };
  }, [loadProject, loadProjectJob]);

  useEffect(() => {
    if (!ready || !s.projectId) return;
    const supabase = getSupabaseClient(); if (!supabase) return;
    const timer = setTimeout(() => {
      void supabase.from('projects').update({ url: s.url, profile: s.profile, prefs: s.prefs, brand_theme: s.brandTheme }).eq('id', s.projectId!);
    }, 350);
    return () => clearTimeout(timer);
  }, [ready, s.projectId, s.url, s.profile, s.prefs, s.brandTheme]);

  useEffect(() => {
    if (!ready || !s.jobRowId) return;
    const supabase = getSupabaseClient(); if (!supabase) return;
    const timer = setTimeout(() => {
      const terminal = ['completed', 'failed', 'cancelled'].includes(s.generationStatus);
      const status = s.generationStatus === 'cancelled' ? 'cancelled' : s.generationStatus === 'failed' ? 'failed' : Object.keys(s.sections).length === SEC_META.length ? 'completed' : Object.keys(s.sections).length > 0 ? 'partial' : s.generationStatus === 'starting' ? 'starting' : 'running';
      const finishedAt = terminal ? (s.finishedAt || new Date().toISOString()) : null;
      if (terminal && !s.finishedAt) _set(prev => prev.finishedAt ? prev : { ...prev, finishedAt });
      void persistJobState(s.projectId!, s.jobRowId!, { sections: s.sections, schedule: s.schedule, job_id: s.jobId, status, finished_at: finishedAt });
    }, 300);
    return () => clearTimeout(timer);
  }, [ready, s.jobRowId, s.jobId, s.sections, s.schedule, s.generationStatus]);

  const pieces = useCallback((): Piece[] => {
    const out: Piece[] = [];
    SEC_META.forEach(sec => (s.sections[sec.key] || []).forEach(p => out.push(p)));
    return out;
  }, [s.sections]);
  const piece = useCallback((id: string) => pieces().find(p => p.id === id), [pieces]);

  return <Store.Provider value={{ s, set, reset, loadProject, loadProjectJob, pieces, piece, ready }}>{children}</Store.Provider>;
}
export function useStore() { const ctx = useContext(Store); if (!ctx) throw new Error('useStore must be inside StoreProvider'); return ctx; }
