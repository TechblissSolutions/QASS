'use client';
import { Suspense, useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { DEFAULT_PREFS, useStore } from '@/lib/store';
import { getAccessToken } from '@/lib/auth';
import { updateProject } from '@/lib/supabase';
import { parseForm2Html } from '@/lib/parser';
import { normaliseUrl } from '@/lib/utils';
import StoreLoading from '@/components/StoreLoading';
import AccountMenu from '@/components/AccountMenu';

const STEPS = [
  { at: 0, l: 'Opening the website' },
  { at: 8, l: 'Reading pages and offers' },
  { at: 22, l: 'Building your brand profile' },
  { at: 40, l: 'Preparing your profile for review' },
];

export default function AnalysePageWrapper() {
  return (
    <Suspense fallback={<StoreLoading />}>
      <AnalysePage />
    </Suspense>
  );
}

type DraftAccount = {
  id: string;
  provider: string;
  account_name: string;
  account_handle?: string | null;
  status: string;
};

type ProviderInfo = { id: string; configured: boolean };

const SOCIAL_PROVIDERS = [
  ['instagram', 'Instagram'],
  ['facebook', 'Facebook'],
  ['linkedin', 'LinkedIn'],
  ['x', 'X / Twitter'],
  ['youtube', 'YouTube'],
  ['wordpress', 'WordPress'],
] as const;

function AnalysePage() {
  const { s, set, ready, reset } = useStore();
  const router = useRouter();
  const searchParams = useSearchParams();

  const isNew = searchParams.get('new') === '1';

  const [sec, setSec] = useState(0);
  const [err, setErr] = useState('');
  const [mounted, setMounted] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  // Which screen the "new company" flow is on. Only buttons change this.
  const [step, setStep] = useState<'url' | 'social' | 'review'>('url');
  // Existing-company flow analyses straight away; new-company flow waits for the button.
  const [analysisRequested, setAnalysisRequested] = useState(!isNew);
  const [attempt, setAttempt] = useState(0);
  const [draftProjectId, setDraftProjectId] = useState<string | null>(null);
  const [draftUrl, setDraftUrl] = useState('');
  const [draftAccounts, setDraftAccounts] = useState<DraftAccount[]>([]);
  const [draftProviderConfig, setDraftProviderConfig] = useState<Record<string, boolean>>({});
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const ran = useRef(false);
  const t0 = useRef(Date.now());

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const t = setInterval(
      () => setSec(Math.floor((Date.now() - t0.current) / 1000)),
      500,
    );
    return () => clearInterval(t);
  }, []);

  // Abort any in-flight analysis only when the page unmounts.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // /analyse?new=1 is a clean start. When OAuth returns with ?url=&project=,
  // resume on the social screen without starting analysis.
  useEffect(() => {
    if (!ready || !isNew) return;
    reset();
    const resumeUrl = searchParams.get('url') || '';
    const resumeProject = searchParams.get('project') || null;
    setUrlInput(resumeUrl);
    setDraftProjectId(resumeProject);
    setDraftUrl(resumeProject ? resumeUrl : '');
    setStep(resumeUrl ? 'social' : 'url');
    setAnalysisRequested(false);
    setErr('');
    ran.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, isNew]);

  // Load saved social connections for the draft company.
  useEffect(() => {
    if (!isNew || !draftProjectId) return;
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const r = await fetch(
          `/api/scheduling/accounts?project=${encodeURIComponent(draftProjectId)}`,
          { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
        );
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'Unable to load saved social accounts.');
        if (!cancelled) {
          setDraftAccounts(d.accounts || []);
          setDraftProviderConfig(
            Object.fromEntries(
              ((d.providers || []) as ProviderInfo[]).map((p) => [p.id, p.configured]),
            ),
          );
        }
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : 'Unable to load social accounts.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isNew, draftProjectId]);

  // Website analysis: only after "Analyse Website" (or immediately for existing companies).
  useEffect(() => {
    if (!ready || !analysisRequested || (isNew && step !== 'review') || !s.url) return;
    if (ran.current) return;
    ran.current = true;
    t0.current = Date.now();
    setSec(0);

    const ac = new AbortController();
    abortRef.current = ac;

    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) {
          router.replace('/login?redirect=' + encodeURIComponent('/analyse?new=1'));
          return;
        }
        const res = await fetch('/api/analyse', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ url: s.url }),
          signal: ac.signal,
        });
        if (!res.ok) {
          const e = await res.json().catch(() => ({ error: 'Status ' + res.status }));
          if (res.status === 402) {
            throw new Error(
              (e.error || 'You have reached your company limit.') +
                ' Visit /pricing to view plans.',
            );
          }
          throw new Error(e.error || `Analysis failed (${res.status}).`);
        }
        const data = await res.json();
        const profile = parseForm2Html(String(data.html || ''));
        if (!profile.company_name && !profile.company_summary) {
          throw new Error(
            'No brand data returned. Check the analysis workflow and try again.',
          );
        }
        set({
          projectId: data.projectId || null,
          jobRowId: null,
          profile,
          prefs: { ...DEFAULT_PREFS },
          jobId: null,
          generationRequestId: null,
          jobStarted: 0,
          generationStatus: 'idle',
          sections: {},
          schedule: {},
          brandTheme: null,
        });
        if (data.projectId) {
          await updateProject(
            String(data.projectId),
            { profile, prefs: DEFAULT_PREFS },
            token,
          );
        }
        router.push(
          data.projectId
            ? `/brand?project=${encodeURIComponent(data.projectId)}`
            : '/brand',
        );
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setErr(e instanceof Error ? e.message : 'Analysis failed.');
      }
    })();
    // No abort in cleanup: Strict Mode / identity changes would kill the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, isNew, step, analysisRequested, s.url, attempt]);

  // STEP 1 -> 2: the only way to leave the URL screen.
  function continueToSocials() {
    setErr('');
    const url = normaliseUrl(urlInput);
    if (!url) {
      setErr('Enter a valid company website, like yourcompany.com');
      return;
    }
    setUrlInput(url);
    // A different URL than the existing draft means a different company.
    if (draftProjectId && url !== draftUrl) {
      setDraftProjectId(null);
      setDraftUrl('');
      setDraftAccounts([]);
      setDraftProviderConfig({});
    }
    setAnalysisRequested(false);
    setStep('social');
  }

  function providerLabel(provider: string) {
    return SOCIAL_PROVIDERS.find(([id]) => id === provider)?.[1] || provider;
  }

  async function connectDraftProvider(provider: string) {
    setErr('');
    const currentUrl = normaliseUrl(urlInput || s.url);
    if (!currentUrl) {
      setErr('Enter a company website first.');
      return;
    }
    setConnectingProvider(provider);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Please sign in again.');

      const readiness = await fetch(`/api/scheduling/oauth/${provider}?check=1`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const readinessData = await readiness.json().catch(() => ({}));
      if (!readiness.ok || !readinessData.configured) {
        throw new Error(
          readinessData.error ||
            `${providerLabel(provider)} is not configured yet. Set up its OAuth credentials before connecting.`,
        );
      }

      let projectId = draftProjectId;
      // The draft company is created only on an explicit Connect click.
      if (!projectId) {
        const draft = await fetch('/api/scheduling/projects/draft', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ url: currentUrl }),
        });
        const draftData = await draft.json().catch(() => ({}));
        if (!draft.ok || !draftData.projectId) {
          throw new Error(draftData.error || 'Unable to prepare this company connection.');
        }
        projectId = String(draftData.projectId);
        setDraftProjectId(projectId);
        setDraftUrl(currentUrl);
        router.replace(
          `/analyse?new=1&url=${encodeURIComponent(currentUrl)}&project=${encodeURIComponent(projectId)}`,
        );
      }

      const returnTo = `/analyse?new=1&url=${encodeURIComponent(currentUrl)}&project=${encodeURIComponent(projectId)}`;
      const r = await fetch(
        `/api/scheduling/oauth/${provider}?project=${encodeURIComponent(projectId)}&returnTo=${encodeURIComponent(returnTo)}`,
        { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
      );
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url) throw new Error(d.error || 'Unable to start connection.');
      window.location.href = String(d.url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Unable to connect this account.');
      setConnectingProvider(null);
    }
  }

  // Skip for now and Continue both go to the review screen.
  function goToReview() {
    setErr('');
    setAnalysisRequested(false);
    setStep('review');
  }

  async function confirmAndStartAnalysis() {
    setErr('');
    const url = normaliseUrl(urlInput);
    if (!url) {
      setErr('Enter a valid company website first.');
      return;
    }
    try {
      // If the website was edited after accounts were connected, move the draft
      // company to the new URL so the connections stay attached to it.
      if (draftProjectId && url !== draftUrl) {
        const token = await getAccessToken();
        if (!token) throw new Error('Please sign in again.');
        await updateProject(draftProjectId, { url }, token);
        setDraftUrl(url);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Unable to update the website.');
      return;
    }
    set({ url, projectId: draftProjectId || null });
    ran.current = false;
    setAnalysisRequested(true);
  }

  function Header() {
    return (
      <header className="sparrow-account-header">
        <div className="sparrow-header-left">
          <button
            className="sparrow-wordmark"
            onClick={() => router.push('/dashboard')}
            aria-label="Back to Sparrow"
          >
            <span className="sparrow-mark">S</span>
            <span>sparrow</span>
          </button>
          <nav className="sparrow-global-nav">
            <button onClick={() => router.push('/dashboard')}>All companies</button>
            <button onClick={() => router.push('/analyse?new=1')}>＋ Add company</button>
          </nav>
        </div>
        <AccountMenu compact />
      </header>
    );
  }

  if (!ready) return <StoreLoading />;

  // Screen 1: Create Company (website bar)
  if ((isNew && step === 'url') || (!isNew && !s.url)) {
    return (
      <div className="sparrow-global-page analyse-page">
        {Header()}
        <main className="sparrow-global-main">
          <div className="work-card analyse-card">
            <div className="analyse-inner">
              <div className="auth-kicker">CREATE COMPANY</div>
              <h2>Start with your company website.</h2>
              <p className="analyse-copy">Enter your company website to continue.</p>
              <div className="analyse-urlbar">
                <div className="analyse-url-input">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9S8.2 15.3 8.2 12 9.5 5.7 12 3z" />
                  </svg>
                  <input
                    autoFocus
                    type="url"
                    placeholder="yourcompany.com"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') continueToSocials();
                    }}
                  />
                </div>
                <button className="btn btn-primary analyse-submit" onClick={continueToSocials}>
                  Continue to social accounts
                </button>
              </div>
              {err && <p className="err" role="alert">{err}</p>}
              <div className="analyse-back">
                <button className="btn btn-ghost" onClick={() => router.push('/dashboard')}>
                  ← Back to workspace
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Screen 2: Social Publishing
  if (isNew && step === 'social') {
    return (
      <div className="sparrow-global-page analyse-page">
        {Header()}
        <main className="sparrow-global-main">
          <div className="work-card analyse-card social-handle-step">
            <div className="analyse-inner">
              <div className="auth-kicker">SOCIAL PUBLISHING</div>
              <h2>Connect your publishing accounts</h2>
              <div className="social-connect-grid-page">
                {SOCIAL_PROVIDERS.map(([id, label]) => {
                  const a = draftAccounts.find(
                    (x) => x.provider === id && ['connected', 'expired'].includes(x.status),
                  );
                  const expired = a?.status === 'expired';
                  return (
                    <article key={id} className={`social-connect-card ${a ? 'connected' : ''}`}>
                      <div className="social-connect-card-head">
                        <div className={`social-provider-icon social-provider-${id}`}>
                          {label.slice(0, 1)}
                        </div>
                        <div className="social-connect-card-copy">
                          <div className="social-card-title-row">
                            <h2>{label}</h2>
                            {a && (
                              <span className="social-card-status">
                                {expired ? 'Reconnect required' : 'Connected'}
                              </span>
                            )}
                          </div>
                          {(a?.account_name || a?.account_handle) && (
                            <p>
                              {a?.account_name || ''}
                              {a?.account_handle ? ` · ${a.account_handle}` : ''}
                            </p>
                          )}
                          {draftProviderConfig[id] === false && (
                            <p className="social-provider-unavailable">
                              OAuth credentials not configured
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="social-connect-actions">
                        <button
                          className="social-connect-big"
                          disabled={connectingProvider === id}
                          onClick={() => void connectDraftProvider(id)}
                        >
                          {connectingProvider === id ? 'Connecting…' : a ? 'Reconnect' : 'Connect'}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
              {err && <p className="err" role="alert">{err}</p>}
              <div className="social-handle-actions">
                <button className="btn btn-ghost" onClick={() => { setErr(''); setStep('url'); }}>
                  ← Change website
                </button>
                <button className="btn btn-ghost" onClick={goToReview}>Skip for now</button>
                <button className="btn btn-primary" onClick={goToReview}>Continue</button>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Screen 3: Review (editable website). Analysis starts only on the button.
  if (isNew && step === 'review' && !analysisRequested) {
    return (
      <div className="sparrow-global-page analyse-page">
        {Header()}
        <main className="sparrow-global-main">
          <div className="work-card analyse-card">
            <div className="analyse-inner">
              <div className="auth-kicker">READY WHEN YOU ARE</div>
              <h2>Review your company website</h2>
              <p className="analyse-copy">
                You can edit the website below. Sparrow has not analysed it yet. Click Analyse Website when you are ready.
              </p>
              <div className="analyse-urlbar">
                <div className="analyse-url-input">
                  <span aria-hidden="true">↗</span>
                  <input
                    type="url"
                    aria-label="Company website"
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void confirmAndStartAnalysis();
                    }}
                  />
                </div>
              </div>
              {err && <p className="err" role="alert">{err}</p>}
              <div className="social-handle-actions">
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setErr('');
                    setStep('social');
                  }}
                >
                  ← Back to social connections
                </button>
                <button className="btn btn-primary" onClick={() => void confirmAndStartAnalysis()}>
                  Analyse Website
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Error during analysis
  if (err) {
    return (
      <div className="center-page">
        <div className="work-card">
          <h2>Something went wrong</h2>
          <p className="err" role="alert">{err}</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 18 }}>
            <button
              className="btn btn-ghost"
              onClick={() => {
                abortRef.current?.abort();
                reset();
                router.push('/dashboard');
              }}
            >
              Back to workspace
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                ran.current = false;
                setErr('');
                setAttempt((a) => a + 1);
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Loading
  const progressPercent = Math.min(92, Math.max(8, 12 + sec * 0.72));
  const activeStep = STEPS.reduce((idx, st, i) => (sec >= st.at ? i : idx), 0);
  return (
    <div className="center-page analyse-page">
      <div className="work-card analyse-card analyse-loading-card" role="status" aria-live="polite">
        <div className="analyse-loading-inner">
          <div className="analyse-kicker">ANALYSING WEBSITE</div>
          <h2>Reading your website</h2>
          <div className="analyse-url">{mounted ? s.url : ''}</div>
          <div className="analyse-progress-track" aria-label="Analysis progress">
            <div className="analyse-progress-fill" style={{ width: `${progressPercent}%` }} />
          </div>
          <div className="analyse-steps">
            {STEPS.map((st, i) => (
              <div
                key={i}
                className={`analyse-step ${i < activeStep ? 'done' : ''} ${i === activeStep ? 'current' : ''}`}
              >
                <span className="analyse-step-icon">
                  {i < activeStep ? '✓' : i === activeStep ? '•' : ''}
                </span>
                <span>{st.l}</span>
              </div>
            ))}
          </div>
          <div className="analyse-loading-footer">
            <span>Building your company profile</span>
            <button
              className="btn btn-danger btn-sm"
              onClick={() => {
                abortRef.current?.abort();
                reset();
                router.push('/dashboard');
              }}
            >
              Cancel analysis
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
