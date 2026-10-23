'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { getSupabaseClient } from '@/lib/supabase';

type Project = { id: string; url: string; createdAt: string; jobs: number };
type User = { id: string; email: string; fullName: string; createdAt: string; lastSignInAt: string | null; plan: string; role: string; projectCount: number; projects: Project[] };
type Feature = { key: string; label: string; description: string; enabled: boolean; updated_at: string };
type Payload = { summary: { users: number; projects: number; jobs: number; activeUsers30d: number }; users: User[]; recentJobs: { id: string; status: string; started_at: string; projectUrl: string }[] };
type ProjectPolicy = { override: 'platform' | 'personal' | null; effectiveMode: string; n8nCredentials?: { service: string; status: string; name: string | null; credentialId: string | null; credentialType: string | null; message: string | null }[] };

const fmtDate = (value?: string | null) => value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'Never';
const initials = (value: string) => value.split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(s => s[0]?.toUpperCase()).join('') || 'U';

export default function AdminPage() {
  const [token, setToken] = useState('');
  const [payload, setPayload] = useState<Payload | null>(null);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'overview' | 'users' | 'features'>('overview');
  const [selected, setSelected] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [userControls, setUserControls] = useState<{ plan: string; features: Record<string, boolean | null> } | null>(null);
  const [userControlBusy, setUserControlBusy] = useState(false);
  const [projectPolicies, setProjectPolicies] = useState<Record<string, ProjectPolicy>>({});
  const [savingProjectPolicy, setSavingProjectPolicy] = useState('');

  const request = useCallback(async (path: string, init?: RequestInit) => {
    const response = await fetch(path, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
      cache: 'no-store'
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Request failed.');
    return body;
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError('');
    const [overviewResult, featuresResult] = await Promise.allSettled([
      request('/api/admin/overview'),
      request('/api/admin/features')
    ]);
    const errors: string[] = [];

    if (overviewResult.status === 'fulfilled') setPayload(overviewResult.value);
    else errors.push(overviewResult.reason instanceof Error ? overviewResult.reason.message : 'Unable to load platform overview.');

    if (featuresResult.status === 'fulfilled') setFeatures(featuresResult.value.features || []);
    else errors.push(featuresResult.reason instanceof Error ? featuresResult.reason.message : 'Unable to load feature controls.');

    if (errors.length) setError(errors.join(' '));
    setLoading(false);
  }, [request, token]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const supabase = getSupabaseClient();
        if (!supabase) {
          if (alive) { setError('Supabase is not configured.'); setLoading(false); }
          return;
        }
        const { data } = await supabase.auth.getSession();
        if (!alive) return;
        if (!data.session?.access_token) {
          setError('Sign in with your administrator account to continue.');
          setLoading(false);
          return;
        }
        setToken(data.session.access_token);
      } catch (e) {
        if (alive) {
          setError(e instanceof Error ? e.message : 'Unable to check your session.');
          setLoading(false);
        }
      }
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => { if (token) void load(); }, [token, load]);

  useEffect(() => {
    if (!token || !selected) { setUserControls(null); return; }
    let alive = true;
    request(`/api/admin/users/${selected.id}`)
      .then(data => { if (alive) setUserControls(data); })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : 'Unable to load user controls.'); });
    return () => { alive = false; };
  }, [token, selected?.id, request]);

  async function changeUserPlan(plan: 'free' | 'premium') {
    if (!selected) return;
    setUserControlBusy(true);
    setError('');
    setNotice('');
    try {
      await request(`/api/admin/users/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'plan', plan })
      });
      setUserControls(current => current ? { ...current, plan } : { plan, features: {} });
      setSelected(current => current ? { ...current, plan } : current);
      setPayload(current => current ? {
        ...current,
        users: current.users.map(u => u.id === selected.id ? { ...u, plan } : u)
      } : current);
      setNotice(`User plan changed to ${plan}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update user plan.');
    } finally {
      setUserControlBusy(false);
    }
  }

  async function changeUserFeature(key: string, enabled: boolean) {
    if (!selected) return;
    setUserControlBusy(true);
    setError('');
    setNotice('');
    try {
      await request(`/api/admin/users/${selected.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ action: 'feature', key, enabled })
      });
      setUserControls(current => current ? {
        ...current,
        features: { ...current.features, [key]: enabled }
      } : current);
      setNotice(`${key.replaceAll('_', ' ')} ${enabled ? 'enabled' : 'disabled'} for this user.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update user feature.');
    } finally {
      setUserControlBusy(false);
    }
  }

  async function loadProjectPolicy(projectId: string) {
    try {
      const data = await request(`/api/admin/projects/${projectId}`);
      setProjectPolicies(current => ({
        ...current,
        [projectId]: {
          override: data.override ?? null,
          effectiveMode: data.effectiveMode || 'platform',
          n8nCredentials: data.n8nCredentials || []
        }
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load project API mode.');
    }
  }

  async function changeProjectPolicy(projectId: string, apiModeOverride: 'platform' | 'personal' | null) {
    setSavingProjectPolicy(projectId);
    setError('');
    setNotice('');
    try {
      const result = await request(`/api/admin/projects/${projectId}`, {
        method: 'PATCH',
        body: JSON.stringify({ apiModeOverride })
      });
      setProjectPolicies(current => ({
        ...current,
        [projectId]: {
          ...current[projectId],
          override: apiModeOverride,
          effectiveMode: result.effectiveMode || apiModeOverride || 'platform'
        }
      }));
      setNotice(apiModeOverride === null
        ? 'Project API mode is now controlled by the company user.'
        : `Project is now locked to ${apiModeOverride === 'platform' ? 'Our API (Sparrow by TechBliss)' : "the company's own APIs"}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save project API mode.');
    } finally {
      setSavingProjectPolicy('');
    }
  }

  useEffect(() => {
    if (token && selected) {
      selected.projects.forEach(project => {
        if (!projectPolicies[project.id]) void loadProjectPolicy(project.id);
      });
    }
  }, [token, selected?.id]);

  const filteredUsers = useMemo(() =>
    (payload?.users || []).filter(user =>
      `${user.email} ${user.fullName} ${user.projects.map(p => p.url).join(' ')}`
        .toLowerCase().includes(query.toLowerCase())
    ), [payload, query]);

  async function toggleFeature(feature: Feature) {
    setSavingKey(feature.key);
    setError('');
    setNotice('');
    try {
      const result = await request('/api/admin/features', {
        method: 'PATCH',
        body: JSON.stringify({ key: feature.key, enabled: !feature.enabled })
      });
      setFeatures(current => current.map(item => item.key === feature.key ? result.feature : item));
      setNotice(`${feature.label} ${result.feature.enabled ? 'enabled' : 'disabled'}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update feature.');
    } finally {
      setSavingKey('');
    }
  }

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <Link href="/dashboard" className="admin-brand">
          <span className="admin-brand-mark">S</span>
          <span>Sparrow by TechBliss<small>ADMIN CONSOLE</small></span>
        </Link>
        <div className="admin-nav-label">WORKSPACE</div>
        <button className={`admin-nav-item ${tab === 'overview' ? 'active' : ''}`} onClick={() => { setTab('overview'); setSelected(null); }}><span>O</span> Overview</button>
        <button className={`admin-nav-item ${tab === 'users' ? 'active' : ''}`} onClick={() => { setTab('users'); setSelected(null); }}><span>U</span> Users &amp; projects</button>
        <button className={`admin-nav-item ${tab === 'features' ? 'active' : ''}`} onClick={() => { setTab('features'); setSelected(null); }}><span>F</span> Feature controls</button>
        <div className="admin-sidebar-bottom">
          <div className="admin-secure"><span>?</span><div><b>Protected console</b><small>Admin-only access</small></div></div>
          <Link href="/dashboard" className="admin-back-link">← Open regular QASS</Link>
        </div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <div>
            <span className="admin-eyebrow">SPARROW / ADMINISTRATION</span>
            <h1>{selected ? 'User details' : tab === 'overview' ? 'Platform overview' : tab === 'users' ? 'Users & projects' : 'Feature controls'}</h1>
          </div>
          <div className="admin-top-actions">
            <span className="admin-live"><i /> Admin mode</span>
            <button className="admin-refresh" onClick={() => void load()} disabled={loading}>Refresh</button>
            <Link href="/dashboard" className="admin-workspace-button">Open workspace →</Link>
          </div>
        </header>

        {error && <div className="admin-alert error" role="alert">{error}{error.includes('administrator') || error.includes('Sign in') ? <Link href="/login?redirect=%2Fadmin"> Sign in</Link> : null}</div>}
        {notice && <div className="admin-alert success" role="status">{notice}</div>}

        {loading && !payload ? (
          <div className="admin-loading"><span className="admin-spinner" /> Loading your admin workspace...</div>
        ) : (
          <>
            {selected ? (
              <section className="admin-panel admin-user-detail">
                <button className="admin-back-button" onClick={() => setSelected(null)}>← Back to users</button>
                <div className="admin-user-heading">
                  <div className="admin-avatar large">{initials(selected.fullName || selected.email)}</div>
                  <div>
                    <h2>{selected.fullName || 'Unnamed user'}</h2>
                    <p>{selected.email}</p>
                    <div className="admin-tags"><span>{selected.plan}</span><span>{selected.role}</span><span>{selected.projectCount} projects</span></div>
                  </div>
                </div>

                <section className="admin-panel" style={{ marginBottom: 20 }}>
                  <div className="admin-section-head">
                    <div><h3>Plan &amp; feature access</h3><p>Set this account's premium status and override individual feature access.</p></div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 18 }}>
                    <b>Account plan</b>
                    <button className="admin-open-project" onClick={() => void changeUserPlan('free')} disabled={userControlBusy || userControls?.plan === 'free'}>Free</button>
                    <button className="admin-workspace-button" onClick={() => void changeUserPlan('premium')} disabled={userControlBusy || userControls?.plan === 'premium'}>Premium</button>
                    <span className="admin-plan-pill">Current: {userControls?.plan || selected.plan || 'loading'}</span>
                  </div>
                  <div className="admin-feature-mini">
                    {Object.entries(userControls?.features || {}).map(([key, override]) => {
                      const feature = features.find(item => item.key === key);
                      const enabled = feature?.enabled !== false && override !== false;
                      return (
                        <div className="admin-feature-mini-row" key={key}>
                          <span className={`admin-feature-dot ${enabled ? 'enabled' : 'disabled'}`} />
                          <span>{feature?.label || key.replaceAll('_', ' ')}</span>
                          <b className={override === null ? '' : enabled ? 'enabled' : 'disabled'}>
                            {override === null ? 'Inherit' : enabled ? 'Enabled' : 'Disabled'}
                          </b>
                          <button
                            className="admin-open-project"
                            onClick={() => void changeUserFeature(key, !enabled)}
                            disabled={userControlBusy || feature?.enabled === false}
                          >
                            {override === null ? 'Override' : enabled ? 'Disable' : 'Enable'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </section>

                <section className="admin-panel">
                  <div className="admin-section-head">
                    <div><h3>Companies</h3><p>Review project activity and set each company's API mode policy.</p></div>
                  </div>
                  {selected.projects.length ? (
                    <div className="admin-project-list">
                      {selected.projects.map(project => {
                        const policy = projectPolicies[project.id];
                        return (
                          <div className="admin-project-row" key={project.id}>
                            <span className="admin-project-icon">W</span>
                            <div className="admin-project-copy">
                              <b>{project.url}</b>
                              <small>{project.createdAt ? fmtDate(project.createdAt) : 'Date unavailable'} · {project.jobs} generations · Effective mode: {policy?.effectiveMode || 'Loading...'}</small>
                              {policy?.n8nCredentials?.map(credential => (
                                <small key={credential.service}>
                                  {credential.service}: {credential.status}{credential.name ? ` · ${credential.name}` : ''}{credential.message ? ` · ${credential.message}` : ''}
                                </small>
                              ))}
                            </div>
                            <label className="admin-job-count">
                              <span className="sr-only">API mode policy for {project.url}</span>
                              <select
                                value={policy?.override || ''}
                                onChange={event => void changeProjectPolicy(project.id, event.target.value === 'platform' || event.target.value === 'personal' ? event.target.value : null)}
                                disabled={!policy || savingProjectPolicy === project.id}
                              >
                                <option value="">User chooses</option>
                                <option value="platform">Our API</option>
                                <option value="personal">Own APIs</option>
                              </select>
                            </label>
                          </div>
                        );
                      })}
                    </div>
                  ) : <div className="admin-empty">This user has no saved companies.</div>}
                  <div className="admin-detail-meta">
                    <div><small>Account created</small><b>{fmtDate(selected.createdAt)}</b></div>
                    <div><small>Last sign in</small><b>{fmtDate(selected.lastSignInAt)}</b></div>
                    <div><small>User ID</small><b className="admin-id">{selected.id}</b></div>
                  </div>
                </section>
              </section>
            ) : tab === 'overview' ? (
              <>
                <section className="admin-welcome">
                  <div>
                    <span className="admin-eyebrow">ADMIN WORKSPACE</span>
                    <h2>Platform overview</h2>
                    <p>Monitor account activity, saved companies, generation jobs, and platform feature availability.</p>
                  </div>
                  <div className="admin-welcome-art" aria-hidden="true"><span>S</span><span>+</span><span>•</span></div>
                </section>
                <section className="admin-stat-grid" aria-label="Platform statistics">
                  {[
                    ['Registered users', payload?.summary.users ?? 0, 'Accounts in Supabase Auth', 'U'],
                    ['Saved companies', payload?.summary.projects ?? 0, 'Projects across accounts', 'W'],
                    ['Generation jobs', payload?.summary.jobs ?? 0, 'Persisted content jobs', 'G'],
                    ['Active this month', payload?.summary.activeUsers30d ?? 0, 'Users signed in within 30 days', 'A'],
                  ].map(([label, value, detail, icon]) => (
                    <div className="admin-stat-card" key={String(label)}>
                      <div className="admin-stat-top"><span>{label}</span><span className="admin-stat-icon">{icon}</span></div>
                      <strong>{value}</strong>
                      <small>{detail}</small>
                    </div>
                  ))}
                </section>
                <div className="admin-content-grid">
                  <section className="admin-panel">
                    <div className="admin-section-head"><div><h3>Recent generations</h3><p>Latest saved jobs across all companies.</p></div><button className="admin-text-button" onClick={() => setTab('users')}>View users</button></div>
                    {payload?.recentJobs.length ? (
                      <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Company</th><th>Status</th><th>Started</th></tr></thead><tbody>
                        {payload.recentJobs.map(job => <tr key={job.id}><td><b>{job.projectUrl}</b></td><td><span className={`admin-status ${job.status}`}>{job.status}</span></td><td>{fmtDate(job.started_at)}</td></tr>)}
                      </tbody></table></div>
                    ) : <div className="admin-empty">No generation jobs found.</div>}
                  </section>
                  <section className="admin-panel">
                    <div className="admin-section-head"><div><h3>Feature availability</h3><p>Platform-wide controls.</p></div><button className="admin-text-button" onClick={() => setTab('features')}>Manage</button></div>
                    <div className="admin-feature-mini">
                      {features.slice(0, 6).map(feature => <div className="admin-feature-mini-row" key={feature.key}><span className={`admin-feature-dot ${feature.enabled ? 'enabled' : 'disabled'}`} /><span>{feature.label}</span><b className={feature.enabled ? 'enabled' : 'disabled'}>{feature.enabled ? 'On' : 'Off'}</b></div>)}
                      {!features.length && <div className="admin-empty">Feature controls are unavailable.</div>}
                    </div>
                  </section>
                </div>
              </>
            ) : tab === 'users' ? (
              <section className="admin-panel">
                <div className="admin-section-head"><div><h3>Users &amp; projects</h3><p>Select an account to inspect its plan, feature access, and companies.</p></div><span className="admin-count-pill">{filteredUsers.length} users</span></div>
                <label className="admin-search-row"><span aria-hidden="true">⌕</span><span className="sr-only">Search users and companies</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search by name, email, or company" /><button type="button" onClick={() => setQuery('')} disabled={!query}>Clear</button></label>
                {filteredUsers.length ? (
                  <div className="admin-table-wrap"><table className="admin-table users-table"><thead><tr><th>User</th><th>Plan</th><th>Role</th><th>Companies</th><th>Joined</th></tr></thead><tbody>
                    {filteredUsers.map(user => <tr key={user.id}><td><button className="admin-table-user" onClick={() => setSelected(user)}><span className="admin-avatar">{initials(user.fullName || user.email)}</span><span><b>{user.fullName || user.email || 'Unnamed user'}</b><small>{user.email}</small></span></button></td><td><span className="admin-plan-pill">{user.plan}</span></td><td><span className="admin-role-pill">{user.role}</span></td><td>{user.projectCount}</td><td>{fmtDate(user.createdAt)}</td></tr>)}
                  </tbody></table></div>
                ) : <div className="admin-empty">No users match this search.</div>}
              </section>
            ) : (
              <>
                <section className="admin-welcome compact"><div><span className="admin-eyebrow">PLATFORM SETTINGS</span><h2>Feature controls</h2><p>Disable a platform feature globally. Admin accounts retain access to gated features.</p></div></section>
                <section className="admin-feature-grid">
                  {features.map((feature, index) => (
                    <article className="admin-feature-card" key={feature.key}>
                      <div className="admin-feature-card-top"><span className="admin-feature-symbol">{['G', 'S', 'C', 'A', 'M', 'H', 'B', 'P'][index % 8]}</span><button className={`admin-switch ${feature.enabled ? 'on' : ''}`} role="switch" aria-checked={feature.enabled} aria-label={`${feature.label} ${feature.enabled ? 'enabled' : 'disabled'}`} onClick={() => void toggleFeature(feature)} disabled={savingKey === feature.key}><span /></button></div>
                      <h3>{feature.label}</h3><p>{feature.description}</p>
                      <div className="admin-feature-card-footer"><span className={`admin-feature-dot ${feature.enabled ? 'enabled' : 'disabled'}`} />{feature.enabled ? 'Enabled for users' : 'Disabled for users'}</div>
                    </article>
                  ))}
                </section>
                {!features.length && <div className="admin-panel admin-empty">Feature controls are unavailable. Run the admin SQL migration and refresh.</div>}
                <div className="admin-note"><b>Feature access</b><p>Global switches control the listed API routes. A per-user override can further disable a feature, but cannot bypass a platform-wide disabled state.</p></div>
              </>
            )}
          </>
        )}
        <footer className="admin-footer"><span>SPARROW ADMINISTRATION</span><span>Access and feature changes are enforced by the server.</span></footer>
      </section>
    </main>
  );
}