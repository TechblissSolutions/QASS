'use client';

import { FormEvent, useEffect, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import AuthScene from '@/components/fx/AuthScene';
import SiteNav from '@/components/SiteNav';
import CountUp from '@/components/fx/CountUp';
import DraftPreview, { draftStats } from './FreeTrialPreview';
import styles from './FreeTrial.module.css';
import { STYLES } from '@/lib/constants';

type Generator = 'linkedin' | 'blog';
type TrialResponseCode = 'TRIAL_TYPE_USED' | 'TRIAL_RESERVATION_CONFLICT' | 'TRIAL_GENERATION_RESERVED';
type Fields = { topic: string; audience: string; companyName: string; companyWebsite: string; companySummary: string; goal: string; tone: string; style: string; extra: string; keywords: string };

const blankFields: Fields = { topic: '', audience: '', companyName: '', companyWebsite: '', companySummary: '', goal: 'Brand / Product Awareness', tone: 'Professional', style: STYLES[0], extra: '', keywords: '' };

const GEN_MESSAGES = ['Reading your brief…', 'Shaping the voice and tone…', 'Drafting your first version…', 'Polishing the final lines…'];

function Check() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"><path className={styles.checkPath} d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function Arrow() {
  return <svg aria-hidden="true" viewBox="0 0 20 20" fill="none"><path d="M4 10h11m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

// Words slide up out of a mask, one after another (CSS only, same as the pricing headline)
function Words({ text, start = 0 }: { text: string; start?: number }) {
  return <>{text.split(' ').map((w, i) => <span className={styles.word} aria-hidden="true" key={i}><span style={{ '--i': start + i } as CSSProperties}>{w}</span></span>)}</>;
}

// Cards tilt in 3D toward the cursor and carry a soft light that follows it (skipped for touch and disabled cards)
const tilt = (e: PointerEvent<HTMLElement>) => {
  if (e.pointerType === 'touch') return;
  const c = e.currentTarget;
  if (c instanceof HTMLButtonElement && c.disabled) return;
  const r = c.getBoundingClientRect();
  const px = (e.clientX - r.left) / r.width;
  const py = (e.clientY - r.top) / r.height;
  c.style.setProperty('--tx', `${((py - 0.5) * -6).toFixed(1)}deg`);
  c.style.setProperty('--ty', `${((px - 0.5) * 8).toFixed(1)}deg`);
  c.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
  c.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
};
const untilt = (e: PointerEvent<HTMLElement>) => {
  for (const k of ['--tx', '--ty', '--mx', '--my']) e.currentTarget.style.removeProperty(k);
};

// Primary buttons lean a little toward the cursor (magnetic pull)
const pull = (e: PointerEvent<HTMLElement>) => {
  if (e.pointerType === 'touch') return;
  const b = e.currentTarget;
  if (b instanceof HTMLButtonElement && b.disabled) return;
  const r = b.getBoundingClientRect();
  b.style.setProperty('--bx', `${((e.clientX - (r.left + r.width / 2)) * 0.12).toFixed(1)}px`);
  b.style.setProperty('--by', `${((e.clientY - (r.top + r.height / 2)) * 0.2).toFixed(1)}px`);
};
const release = (e: PointerEvent<HTMLElement>) => {
  e.currentTarget.style.removeProperty('--bx');
  e.currentTarget.style.removeProperty('--by');
};

export default function FreeTrial() {
  const [active, setActive] = useState<Generator | null>(null);
  const [fields, setFields] = useState<Fields>(blankFields);
  const [integrationMessage, setIntegrationMessage] = useState('');
  const [trialResponseCode, setTrialResponseCode] = useState<TrialResponseCode | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSubmittingLead, setIsSubmittingLead] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState(false);
  const [generatedContent, setGeneratedContent] = useState<{ type: Generator; text: string } | null>(null);
  const [savedGenerations, setSavedGenerations] = useState<Partial<Record<Generator, string>>>({});
  const [leadMessage, setLeadMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [fresh, setFresh] = useState(false);
  const [genTick, setGenTick] = useState(0);
  const [slide, setSlide] = useState<'none' | 'right' | 'left'>('none');
  const [leadSubmitted, setLeadSubmitted] = useState(false);
  const [remainingCredits, setRemainingCredits] = useState(100);
  const [used, setUsed] = useState<Record<Generator, boolean>>({ linkedin: false, blog: false });

  useEffect(() => {
    let current = true;
    void fetch('/api/free-trial/session', { cache: 'no-store' })
      .then(async response => {
        const result = await response.json() as {
          success?: boolean;
          credits_total?: number;
          credits_remaining?: number;
          used?: boolean;
          used_type?: Generator | null;
          linkedin_used?: boolean;
          blog_used?: boolean;
          lead_submitted?: boolean;
          generation?: { type?: Generator; content?: string } | null;
          generations?: Array<{ type?: Generator; content?: string }>;
          error?: string;
        };
        if (!response.ok || result.success !== true) throw new Error(result.error || 'Unable to check your free-trial status.');
        if (!current) return;
        setSessionError(false);
        const usedNow = result.used === true;
        const legacyUsed = usedNow && typeof result.linkedin_used !== 'boolean' && typeof result.blog_used !== 'boolean';
        setUsed({ linkedin: legacyUsed || result.linkedin_used === true, blog: legacyUsed || result.blog_used === true });
        setRemainingCredits(Number(result.credits_remaining ?? result.credits_total ?? 100));
        setLeadSubmitted(result.lead_submitted === true);
        const type = result.generation?.type || result.used_type || null;
        if (type === 'linkedin' || type === 'blog') setActive(type);
        else if (usedNow) setActive('linkedin');
        const saved = Object.fromEntries((result.generations || []).filter(item => (item.type === 'linkedin' || item.type === 'blog') && item.content).map(item => [item.type as Generator, item.content as string])) as Partial<Record<Generator, string>>;
        if (result.generation?.content && (type === 'linkedin' || type === 'blog')) saved[type] ||= result.generation.content;
        setSavedGenerations(saved);
        if (type && saved[type]) setGeneratedContent({ type, text: saved[type]! });
      })
      .catch(error => {
        if (current) {
          setSessionError(true);
          setIntegrationMessage(error instanceof Error ? error.message : 'Unable to check your free-trial status.');
        }
      })
      .finally(() => { if (current) setSessionReady(true); });
    return () => { current = false; };
  }, []);

  // Scroll reveal with depth: only for blocks that start below the fold, so nothing flashes on load
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(entries => {
      for (const en of entries) {
        if (en.isIntersecting) { en.target.setAttribute('data-trial-reveal', 'in'); io.unobserve(en.target); }
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    document.querySelectorAll<HTMLElement>('[data-trial-reveal]').forEach(el => {
      if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return;
      el.setAttribute('data-trial-reveal', 'pending');
      io.observe(el);
    });
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const guard = (e: ClipboardEvent) => {
      const draft = document.getElementById('trial-draft');
      const sel = window.getSelection();
      if (draft && sel && sel.rangeCount > 0 && !sel.isCollapsed && sel.containsNode(draft, true)) {
        e.preventDefault();
        e.clipboardData?.setData('text/plain', '');
      }
    };
    document.addEventListener('copy', guard);
    document.addEventListener('cut', guard);
    return () => { document.removeEventListener('copy', guard); document.removeEventListener('cut', guard); };
  }, []);

  useEffect(() => {
    if (!isGenerating) { setGenTick(0); return; }
    const t = window.setInterval(() => setGenTick(n => n + 1), 2400);
    return () => window.clearInterval(t);
  }, [isGenerating]);

  const chooseGenerator = (generator: Generator) => {
    if ((used[generator] && !savedGenerations[generator]) || !sessionReady) return;
    setSlide(active && active !== generator ? (generator === 'blog' ? 'right' : 'left') : 'none');
    setActive(generator);
    setFresh(false);
    setIntegrationMessage('');
    setLeadMessage('');
    setGeneratedContent(savedGenerations[generator] ? { type: generator, text: savedGenerations[generator]! } : null);
    window.setTimeout(() => document.getElementById('generator-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  };

  const update = (key: keyof Fields, value: string) => setFields(current => ({ ...current, [key]: value }));

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active || isGenerating) return;
    setIsGenerating(true);
    setIntegrationMessage('');
    setTrialResponseCode(null);
    setGeneratedContent(null);
    setCopied(false);
    setFresh(false);
    setSlide('none');
    try {
      const response = await fetch('/api/free-trial/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          generation_type: active,
          topic: fields.topic,
          target_audience: fields.audience,
          company_name: fields.companyName,
          company_website: fields.companyWebsite,
          company_summary: fields.companySummary,
          company_details: fields.extra,
          content_goal: fields.goal,
          brand_tone: fields.tone,
          writing_style: fields.style,
          additional_instructions: fields.extra,
          keywords: active === 'blog' ? fields.keywords : '',
        }),
      });
      let result: { success?: boolean; generation_type?: Generator; content?: string; error?: string; code?: string } = {};
      try {
        result = await response.json();
      } catch {
        if (response.ok) throw new Error('The server returned an unreadable response. Please retry.');
      }

      if (result.code === 'TRIAL_TYPE_USED' || result.code === 'TRIAL_GENERATION_RESERVED') {
        const code = result.code as TrialResponseCode;
        const usedType = result.generation_type === 'blog' ? 'blog' : result.generation_type === 'linkedin' ? 'linkedin' : active;
        setUsed(current => ({ ...current, [usedType]: true }));
        setTrialResponseCode(code);
        if (code === 'TRIAL_GENERATION_RESERVED') {
          setRemainingCredits(current => Math.max(0, current - 50));
          setIntegrationMessage(result.error || 'We could not confirm whether your draft was saved. Refresh the page to check for it; your other trial format may still be available.');
        } else {
          setIntegrationMessage(result.error || `You’ve used your free ${usedType === 'blog' ? 'Blog' : 'LinkedIn'} generation.`);
        }
        return;
      }
      if (result.code === 'TRIAL_RESERVATION_CONFLICT') {
        setTrialResponseCode('TRIAL_RESERVATION_CONFLICT');
        setIntegrationMessage(result.error || 'Another request is using this trial slot. Refresh your status, then retry if the format is still available.');
        return;
      }
      if (!response.ok || result.success !== true || typeof result.content !== 'string' || !result.content.trim()) {
        const message = result.error || (response.status >= 500
          ? 'Sparrow could not complete the generation.'
          : 'Generation did not return content.');
        throw new Error(response.status >= 500 ? `${message} Please retry.` : message);
      }
      const generatedType = result.generation_type === 'blog' ? 'blog' : active;
      setGeneratedContent({ type: generatedType, text: result.content });
      setFresh(true);
      setSavedGenerations(current => ({ ...current, [generatedType]: result.content! }));
      setUsed(current => ({ ...current, [generatedType]: true }));
      setRemainingCredits(current => Math.max(0, current - 50));
      setIntegrationMessage('Your content is ready to preview below.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Generation failed.';
      setIntegrationMessage(/please retry|please try again/i.test(message)
        ? message
        : `${message} Please try again.`);
    } finally {
      setIsGenerating(false);
    }
  }

  async function submitLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmittingLead || leadSubmitted) return;
    const form = new FormData(event.currentTarget);
    setIsSubmittingLead(true);
    setLeadMessage('');
    try {
      const response = await fetch('/api/free-trial/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          name: form.get('name'),
          email: form.get('email'),
          company_name: form.get('company_name'),
          phone: form.get('phone'),
          marketing_consent: form.get('marketing_consent') === 'on',
        }),
      });
      const result = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || result.success !== true) throw new Error(result.error || 'Unable to save your details. Please retry.');
      setLeadSubmitted(true);
      setLeadMessage('Your details were saved. Copy Content is now unlocked.');
    } catch (error) {
      setLeadMessage(error instanceof Error ? error.message : 'Unable to save your details. Please retry.');
    } finally {
      setIsSubmittingLead(false);
    }
  }

  async function copyContent() {
    if (!generatedContent) return;
    try {
      await navigator.clipboard.writeText(generatedContent.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  const title = active === 'linkedin' ? 'LinkedIn Post Generator' : 'Blog Generator';
  const generatedTitle = generatedContent?.type === 'linkedin' ? 'LinkedIn Post' : 'Blog';

  return (
    <main className={styles.page}>
      <AuthScene />
      <i className={styles.spot} aria-hidden="true" />
      <div className={styles.progress} aria-hidden="true" />
      <SiteNav />

      <div className={styles.wrap}>
        <section className={styles.intro} aria-labelledby="trial-title">
          <div className={styles.introCopy}>
            <p className={styles.eyebrow}>Your first draft starts here</p>
            <h1 id="trial-title" aria-label="Create Content with AI."><Words text="Create Content" /><br /><span className={styles.accent}><Words text="with AI." start={2} /></span></h1>
            <p className={styles.lede}>Try Sparrow with 100 free credits. Choose a format, shape your brief, and get a first draft ready to refine.</p>
            <div className={styles.creditStrip} aria-label={`${remainingCredits} of 100 free credits remaining`} onPointerMove={tilt} onPointerLeave={untilt}>
              <span className={styles.creditIcon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 3.5 20 8v8l-8 4.5L4 16V8l8-4.5Z" stroke="currentColor" strokeWidth="1.5"/><path d="m4.5 8.3 7.5 4.2 7.5-4.2M12 12.5v7.7" stroke="currentColor" strokeWidth="1.5"/></svg></span>
              <span><strong><CountUp value={remainingCredits} /> free credits</strong><small>Starting balance · 100 total</small></span>
              <span className={styles.creditMeter}><i style={{ width: `${remainingCredits}%` }} /></span>
            </div>
          </div>
          <div className={styles.introArt} aria-hidden="true">
            <span className={styles.artOrbit} /><span className={styles.artPaper}><i /><i /><i /><b /></span>
            <span className={styles.artStamp}>A good<br />place to<br /><strong>begin.</strong></span>
            <span className={styles.artDot} />
          </div>
        </section>

        <section className={styles.choose} aria-labelledby="choose-title" data-trial-reveal="">
          <div className={styles.sectionHeading}><div><h2 id="choose-title">What would you like to create?</h2><p>Pick a starting point. You can shape the voice and audience in the next step.</p></div><span className={styles.trialTag}>FREE TRIAL</span></div>
          <div className={styles.generatorChoices}>
            <button className={`${styles.choice} ${active === 'linkedin' ? styles.choiceActive : ''}`} onPointerMove={tilt} onPointerLeave={untilt} onClick={() => chooseGenerator('linkedin')} aria-pressed={active === 'linkedin'} disabled={isGenerating || (used.linkedin && !savedGenerations.linkedin) || !sessionReady || sessionError}>
              <span className={`${styles.choiceSymbol} ${styles.linkedinSymbol}`} aria-hidden="true">in</span>
              <span className={styles.choiceText}><strong>LinkedIn Post</strong><small>A clear, engaging post for your professional audience.</small><span className={styles.usage}>{used.linkedin ? 'LinkedIn trial used' : '50 free credits'}</span></span>
              <Arrow />
            </button>
            <button className={`${styles.choice} ${active === 'blog' ? styles.choiceActive : ''}`} onPointerMove={tilt} onPointerLeave={untilt} onClick={() => chooseGenerator('blog')} aria-pressed={active === 'blog'} disabled={isGenerating || (used.blog && !savedGenerations.blog) || !sessionReady || sessionError}>
              <span className={`${styles.choiceSymbol} ${styles.blogSymbol}`} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M5 4.75h14v14.5H5zM8 8h8M8 11h8M8 14h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
              <span className={styles.choiceText}><strong>Blog</strong><small>Build a useful article around your topic and keywords.</small><span className={styles.usage}>{used.blog ? 'Blog trial used' : '50 free credits'}</span></span>
              <Arrow />
            </button>
          </div>
          <div className={styles.rail} data-pos={active ?? 'none'} aria-hidden="true"><i /></div>
          <p className={styles.limitNote}>One LinkedIn post and one Blog article are included. Sign up to generate more or explore other Sparrow features.</p>
          {!sessionReady && <p className={styles.loadingMessage} role="status"><span className={styles.spinner} aria-hidden="true" /><span>Checking your trial status…</span></p>}
          {sessionReady && integrationMessage && !active && <p className={styles.notice} role="alert">{integrationMessage}</p>}
        </section>

        {active && <section key={`generator-${active}`} className={`${styles.generator}${isGenerating ? ` ${styles.busy}` : ''}${slide === 'right' ? ` ${styles.slideR}` : slide === 'left' ? ` ${styles.slideL}` : ''}`} id="generator-form" aria-labelledby="generator-title">
          <div className={styles.formHead}><div><p className={styles.eyebrow}>Your brief</p><h2 id="generator-title">{title}</h2><p>Give Sparrow a little context to guide the first draft.</p></div></div>
          {used[active] && !generatedContent ? <div className={styles.notice} role="status"><p>{integrationMessage || `You’ve used your free ${active === 'blog' ? 'Blog' : 'LinkedIn'} generation.`}</p>{trialResponseCode !== 'TRIAL_GENERATION_RESERVED' && <a href="/signup">Sign up to generate more and explore other features.</a>}</div> : !used[active] && <form className={styles.form} onSubmit={generate}>
            <label className={styles.field}><span>{active === 'blog' ? 'Blog topic or title' : 'Topic'} <b>*</b></span><input required maxLength={300} value={fields.topic} onChange={e => update('topic', e.target.value)} placeholder={active === 'blog' ? 'e.g. A practical guide to customer onboarding' : 'e.g. What makes a great customer experience'} /></label>
            <label className={styles.field}><span>Target audience <b>*</b></span><input required maxLength={200} value={fields.audience} onChange={e => update('audience', e.target.value)} placeholder="Who should this speak to?" /></label>
            <label className={styles.field}><span>Company or brand <small>Optional</small></span><input maxLength={200} value={fields.companyName} onChange={e => update('companyName', e.target.value)} placeholder="Your company name" /></label>
            <label className={styles.field}><span>Company website <small>Optional</small></span><input type="url" maxLength={500} value={fields.companyWebsite} onChange={e => update('companyWebsite', e.target.value)} placeholder="https://example.com" /></label>
            <label className={`${styles.field} ${styles.fullField}`}><span>What your company offers <small>Optional</small></span><textarea maxLength={1200} value={fields.companySummary} onChange={e => update('companySummary', e.target.value)} placeholder="Describe your product, service, brand or useful company facts." rows={3} /></label>
            {active === 'blog' && <label className={styles.field}><span>Keywords</span><input maxLength={300} value={fields.keywords} onChange={e => update('keywords', e.target.value)} placeholder="Add keywords, separated by commas" /></label>}
            <label className={styles.field}><span>Content goal</span><select value={fields.goal} onChange={e => update('goal', e.target.value)}><option>Brand / Product Awareness</option><option>Engagement</option></select></label>
            <label className={styles.field}><span>Brand tone</span><select value={fields.tone} onChange={e => update('tone', e.target.value)}><option>Professional</option><option>Friendly</option></select></label>
            <label className={styles.field}><span>Writing style</span><select value={fields.style} onChange={e => update('style', e.target.value)}>{STYLES.map(style => <option key={style}>{style}</option>)}</select></label>
            <label className={`${styles.field} ${styles.fullField}`}><span>Additional instructions <small>Optional</small></span><textarea maxLength={1200} value={fields.extra} onChange={e => update('extra', e.target.value)} placeholder="Anything else Sparrow should keep in mind?" rows={3} /></label>
            <div className={`${styles.formActions} ${styles.fullField}`}><p>Your trial balance is shown in credits.</p><button className={styles.primaryButton} type="submit" disabled={isGenerating || sessionError} onPointerMove={pull} onPointerLeave={release}>{isGenerating ? <><span className={styles.spinner} aria-hidden="true" />Generating…</> : <>Generate {active === 'blog' ? 'Blog' : 'LinkedIn Post'} <Arrow /></>}</button></div>
            {isGenerating && <span className={`${styles.genBar} ${styles.fullField}`} aria-hidden="true"><i /></span>}
            {isGenerating && <p className={`${styles.loadingMessage} ${styles.fullField}`} role="status" aria-live="off"><span className={styles.spinner} aria-hidden="true" /><span key={genTick % GEN_MESSAGES.length} className={styles.genText}>{GEN_MESSAGES[genTick % GEN_MESSAGES.length]}</span></p>}
            {integrationMessage && <p className={`${styles.notice} ${styles.fullField}`} role={generatedContent ? 'status' : 'alert'}>{integrationMessage}</p>}
          </form>}
        </section>}

        {generatedContent && (() => {
          const stats = draftStats(generatedContent.text, generatedContent.type);
          return <section key={`result-${generatedContent.type}`} className={`${styles.result}${slide === 'right' ? ` ${styles.slideR}` : slide === 'left' ? ` ${styles.slideL}` : ''}`} aria-labelledby="result-title">
          <div className={styles.resultHero}>
            <span className={styles.doneBadge} aria-hidden="true"><Check /></span>
            <div className={styles.resultCopy}><p className={styles.eyebrow}>Your first draft</p><h2 id="result-title">Your {generatedTitle} is ready</h2><p className={styles.resultSub}>Nicely done. Read it through below, then unlock copying whenever you’re ready.</p></div>
            <button className={`${styles.lockedButton} ${copied ? styles.copied : leadSubmitted ? styles.unlocked : ''}`} type="button" disabled={!leadSubmitted} onClick={copyContent} title="Copy unlocks after a successful lead submission">{copied ? 'Copied' : leadSubmitted ? 'Copy Content' : 'Copy Content · Locked'}</button>
          </div>
          <ol className={styles.steps} aria-label="Your progress">
            <li className={styles.stepDone}><span><Check /></span>Draft ready</li>
            <li className={leadSubmitted ? styles.stepDone : styles.stepNow}><span>{leadSubmitted ? <Check /> : '2'}</span>Share your details</li>
            <li className={copied ? styles.stepDone : leadSubmitted ? styles.stepNow : ''}><span>{copied ? <Check /> : '3'}</span>Copy and publish</li>
          </ol>
          <div className={styles.chips}><span>{generatedTitle}</span><span>{stats.words.toLocaleString()} words</span><span>{generatedContent.type === 'blog' ? `${stats.minutes} min read` : `${stats.chars.toLocaleString()} characters`}</span></div>
          <div className={styles.draft} id="trial-draft" onCopy={e => e.preventDefault()} onCut={e => e.preventDefault()} onContextMenu={e => e.preventDefault()} onDragStart={e => e.preventDefault()}><DraftPreview key={generatedContent.type} type={generatedContent.type} text={generatedContent.text} company={fields.companyName} animate={fresh} /></div>
          <p className={styles.copyHint}>{leadSubmitted ? 'Use the Copy Content button to copy this draft.' : 'Selecting text is turned off. Unlock the Copy Content button to copy this draft.'}</p>
          {leadSubmitted ? <div className={styles.unlockedBar} role="status">
            <span className={styles.okIcon} aria-hidden="true"><Check /></span>
            <div className={styles.unlockedText}><strong>You’re all set</strong><p>{leadMessage || 'Your details are saved. Copy Content is unlocked.'}</p></div>
            <div className={styles.unlockedActions}>
              <button className={`${styles.primaryButton} ${copied ? styles.copied : ''}`} type="button" onClick={copyContent} onPointerMove={pull} onPointerLeave={release}>{copied ? 'Copied' : 'Copy Content'}</button>
              <a className={styles.nextLink} href="/signup">Create a free account <Arrow /></a>
            </div>
          </div> : <form className={styles.leadForm} onSubmit={submitLead}>
            <div className={styles.leadHead}><span className={styles.lockIcon} aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M7 10.5V8a5 5 0 0 1 10 0v2.5M6 10.5h12v9H6z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg></span><div><h3>Unlock Copy Content</h3><p>Share a few details and copying unlocks right away. Your draft stays on screen either way.</p></div></div>
            <div className={styles.leadGrid}><label className={styles.field}><span>Full name <b>*</b></span><input name="name" required autoComplete="name" disabled={isSubmittingLead} /></label><label className={styles.field}><span>Work email <b>*</b></span><input name="email" type="email" required autoComplete="email" disabled={isSubmittingLead} /></label><label className={styles.field}><span>Company name <b>*</b></span><input name="company_name" required autoComplete="organization" disabled={isSubmittingLead} /></label><label className={styles.field}><span>Phone number <small>Optional</small></span><input name="phone" type="tel" autoComplete="tel" disabled={isSubmittingLead} /></label></div>
            <label className={styles.consent}><input name="marketing_consent" type="checkbox" disabled={isSubmittingLead} /><span>I’d like to receive product updates and marketing emails. Optional; you can still unlock your content without opting in.</span></label>
            <p className={styles.privacy}>Your details are intended to help us provide this trial. A privacy policy link will appear here once one is available in the project.</p>
            <button className={styles.primaryButton} type="submit" disabled={isSubmittingLead} onPointerMove={pull} onPointerLeave={release}>{isSubmittingLead ? <><span className={styles.spinner} aria-hidden="true" />Saving details…</> : <>Unlock and copy <Arrow /></>}</button>{leadMessage && <p className={styles.notice} role="alert">{leadMessage}</p>}
          </form>}
        </section>;
        })()}
        <footer className={styles.footer} data-trial-reveal=""><span>SPARROW</span><span>100 trial credits · One LinkedIn draft · One Blog draft</span></footer>
      </div>
    </main>
  );
}
