'use client';

import { use, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { getAccessToken } from '@/lib/auth';
import { getProject, listJobs, type JobRow, type ProjectRow } from '@/lib/supabase';
import { companyNameFromUrl } from '@/lib/utils';
import CompanyHeader from '@/components/CompanyHeader';
import BrandTheme from '@/components/BrandTheme';
import { useStore } from '@/lib/store';

export default function ProjectHistory({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { s, loadProject, pieces: currentPieces } = useStore();
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    void (async () => {
      const token = await getAccessToken();
      if (!token) { router.replace('/login'); return; }
      try {
        const [p, j] = await Promise.all([getProject(id, token), listJobs(id, token, 50)]);
        if (!alive) return;
        if (!p) { setError('Company not found.'); return; }
        setProject(p); setJobs(j);
        if (s.projectId !== id) await loadProject(id);
      } catch { if (alive) setError('Unable to load history. Please try again.'); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [id, router, loadProject, s.projectId]);

  const name = String((project?.profile as any)?.company_name || companyNameFromUrl(project?.url || ''));
  const historyPosts = useMemo(() => {
    const normalisePlatform = (value: string) => value.toLowerCase().replace(/x\/twitter/g, 'twitter').replace(/x\//g, '').replace(/\s+/g, ' ').trim();
    const matchesSelectedPlatform = (piece: any, selected: string[]) => {
      const channel = String(piece?.channel || '').toLowerCase().replace(/\s+/g, ' ').trim();
      const title = String(piece?.title || '').toLowerCase();
      return selected.some(raw => {
        const platform = normalisePlatform(String(raw));
        if (!platform) return false;
        if (channel === platform || channel.includes(platform)) return true;
        if (platform === 'twitter' && (channel.includes('twitter') || channel === 'x')) return true;
        if (platform === 'linkedin' && title.includes('linkedin')) return true;
        return false;
      });
    };
    const dbPosts = jobs.flatMap(job => {
      const sections = job.sections || {};
      const meta = Array.isArray((job.schedule as any)?.__selectedPlatforms) ? (job.schedule as any).__selectedPlatforms as string[] : null;
      // For the generation currently loaded in the workspace, older rows may not
      // have the per-job platform metadata. Fall back to the project's current
      // selected platforms so the just-generated History view remains accurate.
      const selected = meta || (job.id === s.jobRowId ? (s.prefs.platforms || []) : null);
      return Object.values(sections).flatMap(value => Array.isArray(value) ? value.map((piece: any) => ({ piece, job })).filter(({ piece }) => !selected || matchesSelectedPlatform(piece, selected)) : []);
    });
    // Keep the just-finished generation visible immediately after navigation even
    // if the Supabase write is still in flight. The polling layer also writes the
    // completed sections directly, so a refresh will recover the same content.
    if (dbPosts.length || s.projectId !== id || !currentPieces().length) return dbPosts;
    const fallbackJob: JobRow = {
      id: s.jobRowId || `local-${s.jobId || 'generation'}`, project_id: id,
      job_id: s.jobId, status: s.generationStatus, started_at: s.jobStarted ? new Date(s.jobStarted).toISOString() : new Date().toISOString(),
      finished_at: s.finishedAt, request_id: s.generationRequestId, last_error: null,
      live_view_token: s.liveViewToken, sections: s.sections, schedule: s.schedule,
    };
    return currentPieces().map(piece => ({ piece, job: fallbackJob }));
  }, [jobs, s.projectId, s.jobId, s.jobRowId, s.generationStatus, s.jobStarted, s.finishedAt, s.generationRequestId, s.liveViewToken, s.sections, s.schedule, s.prefs.platforms, currentPieces, id]);

  if (loading) return <div className="company-history-loading"><div className="dashboard-v6-spinner" /><strong>Loading history</strong></div>;
  if (!project) return <div className="center-page"><div className="work-card"><h2>{error || 'Company not found.'}</h2><a className="btn btn-primary" href="/dashboard">Back to companies</a></div></div>;

  return <div className="company-workspace">
    <CompanyHeader /><BrandTheme />
    <main className="company-history-page">
      <div className="company-history-head"><div><span>HISTORY</span><h1>Previous content</h1><p>{name} · Generated work stays with this company.</p></div><Link className="btn btn-primary" href={`/studio?project=${encodeURIComponent(id)}`}>Open Studio <span>↗</span></Link></div>
      {error && <div className="banner" role="alert">{error}</div>}
      {historyPosts.length === 0 ? <div className="company-history-empty"><strong>No generated posts yet.</strong><p>Open Studio, choose your channels and generate your first content package.</p><Link className="btn btn-primary" href={`/studio?project=${encodeURIComponent(id)}`}>Go to Studio</Link></div> : <div className="company-history-list">
        {historyPosts.map(({ piece, job }, index) => {
          const scheduled = job.schedule && (job.schedule as any)[piece.id];
          return <article className="company-history-card" key={`${job.id}-${piece.id}-${index}`}>
            <div className="company-history-card-top"><div><span className="company-history-channel">{piece.channel}</span><h2>{piece.title}</h2></div><span className="company-history-date">Generated {new Date(job.started_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}</span></div>
            <p>{piece.bodyText?.slice(0, 260)}{piece.bodyText?.length > 260 ? '…' : ''}</p>
            <footer><span>{piece.format || piece.section}</span><span>{scheduled ? `Scheduled ${new Date(`${scheduled.date}T00:00`).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}` : 'Not scheduled'}</span>{scheduled ? <Link href={`/calendar?project=${encodeURIComponent(id)}&job=${encodeURIComponent(job.id)}`}>Open calendar ↗</Link> : <Link href={`/calendar?project=${encodeURIComponent(id)}&job=${encodeURIComponent(job.id)}`}>Schedule ↗</Link>}</footer>
          </article>;
        })}
      </div>}
    </main>
  </div>;
}
