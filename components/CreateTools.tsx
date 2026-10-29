'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getAccessToken, refreshAccessToken } from '@/lib/auth';
import { useStore } from '@/lib/store';
import Modal from '@/components/Modal';
import { useToast } from '@/components/Toast';
import CompanyHeader from '@/components/CompanyHeader';
import styles from './CreateTools.module.css';
import dynamic from 'next/dynamic';
import './create/create-motion.css';

// 3D scene is client-only and loads after the page
const CreateScene = dynamic(() => import('@/components/create/CreateScene'), { ssr: false });

type ToolTab = 'image' | 'video' | 'email';
type MediaType = 'image' | 'video';
type MediaResult = { id: string; url: string; type: MediaType; action: string; index: number; count: number };
type EmailResult = { id: string; subject: string; body: string; notes: string };
type SwipeEntry = EmailResult & { savedAt: string };
type FailedMedia = { payload: Record<string, unknown>; resultIndex: number; action: string; index: number; count: number };
type JsonRecord = Record<string, unknown>;

const SWIPE_STORAGE_KEY = 'techbliss-email-swipe-file-v1';

function createLocalId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const imageActions = [
  ['create_image', 'Generate from prompt'],
  ['url_to_image', 'Create from public URL'],
  ['image_variation', 'Generate variations'],
  ['image_carousel', 'Generate carousel'],
] as const;

const videoActions = [
  ['create_video', 'Generate from prompt'],
  ['image_to_video', 'Animate a source image'],
  ['url_to_video', 'Create from public URL'],
  ['video_variation', 'Generate video variations'],
] as const;

const emailActions = [
  ['email_variations', 'Create variations'],
  ['email_clone', 'Adapt an email'],
  ['url_to_email', 'Draft from a public URL'],
  ['translate_email', 'Translate an email'],
] as const;

const samplePrompts: Record<MediaType, string> = {
  image: 'A crisp editorial product photograph with warm studio light, tactile materials, and a confident modern composition.',
  video: 'A short product film: open on a detail shot, reveal the product with a smooth camera move, then finish on a clean branded frame.',
};

async function postJson(path: string, body: Record<string, unknown>): Promise<JsonRecord> {
  let token = await getAccessToken();
  if (!token) token = await refreshAccessToken();
  if (!token) throw new Error('Your session expired. Sign in again to continue.');

  const send = (accessToken: string) => fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  let response = await send(token);
  if (response.status === 401) {
    const refreshedToken = await refreshAccessToken();
    if (refreshedToken && refreshedToken !== token) {
      token = refreshedToken;
      response = await send(token);
    }
  }
  const result: unknown = await response.json().catch(() => ({}));
  const data = result && typeof result === 'object' && !Array.isArray(result) ? result as JsonRecord : {};
  if (response.status === 401) throw new Error('Your session expired. Sign in again, then retry.');
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : `Request failed (HTTP ${response.status}).`);
  return data;
}

function readSwipeFile(): SwipeEntry[] {
  try {
    const raw = localStorage.getItem(SWIPE_STORAGE_KEY);
    const value: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is SwipeEntry => Boolean(
      item && typeof item === 'object' && typeof item.id === 'string' &&
      typeof item.subject === 'string' && typeof item.body === 'string' && typeof item.savedAt === 'string'
    ));
  } catch {
    return [];
  }
}

function publicMediaUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('The media workflow returned no usable media URL.');
  const url = new URL(value);
  if (url.protocol !== 'https:') throw new Error('The media workflow returned a non-HTTPS media URL.');
  return url.toString();
}

function normalizeEmailResults(value: unknown): EmailResult[] {
  if (!Array.isArray(value)) throw new Error('The email workflow returned no email drafts.');
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const email = item as JsonRecord;
    if (typeof email.body !== 'string' || !email.body.trim()) return null;
    return {
      id: `email-${Date.now()}-${index}-${createLocalId()}`,
      subject: typeof email.subject === 'string' ? email.subject : 'Email draft',
      body: email.body,
      notes: typeof email.notes === 'string' ? email.notes : '',
    };
  }).filter((item): item is EmailResult => item !== null);
}

export default function CreateTools() {
  const router = useRouter();
  const { s, ready } = useStore();
  const toast = useToast();
  const [token, setToken] = useState('');
  const [authChecked, setAuthChecked] = useState(false);
  const [tab, setTab] = useState<ToolTab>('image');
  const [error, setError] = useState('');

  const [mediaAction, setMediaAction] = useState<string>('create_image');
  const [mediaPrompt, setMediaPrompt] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceImageUrl, setSourceImageUrl] = useState('');
  const [mediaCount, setMediaCount] = useState(3);
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [imageQuality, setImageQuality] = useState('high');
  const [imageResolution, setImageResolution] = useState('2k');
  const [videoResolution, setVideoResolution] = useState('720p');
  const [duration, setDuration] = useState(8);
  const [sceneCount, setSceneCount] = useState(3);
  const [mediaResults, setMediaResults] = useState<MediaResult[]>([]);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaProgress, setMediaProgress] = useState('');
  const [failedMedia, setFailedMedia] = useState<FailedMedia | null>(null);
  const [preview, setPreview] = useState<MediaResult | null>(null);

  const [emailAction, setEmailAction] = useState<string>('email_variations');
  const [emailContent, setEmailContent] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailSourceUrl, setEmailSourceUrl] = useState('');
  const [targetLanguage, setTargetLanguage] = useState('English');
  const [emailAudience, setEmailAudience] = useState('');
  const [emailTone, setEmailTone] = useState('');
  const [emailInstructions, setEmailInstructions] = useState('');
  const [emailCount, setEmailCount] = useState(3);
  const [emailResults, setEmailResults] = useState<EmailResult[]>([]);
  const [emailBusy, setEmailBusy] = useState(false);
  const [savedEmails, setSavedEmails] = useState<SwipeEntry[]>([]);
  const [savedEmailFocusId, setSavedEmailFocusId] = useState('');
  const [copiedEmailId, setCopiedEmailId] = useState('');

  useEffect(() => {
    let active = true;
    void getAccessToken().then(accessToken => {
      if (!active) return;
      if (!accessToken) {
        const destination = `/create${window.location.search}`;
        router.replace(`/login?redirect=${encodeURIComponent(destination)}`);
        return;
      }
      setToken(accessToken);
      setAuthChecked(true);
    }).catch(() => {
      if (active) router.replace('/login?redirect=%2Fcreate');
    });
    return () => { active = false; };
  }, [router]);

  useEffect(() => setSavedEmails(readSwipeFile()), []);

  useEffect(() => {
    if (!savedEmailFocusId) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`saved-email-${savedEmailFocusId}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    });
    const timeout = window.setTimeout(() => setSavedEmailFocusId(''), 2600);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [savedEmailFocusId, savedEmails]);

  const activeMediaType: MediaType = tab === 'video' ? 'video' : 'image';
  const actions = activeMediaType === 'image' ? imageActions : videoActions;
  const isBatch = ['image_variation', 'image_carousel', 'video_variation'].includes(mediaAction);
  const needsSourceUrl = mediaAction === 'url_to_image' || mediaAction === 'url_to_video';
  const needsSourceImage = mediaAction === 'image_to_video';

  const setTabAndAction = (nextTab: ToolTab) => {
    setTab(nextTab);
    setError('');
    if (nextTab === 'image') {
      setMediaAction(current => videoActions.some(([value]) => value === current) ? 'create_image' : current);
      setAspectRatio('1:1');
    } else if (nextTab === 'video') {
      setMediaAction(current => imageActions.some(([value]) => value === current) ? 'create_video' : current);
      setAspectRatio('9:16');
    }
  };

  const updateSwipeFile = (items: SwipeEntry[]) => {
    try {
      localStorage.setItem(SWIPE_STORAGE_KEY, JSON.stringify(items.slice(0, 100)));
      setSavedEmails(items.slice(0, 100));
      return true;
    } catch {
      setError('Browser storage is unavailable, so this email was not saved.');
      return false;
    }
  };

  const requestMedia = async (payload: Record<string, unknown>): Promise<string> => {
    const result = await postJson('/api/media', payload);
    if (result.success !== true) throw new Error(typeof result.error === 'string' ? result.error : 'The media workflow did not complete the request.');
    return publicMediaUrl(result.media_url);
  };

  const buildMediaPayload = (index: number, count: number) => {
    const sceneTimings = activeMediaType === 'video'
      ? Array.from({ length: sceneCount }, (_, i) => ({
          scene: i + 1,
          start: duration * i / sceneCount,
          end: i + 1 === sceneCount ? duration : duration * (i + 1) / sceneCount,
        }))
      : [];
    return {
      card_id: `create-${activeMediaType}-${createLocalId()}`,
      platform: `${activeMediaType === 'image' ? 'Image' : 'Video'} Studio`,
      title: mediaPrompt.trim().slice(0, 120),
      content: mediaPrompt.trim(),
      prompt: mediaPrompt.trim(),
      media_type: activeMediaType,
      media_action: mediaAction,
      ...(needsSourceUrl ? { source_url: sourceUrl.trim() } : {}),
      ...(needsSourceImage ? { source_image_url: sourceImageUrl.trim() } : {}),
      variation_index: index,
      variation_count: count,
      aspect_ratio: aspectRatio,
      image_quality: activeMediaType === 'image' ? imageQuality : '',
      image_resolution: activeMediaType === 'image' ? imageResolution : '',
      video_resolution: activeMediaType === 'video' ? videoResolution : '',
      ...(activeMediaType === 'video' ? {
        duration,
        requested_duration: duration,
        scene_count: sceneCount,
        scene_timings: sceneTimings,
      } : {}),
      brand_theme: s.brandTheme || {},
      include_logo: true,
    };
  };

  const generateMedia = async () => {
    setError('');
    setFailedMedia(null);
    setMediaResults([]);
    setMediaBusy(true);
    const count = isBatch ? mediaCount : 1;
    try {
      for (let index = 1; index <= count; index += 1) {
        setMediaProgress(count > 1 ? `Generating ${activeMediaType} ${index} of ${count}...` : `Generating ${activeMediaType}...`);
        const payload = buildMediaPayload(index, count);
        try {
          const url = await requestMedia(payload);
          setMediaResults(current => [...current, { id: `${mediaAction}-${index}`, url, type: activeMediaType, action: mediaAction, index, count }]);
        } catch (err) {
          setFailedMedia({ payload, resultIndex: index - 1, action: mediaAction, index, count });
          throw err;
        }
      }
      toast(count > 1 ? `${count} ${activeMediaType} results ready` : `${activeMediaType === 'image' ? 'Image' : 'Video'} generated`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed. Check the request and retry.');
    } finally {
      setMediaBusy(false);
      setMediaProgress('');
    }
  };

  const retryMedia = async () => {
    if (!failedMedia) return;
    setError('');
    setMediaBusy(true);
    setMediaProgress(`Retrying ${failedMedia.index} of ${failedMedia.count}...`);
    try {
      const url = await requestMedia(failedMedia.payload);
      const next: MediaResult = { id: `${failedMedia.action}-${failedMedia.index}`, url, type: activeMediaType, action: failedMedia.action, index: failedMedia.index, count: failedMedia.count };
      setMediaResults(current => {
        const copy = [...current];
        copy[failedMedia.resultIndex] = next;
        return copy;
      });
      setFailedMedia(null);
      toast('Retry succeeded');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed.');
    } finally {
      setMediaBusy(false);
      setMediaProgress('');
    }
  };

  const generateEmail = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setEmailBusy(true);
    setError('');
    setEmailResults([]);
    try {
      const languageInstruction = emailAction === 'translate_email'
        ? ''
        : `Write every email subject and body in ${targetLanguage}. Do not follow the source email's language if it differs.`;
      const result = await postJson('/api/content-tools', {
        action: emailAction,
        email: emailContent.trim(),
        subject: emailSubject.trim(),
        source_url: emailSourceUrl.trim(),
        target_language: targetLanguage,
        target_audience: emailAudience.trim(),
        tone: emailTone.trim(),
        instructions: [emailInstructions.trim(), languageInstruction].filter(Boolean).join('\n\n'),
        count: emailCount,
      });
      if (result.success !== true) throw new Error(typeof result.error === 'string' ? result.error : 'The email workflow did not complete the request.');
      const normalized = normalizeEmailResults(result.emails);
      if (!normalized.length) throw new Error('The email workflow returned no usable drafts. Retry or adjust your request.');
      setEmailResults(normalized);
      toast(`${normalized.length} email draft${normalized.length === 1 ? '' : 's'} ready`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Email generation failed. Check the request and retry.');
    } finally {
      setEmailBusy(false);
    }
  };

  const handleSwipe = async (email: EmailResult | SwipeEntry, decision: 'save' | 'discard') => {
    setError('');
    try {
      const result = await postJson('/api/content-tools', {
        action: 'email_swipe',
        decision,
        email_id: email.id,
        email: `Subject: ${email.subject}\n\n${email.body}`,
      });
      if (result.success !== true) throw new Error(typeof result.error === 'string' ? result.error : 'The swipe-file action did not complete.');
      if (decision === 'save') {
        const saved: SwipeEntry = { ...email, savedAt: new Date().toISOString() };
        if (updateSwipeFile([saved, ...savedEmails.filter(item => item.id !== email.id)])) {
          setSavedEmailFocusId(email.id);
          toast('Saved to swipe file');
        }
      } else {
        updateSwipeFile(savedEmails.filter(item => item.id !== email.id));
        setEmailResults(current => current.filter(item => item.id !== email.id));
        toast('Removed from swipe file');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the swipe file.');
    }
  };

  const selectEmailAction = (action: string) => {
    setEmailAction(action);
    setEmailResults([]);
    setError('');
  };

  const copyEmail = async (email: EmailResult, part: 'subject' | 'body' | 'all') => {
    const text = part === 'subject' ? email.subject : part === 'body' ? email.body : `Subject: ${email.subject}\n\n${email.body}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedEmailId(email.id);
      window.setTimeout(() => setCopiedEmailId(current => current === email.id ? '' : current), 1400);
      toast(part === 'subject' ? 'Subject copied' : 'Email copied');
    } catch {
      setError('Clipboard access is unavailable. Select the text and copy it manually.');
    }
  };

  const hasCompany = Boolean(s.projectId && s.profile);
  const studioHref = s.projectId ? `/studio?project=${encodeURIComponent(s.projectId)}` : '/dashboard';

  if (!authChecked || !ready) {
    return <div className={`company-workspace ${hasCompany ? 'reference-app ' : ''}${styles.page}${hasCompany ? '' : ' workspace-personal'}`}><CompanyHeader /><main className={styles.main}><div className={styles.statusLine}><span className={styles.spinner} />Preparing your workspace...</div></main></div>;
  }

  return (
    <div className={`company-workspace ${hasCompany ? 'reference-app ' : ''}${styles.page}${hasCompany ? '' : ' workspace-personal'}`}>
      <CompanyHeader />
      {!hasCompany && <header className={styles.header}>
        <Link className={styles.brand} href="/dashboard">Sparrow by TechBliss</Link>
        <nav className={styles.headerActions} aria-label="Workspace navigation">
          <Link className={styles.headerLink} href="/dashboard">All companies</Link>
        </nav>
      </header>}
      <main className={styles.main}>
        <div className={styles.heading}>
          <div className={styles.headingCopy}><span className={styles.eyebrow}>STUDIO / CREATE</span><h1>Make the next thing.</h1><p>Turn a direction, source image, or email into work you can review.</p></div>
          <div className={styles.headingActions}>
            <span className={styles.workspaceLabel}><i />{hasCompany ? String(s.profile?.company_name || 'Company workspace') : 'Personal workspace'}</span>
            <Link className={styles.backLink} href={studioHref}>Back to {hasCompany ? 'Studio' : 'workspace'}</Link>
          </div>
        </div>

        <div className={styles.tabs} role="tablist" aria-label="Create tools">
          {(['image', 'video', 'email'] as const).map(item => (
            <button key={item} type="button" role="tab" aria-label={`${item === 'image' ? 'Image' : item === 'video' ? 'Video' : 'Email'} Studio`} aria-selected={tab === item} className={styles.tab} onClick={() => setTabAndAction(item)}>
              <span className={`${styles.tabGlyph} ${styles[`tabGlyph${item[0].toUpperCase()}${item.slice(1)}`]}`}>{item === 'image' ? 'I' : item === 'video' ? 'V' : 'E'}</span>
              <span className={styles.tabCopy}><strong>{item === 'image' ? 'Image' : item === 'video' ? 'Video' : 'Email'}</strong><small>{item === 'image' ? 'Create a visual' : item === 'video' ? 'Bring a scene to life' : 'Shape the message'}</small></span>
              <span className={styles.tabArrow} aria-hidden="true">↗</span>
            </button>
          ))}
        </div>

        {error && <div className={styles.error} role="alert">{error}</div>}
        {tab === 'email' ? (
          <div className={styles.layout}>
            <section className={styles.panel} aria-labelledby="email-tool-heading">
              <h2 id="email-tool-heading">Email Studio</h2>
              <p className={styles.panelIntro}>Generate variations, adapt an email, draft from a public page, or translate an existing email.</p>
              <form className={styles.form} onSubmit={generateEmail}>
                <div className={styles.field}>
                  <label htmlFor="email-action">Action</label>
                  <select id="email-action" className={styles.select} value={emailAction} onChange={event => selectEmailAction(event.target.value)}>
                    {emailActions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
                {emailAction === 'url_to_email' ? (
                  <div className={styles.field}><label htmlFor="email-source-url">Public HTTPS page URL</label><input id="email-source-url" className={styles.input} type="url" inputMode="url" placeholder="https://example.com/page" value={emailSourceUrl} onChange={event => setEmailSourceUrl(event.target.value)} required /><small className={styles.fieldHint}>The server checks the URL before the workflow fetches it.</small></div>
                ) : (
                  <>
                    <div className={styles.field}><label htmlFor="email-subject">Subject line</label><input id="email-subject" className={styles.input} maxLength={500} value={emailSubject} onChange={event => setEmailSubject(event.target.value)} placeholder="Optional source subject" /></div>
                    <div className={styles.field}><label htmlFor="email-content">Email content</label><textarea id="email-content" className={styles.textarea} maxLength={30000} value={emailContent} onChange={event => setEmailContent(event.target.value)} placeholder="Paste the email to adapt, translate, or use for variations" required /></div>
                  </>
                )}
                {emailAction !== 'email_swipe' && <div className={styles.field}><label htmlFor="email-language">{emailAction === 'translate_email' ? 'Target language' : 'Output language'}</label><select id="email-language" className={styles.select} value={targetLanguage} onChange={event => setTargetLanguage(event.target.value)}><option>English</option><option>Spanish</option><option>Hindi</option><option>French</option><option>German</option><option>Arabic</option><option>Portuguese</option><option>Japanese</option></select></div>}
                {emailAction === 'email_variations' && <div className={styles.field}><label htmlFor="email-count">Number of variations</label><input id="email-count" className={styles.input} type="number" min={2} max={8} value={emailCount} onChange={event => setEmailCount(Number(event.target.value))} /></div>}
                <div className={styles.twoFields}>
                  <div className={styles.field}><label htmlFor="email-audience">Audience</label><input id="email-audience" className={styles.input} maxLength={2000} value={emailAudience} onChange={event => setEmailAudience(event.target.value)} placeholder="Optional" /></div>
                  <div className={styles.field}><label htmlFor="email-tone">Tone</label><input id="email-tone" className={styles.input} maxLength={500} value={emailTone} onChange={event => setEmailTone(event.target.value)} placeholder="Optional" /></div>
                </div>
                <div className={styles.field}><div className={styles.fieldHead}><label htmlFor="email-instructions">Instructions</label><small className={styles.languageTag}>OUTPUT · {targetLanguage.toUpperCase()}</small></div><textarea id="email-instructions" className={styles.textarea} maxLength={4000} value={emailInstructions} onChange={event => setEmailInstructions(event.target.value)} placeholder="Optional guidance" /></div>
                <button className={styles.primaryButton} type="submit" disabled={!token || emailBusy}>{emailBusy ? 'Generating...' : 'Generate email'}</button>
              </form>
            </section>

            <section className={styles.results} aria-live="polite">
              <div className={styles.resultsHeader}><h2>Email drafts</h2>{emailBusy && <span className={styles.statusLine}><span className={styles.spinner} />Waiting for workflow</span>}</div>
              {emailBusy && <CreateScene kind="email" total={emailAction === 'email_variations' ? emailCount : 0} done={0} />}{emailBusy ? <div className={styles.empty}><strong>Generating email drafts</strong><span>The workflow may take a few moments.</span></div> : emailResults.length ? (
                <div className={styles.emailList}>{emailResults.map((email, index) => {
                  const isSaved = savedEmails.some(saved => saved.id === email.id);
                  return (
                    <article className={`${styles.emailItem} create-arrive`} style={{ '--i': index } as React.CSSProperties} key={email.id}>
                      <div className={styles.emailMeta}>
                        <div className={styles.emailCardHead}><span className={styles.emailOrdinal}>{String(index + 1).padStart(2, '0')}</span><div><small className={styles.emailKicker}>DRAFT · {targetLanguage.toUpperCase()}</small><h3>{email.subject || 'Email draft'}</h3></div>{isSaved && <span className={styles.savedBadge}>Saved</span>}</div>
                        <p className={styles.emailBody}>{email.body}</p>{email.notes && <small className={styles.fieldHint}>{email.notes}</small>}
                        <div className={styles.emailActions}><button className={styles.secondaryButton} type="button" onClick={() => void copyEmail(email, 'all')}>{copiedEmailId === email.id ? 'Copied' : 'Copy email'}</button><button className={isSaved ? styles.primaryButton : styles.secondaryButton} type="button" onClick={() => void handleSwipe(email, 'save')} disabled={isSaved}>{isSaved ? 'Saved' : 'Save to swipe file'}</button><button className={styles.dangerButton} type="button" onClick={() => void handleSwipe(email, 'discard')}>Discard</button></div>
                      </div>
                    </article>
                  );
                })}</div>
              ) : <div className={styles.empty}><strong>Your email drafts will appear here.</strong><span>Choose an action and submit a draft or public HTTPS URL.</span></div>}

              <section className={`${styles.panel} ${styles.swipePanel}`} aria-labelledby="swipe-file-heading">
                <div className={styles.swipePanelHeader}><div><h2 id="swipe-file-heading">Email swipe file</h2><p className={styles.storageNote}>Saved on this browser only. Not synced to your account or other devices.</p></div><span className={styles.progress}>{savedEmails.length} saved</span></div>
                {savedEmails.length ? <div className={styles.swipeList}>{savedEmails.map(email => (
                  <article id={`saved-email-${email.id}`} className={`${styles.swipeItem} ${savedEmailFocusId === email.id ? styles.swipeItemHighlight : ''}`} key={email.id}><div className={styles.emailMeta}><div className={styles.savedCardHead}><span className={styles.savedBadge}>In swipe file</span><time dateTime={email.savedAt}>Saved {new Date(email.savedAt).toLocaleDateString()}</time></div><h3>{email.subject || 'Email draft'}</h3><p className={styles.emailBody}>{email.body}</p><div className={styles.emailActions}><button className={styles.dangerButton} type="button" onClick={() => void handleSwipe(email, 'discard')}>Remove saved email</button></div></div></article>
                ))}</div> : <div className={styles.empty}><strong>No saved emails on this browser.</strong><span>Use “Save to swipe file” on a generated draft.</span></div>}
              </section>
            </section>
          </div>
        ) : (
          <div className={styles.layout}>
            <section className={styles.panel} aria-labelledby="media-tool-heading">
              <h2 id="media-tool-heading">{tab === 'image' ? 'Image Studio' : 'Video Studio'}</h2>
              <p className={styles.panelIntro}>The configured workflow handles generation and status polling. Results appear here when the request completes.</p>
              <form className={styles.form} onSubmit={event => { event.preventDefault(); void generateMedia(); }}>
                <div className={styles.field}><label htmlFor="media-action">Action</label><select id="media-action" className={styles.select} value={mediaAction} onChange={event => { setMediaAction(event.target.value); setMediaResults([]); setFailedMedia(null); setError(''); }}>{actions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
                <div className={styles.field}>
                  <div className={styles.fieldHead}><label htmlFor="media-prompt">{needsSourceUrl ? 'Generation direction' : 'Creative direction'}</label><button className={styles.textAction} type="button" onClick={() => setMediaPrompt(samplePrompts[activeMediaType])}>Use a starter</button></div>
                  <textarea id="media-prompt" className={styles.textarea} maxLength={8000} minLength={10} value={mediaPrompt} onChange={event => setMediaPrompt(event.target.value)} placeholder={tab === 'image' ? 'Describe the image you want to create...' : 'Describe the video, movement, style, and scene...'} required />
                  <div className={styles.fieldFooter}><small className={styles.fieldHint}>Use at least 10 characters. Avoid including confidential information.</small><small className={styles.characterCount}>{mediaPrompt.length}/8000</small></div>
                </div>
                {needsSourceUrl && <div className={styles.field}><label htmlFor="media-source-url">Public HTTPS source URL</label><input id="media-source-url" className={styles.input} type="url" inputMode="url" placeholder="https://example.com/source" value={sourceUrl} onChange={event => setSourceUrl(event.target.value)} required /></div>}
                {needsSourceImage && <div className={styles.field}><label htmlFor="source-image-url">Public HTTPS source image URL</label><input id="source-image-url" className={styles.input} type="url" inputMode="url" placeholder="https://example.com/image.jpg" value={sourceImageUrl} onChange={event => setSourceImageUrl(event.target.value)} required /><small className={styles.fieldHint}>The workflow uses this image as the video source frame.</small></div>}
                {isBatch && <div className={styles.field}><label htmlFor="media-count">{mediaAction === 'image_carousel' ? 'Carousel slides' : 'Number of variations'}</label><input id="media-count" className={styles.input} type="number" min={2} max={6} value={mediaCount} onChange={event => setMediaCount(Number(event.target.value))} /></div>}
                <div className={styles.twoFields}>
                  <div className={styles.field}><label htmlFor="media-ratio">Aspect ratio</label><select id="media-ratio" className={styles.select} value={aspectRatio} onChange={event => setAspectRatio(event.target.value)}>{(tab === 'image' ? ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9'] : ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9']).map(ratio => <option key={ratio}>{ratio}</option>)}</select></div>
                  {tab === 'image' ? <div className={styles.field}><label htmlFor="image-quality">Quality</label><select id="image-quality" className={styles.select} value={imageQuality} onChange={event => setImageQuality(event.target.value)}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="xhigh">Extra high</option><option value="max">Maximum</option></select></div> : <div className={styles.field}><label htmlFor="video-resolution">Resolution</label><select id="video-resolution" className={styles.select} value={videoResolution} onChange={event => setVideoResolution(event.target.value)}><option value="480p">480p</option><option value="720p">720p</option></select></div>}
                </div>
                {tab === 'image' ? <div className={styles.field}><label htmlFor="image-resolution">Image resolution</label><select id="image-resolution" className={styles.select} value={imageResolution} onChange={event => setImageResolution(event.target.value)}><option value="1k">1K</option><option value="2k">2K</option><option value="4k">4K</option></select></div> : <div className={styles.twoFields}><div className={styles.field}><label htmlFor="video-duration">Duration (seconds)</label><input id="video-duration" className={styles.input} type="number" min={4} max={30} value={duration} onChange={event => setDuration(Number(event.target.value))} /></div><div className={styles.field}><label htmlFor="video-scenes">Scene count</label><input id="video-scenes" className={styles.input} type="number" min={1} max={10} value={sceneCount} onChange={event => setSceneCount(Number(event.target.value))} /></div></div>}
                <button className={styles.primaryButton} type="submit" disabled={!token || mediaBusy}>{mediaBusy ? 'Generating...' : tab === 'image' ? 'Generate image' : 'Generate video'}</button>
              </form>
            </section>

            <section className={styles.results} aria-live="polite">
              <div className={styles.resultsHeader}><h2>{tab === 'image' ? 'Image gallery' : 'Video results'}</h2>{mediaProgress && <span className={styles.statusLine}><span className={styles.spinner} />{mediaProgress}</span>}</div>
              {mediaBusy && <CreateScene kind={activeMediaType} total={isBatch ? mediaCount : 1} done={mediaResults.length} />}{mediaResults.length ? <div className={styles.gallery}>{mediaResults.map(result => (
                <article className={`${styles.mediaItem} create-arrive`} style={{ '--i': result.index - 1 } as React.CSSProperties} key={result.id}>
                  {result.type === 'image' ? <img className={styles.mediaPreview} src={result.url} alt={`${result.action.replaceAll('_', ' ')} result ${result.index}`} /> : <video className={styles.mediaVideo} src={result.url} controls playsInline preload="metadata" aria-label={`Generated video ${result.index}`} />}
                  <div className={styles.mediaMeta}><strong>{result.count > 1 ? `Result ${result.index} of ${result.count}` : 'Generated result'}</strong><div className={styles.mediaActions}><button className={styles.secondaryButton} type="button" onClick={() => setPreview(result)}>Preview</button><a className={styles.secondaryButton} href={result.url} download rel="noreferrer" target="_blank">Download / open</a></div></div>
                </article>
              ))}</div> : mediaBusy ? <div className={styles.empty}><strong>{mediaProgress || 'Working on your result'}</strong><span>Keep this page open until the workflow responds.</span></div> : (
                <div className={styles.briefPreview}>
                  <div className={styles.previewTopline}><span>LIVE BRIEF PREVIEW</span><span>NOT GENERATED</span></div>
                  <div className={styles.previewCanvas} style={{ '--preview-primary': s.brandTheme?.primary_color || '#f59e0b', '--preview-background': s.brandTheme?.background_color || '#f5f4ef' } as React.CSSProperties}>
                    <span className={styles.previewBrand}>{String(s.profile?.company_name || 'YOUR BRAND').slice(0, 42)}</span>
                    <strong>{mediaPrompt.trim() || 'Your creative direction will take shape here.'}</strong>
                    <span className={styles.previewPrompt}>{needsSourceUrl ? sourceUrl || 'Add a public source URL' : needsSourceImage ? sourceImageUrl || 'Add a source image URL' : 'Add a prompt to shape the result'}</span>
                    <span className={styles.previewBadge}>{mediaAction.replaceAll('_', ' ')} · {aspectRatio}</span>
                  </div>
                  <p className={styles.previewFootnote}>This is a brief preview. Generated media will appear here after the workflow responds.</p>
                </div>
              )}
              {failedMedia && <div className={styles.error} role="status">One item failed. Completed results are kept. <button className={styles.secondaryButton} type="button" onClick={() => void retryMedia()} disabled={mediaBusy}>Retry failed item</button></div>}
            </section>
          </div>
        )}
      </main>

      <Modal
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        label={preview?.type === 'image' ? 'Generated image preview' : 'Generated video preview'}
      >
        {preview?.type === 'image' ? <img className={styles.modalMedia} src={preview.url} alt="Generated image preview" /> : preview ? <video className={styles.modalMedia} src={preview.url} controls autoPlay playsInline /> : null}
      </Modal>
    </div>
  );
}
