'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  getAccessToken,
} from '@/lib/auth';
import {
  getSupabaseClient,
  listProjects,
  deleteProject,
  type ProjectRow,
} from '@/lib/supabase';
import {
  companyInitials,
  companyNameFromUrl,
  normaliseUrl,
} from '@/lib/utils';
import { useStore } from '@/lib/store';
import AccountMenu from './AccountMenu';
import Modal from './Modal';
import SmartLogo from './SmartLogo';
import {
  fetchBrandAppearance,
  brandThemeComplete,
  mergeTheme,
} from '@/lib/brand-client';

type Account = {
  user: {
    id: string;
    email?: string;
    fullName?: string | null;
  };
  role: string;
  entitlements: {
    plan: string;
    maxCompanies: number | null;
    canRegenerate: boolean;
    canUseAllFeatures: boolean;
  };
};

type BrandTheme = {
  logo_url?: string | null;
  primary_color?: string | null;
  background_color?: string | null;
  text_color?: string | null;
  secondary_color?: string | null;
  [key: string]: unknown;
};

function displayName(
  fullName?: string | null,
  email?: string
) {
  const value = String(fullName || '').trim();

  if (value) {
    return value.split(/\s+/)[0];
  }

  const local = String(email || '')
    .split('@')[0]
    .replace(/[._-]+/g, ' ')
    .trim();

  return local
    ? local
        .split(/\s+/)[0]
        .replace(/^./, c => c.toUpperCase())
    : 'there';
}

function companyName(project: ProjectRow) {
  return String(
    (project.profile as any)?.company_name ||
      companyNameFromUrl(project.url)
  );
}

function canonicalKey(url: string) {
  return (normaliseUrl(url) || url).toLowerCase();
}

export default function WorkspaceHome() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [limitOpen, setLimitOpen] = useState(false);

  const { reset } = useStore();
  const router = useRouter();

  async function load() {
    setLoading(true);
    setError('');

    try {
      const token = await getAccessToken();

      if (!token) {
        router.replace('/login');
        return;
      }

      const [accountRes, rows] = await Promise.all([
        fetch('/api/account', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }),
        listProjects(50, token),
      ]);

      if (!accountRes.ok) {
        throw new Error();
      }

      setAccount(await accountRes.json() as Account);
      setProjects(rows);

      /*
       * Existing projects may have incomplete or missing Brand Data.
       * Hydrate those in the background so the dashboard does not have
       * to wait for brand detection.
       */
      void Promise.all(
        rows.map(async project => {
          const theme = (project.brand_theme || {}) as Record<
            string,
            unknown
          >;

          if (brandThemeComplete(theme)) {
            return null;
          }

          try {
            const fetchedTheme = await fetchBrandAppearance(
              project.url,
              true
            );

            if (!fetchedTheme) {
              return null;
            }

            const currentTheme = (project.brand_theme || {}) as Record<
              string,
              unknown
            >;

            const nextTheme = mergeTheme(
              currentTheme,
              fetchedTheme
            );

            setProjects(current =>
              current.map(item =>
                item.id === project.id
                  ? {
                      ...item,
                      brand_theme: nextTheme,
                    }
                  : item
              )
            );

            const supabase = getSupabaseClient();

            if (supabase) {
              void supabase
                .from('projects')
                .update({
                  brand_theme: nextTheme,
                })
                .eq('id', project.id);
            }

            return null;
          } catch {
            return null;
          }
        })
      );
    } catch {
      setError(
        'Unable to load your companies. Please refresh and try again.'
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const visibleProjects = useMemo(() => {
    const seen = new Set<string>();

    return projects.filter(project => {
      const key =
        canonicalKey(project.url) || project.id;

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }, [projects]);

  const firstName = displayName(
    account?.user.fullName,
    account?.user.email
  );

  const limit =
    account?.entitlements.maxCompanies ?? null;

  const atLimit =
    limit !== null &&
    visibleProjects.length >= limit;

  const addCompany = () => {
    if (atLimit) {
      setLimitOpen(true);
      return;
    }

    reset();
    router.push('/analyse?new=1');
  };

  const signOut = async () => {
    await getSupabaseClient()?.auth.signOut();
    router.replace('/');
  };

  const openCompany = (project: ProjectRow) => {
    reset();
    router.push(
      `/studio?project=${encodeURIComponent(project.id)}`
    );
  };

  const removeCompany = async (project: ProjectRow) => {
    const name = companyName(project);

    if (
      !window.confirm(
        `Delete ${name} and all of its saved generation history? This cannot be undone.`
      )
    ) {
      return;
    }

    try {
      const token = await getAccessToken();

      await deleteProject(
        project.id,
        token || undefined
      );

      setProjects(current =>
        current.filter(
          item => item.id !== project.id
        )
      );

      setError('');
    } catch {
      setError(
        'Unable to delete that company. Please refresh and try again.'
      );
    }
  };

  if (loading) {
    return (
      <div className="dashboard-v6-loading">
        <div className="dashboard-v6-spinner" />
        <strong>Loading your companies</strong>
        <span>Preparing your workspace…</span>
      </div>
    );
  }

  return (
    <div className="dashboard-v6">
      <header className="dashboard-v6-header">
        <a
          href="/"
          className="dashboard-v6-brand"
        >
          Sparrow
        </a>

        <div className="dashboard-v6-header-center">
          YOUR WORKSPACE
        </div>

        <AccountMenu />
      </header>

      <main className="dashboard-v6-main">
        <div className="dashboard-v6-welcome">
          <div>
            <span>CONTENT OPERATING SYSTEM</span>

            <h1>
              Hello, {firstName}.
            </h1>

            <p>
              Your companies and their content workspaces.
            </p>
          </div>

          <button
            className="dashboard-v6-add"
            onClick={addCompany}
          >
            ＋ Add company
          </button>
        </div>

        {error && (
          <div className="dashboard-v6-error">
            {error}
          </div>
        )}

        <section className="dashboard-v6-companies">
          <div className="dashboard-v6-section-head">
            <div>
              <span>YOUR COMPANIES</span>

              <h2>
                Choose a workspace.
              </h2>
            </div>

            <small>
              {visibleProjects.length}{' '}
              {visibleProjects.length === 1
                ? 'saved company'
                : 'saved companies'}
            </small>
          </div>

          {visibleProjects.length === 0 ? (
            <button
              className="dashboard-v6-empty"
              onClick={addCompany}
            >
              <span>＋</span>

              <strong>
                Add your first company
              </strong>

              <small>
                Start with the company website and
                Sparrow will build the workspace.
              </small>
            </button>
          ) : (
            <div className="dashboard-v6-grid">
              {visibleProjects.map(project => {
                const name = companyName(project);

                /*
                 * Every company gets its own stored Brand Data.
                 * Nothing here is hardcoded to CHT or TechBliss.
                 */
                const theme =
                  (project.brand_theme || {}) as BrandTheme;

                const logo =
                  String(theme.logo_url || '').trim();

                const primary =
                  String(
                    theme.primary_color || '#f97316'
                  ).trim();

                const background =
                  String(
                    theme.background_color ||
                      '#ffffff'
                  ).trim();

                const textColor =
                  String(
                    theme.text_color || '#111827'
                  ).trim();

                /*
                 * These variables are also consumed by the
                 * existing dashboard CSS.
                 *
                 * This is what keeps the CHT red,
                 * TechBliss colours, etc. independent.
                 */
                const companyStyle = {
                  '--company-primary': primary,
                  '--company-background': background,
                  '--company-text': textColor,
                } as React.CSSProperties;

                /*
                 * Explicit logo-box styling.
                 *
                 * Same geometry for every company:
                 * - 150 × 150
                 * - rounded corners
                 * - 2px brand-colour border
                 * - company-specific background
                 * - no cropping
                 */
                const logoBoxStyle = {
                  width: '150px',
                  height: '150px',
                  minWidth: '150px',
                  minHeight: '150px',
                  borderRadius: '18px',
                  border: `2px solid ${primary}`,
                  backgroundColor: background,
                  color: primary,
                  boxSizing: 'border-box',
                  display: 'grid',
                  placeItems: 'center',
                  overflow: 'hidden',
                } as React.CSSProperties;

                return (
                  <div
                    key={project.id}
                    className="dashboard-v6-card dashboard-v6-company-only"
                    style={companyStyle}
                  >
                    <button
                      type="button"
                      className="dashboard-v6-company-open"
                      onClick={() =>
                        openCompany(project)
                      }
                      aria-label={`Open ${name} workspace`}
                    >
                      <span
                        className="dashboard-v6-logo dashboard-v6-logo-large"
                        style={logoBoxStyle}
                      >
                        {logo ? (
                          <SmartLogo
                            src={
                              '/api/brand-logo?src=' +
                              encodeURIComponent(
                                logo
                              )
                            }
                            alt={`${name} logo`}
                          />
                        ) : (
                          <b>
                            {companyInitials(name)}
                          </b>
                        )}
                      </span>

                      <h3
                        style={{
                          color: primary,
                        }}
                      >
                        {name}
                      </h3>
                    </button>

                    <button
                      type="button"
                      className="dashboard-v6-delete"
                      onClick={() =>
                        void removeCompany(project)
                      }
                      aria-label={`Delete ${name}`}
                      title="Delete company"
                    >
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M4 7h16M9 7V4h6v3M8 11v7M12 11v7M16 11v7M6 7l1 14h10l1-14" />
                      </svg>
                    </button>
                  </div>
                );
              })}

              <button
                className="dashboard-v6-card dashboard-v6-add-card"
                onClick={addCompany}
              >
                <span>＋</span>

                <strong>
                  Add another company
                </strong>

                <small>
                  Each company keeps its own brand
                  system.
                </small>
              </button>
            </div>
          )}
        </section>
      </main>

      <footer className="dashboard-v6-footer">
        <span>
          SPARROW · CONTENT OPERATING SYSTEM

          <span className="footer-powered-by">
            · Powered by{' '}
            <a
              href="https://techbliss.in"
              target="_blank"
              rel="noopener noreferrer"
            >
              TechBliss
            </a>
          </span>
        </span>

        <button onClick={signOut}>
          Sign out
        </button>
      </footer>

      <Modal
        open={limitOpen}
        onClose={() => setLimitOpen(false)}
        small
      >
        <div className="panel-head">
          <h2>
            Company limit reached
          </h2>

          <p>
            Your current plan allows {limit}{' '}
            saved{' '}
            {limit === 1
              ? 'company'
              : 'companies'}.
          </p>
        </div>

        <div className="panel-body">
          <p>
            Your existing workspace is safe.
            Choose a plan with more company
            workspaces when you’re ready.
          </p>

          <div
            style={{
              display: 'flex',
              gap: 8,
              justifyContent: 'flex-end',
            }}
          >
            <button
              className="btn btn-ghost"
              onClick={() =>
                setLimitOpen(false)
              }
            >
              Close
            </button>

            <a
              className="btn btn-primary"
              href="/pricing"
            >
              View plans
            </a>
          </div>
        </div>
      </Modal>
    </div>
  );
}