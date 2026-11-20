'use client';

import CountUp from '@/components/fx/CountUp';
import { cleanGeneratedHtml, cleanGeneratedText, cleanPublishedHtml } from '@/lib/content-cleanup';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useRouter } from 'next/navigation';

import { useStore } from '@/lib/store';

import { getAccessToken } from '@/lib/auth';

import { persistJobState } from '@/lib/job-persistence';

import { useToast } from '@/components/Toast';

import { SEC_META, GIVE_UP_MS, colorFor, PLATFORMS, STYLES } from '@/lib/constants';

import { fmtDate, fmtTime, sanitizeHtml } from '@/lib/utils';

import { parseLiveViewHtml, splitIntoCards } from '@/lib/parser';

import Modal from '@/components/Modal';


import Chip from '@/components/Chip';

import BrandTheme from '@/components/BrandTheme';

import type { JobRow } from '@/lib/supabase';
import type { Piece, Prefs, BrandTheme as BrandThemeType } from '@/lib/types';

import StoreLoading from '@/components/StoreLoading';

import CompanyHeader from '@/components/CompanyHeader';

import SmartLogo from '@/components/SmartLogo';
import { verifiedCompanyLogo, withVerifiedCompanyLogo } from '@/lib/brand-client';
import ScheduleComposer from '@/components/ScheduleComposer';

import { getJob, getJobByExternalId, listAllJobs } from '@/lib/supabase';

type GenerationQueueItem = {
  id: string;
  projectId: string;
  prefs: Prefs;
  status: 'queued' | 'starting' | 'running' | 'completed' | 'failed' | 'cancelled';
  jobId?: string;
  rowId?: string;
  sections?: Record<string, Piece[]>;
  error?: string;
};

type LibraryPiece = Piece & {
  sourceJobId: string | null;
  sourcePieceId: string;
};

function isGenerationSections(value: unknown): value is Record<string, Piece[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every(section => Array.isArray(section)
    && section.every(piece => Boolean(piece && typeof piece === 'object'
      && typeof (piece as Record<string, unknown>).id === 'string'
      && typeof (piece as Record<string, unknown>).section === 'string'
      && typeof (piece as Record<string, unknown>).channel === 'string'
      && typeof (piece as Record<string, unknown>).format === 'string'
      && typeof (piece as Record<string, unknown>).title === 'string'
      && typeof (piece as Record<string, unknown>).bodyHtml === 'string'
      && typeof (piece as Record<string, unknown>).bodyText === 'string'
      && typeof (piece as Record<string, unknown>).wordCount === 'number')));
}

function channelFilterKey(value: string) {
  const channel = value.toLowerCase().replace(/x\/twitter/g, 'twitter').replace(/x\//g, '').replace(/\s+/g, ' ').trim();
  if (channel.includes('blog') || channel.includes('video')) return 'blogs';
  if (channel === 'x' || channel.includes('twitter')) return 'twitter';
  if (channel.includes('linkedin')) return 'linkedin';
  if (channel.includes('facebook')) return 'facebook';
  if (channel.includes('instagram')) return 'instagram';
  if (channel.includes('youtube')) return 'youtube';
  if (channel.includes('ads') || channel.includes('messag')) return 'ads';
  if (channel === 'web' || channel.includes('website')) return 'website';
  return channel;
}

function matchesChannelFilter(piece: Piece, filter: string) {
  const key = channelFilterKey(filter);
  return key === 'blogs'
    ? piece.section === 'blogs' || channelFilterKey(piece.channel) === 'blogs'
    : channelFilterKey(piece.channel) === key;
}

function normalizeLibrarySections(value: unknown): Record<string, Piece[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([section, raw]) => {
    if (!Array.isArray(raw)) return [];
    const pieces = raw.flatMap((item, index) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const source = item as Record<string, unknown>;
      const bodyHtml = typeof source.bodyHtml === 'string' ? source.bodyHtml : '';
      const bodyText = typeof source.bodyText === 'string' && source.bodyText.trim()
        ? source.bodyText
        : cleanGeneratedText(bodyHtml);
      if (!bodyHtml.trim() && !bodyText.trim()) return [];
      const channel = typeof source.channel === 'string' && source.channel.trim()
        ? source.channel
        : section === 'blogs' ? 'Blog & video' : section === 'ads' ? 'Ads & messaging' : section === 'website' ? 'Website' : 'Social';
      const normalized:Piece={
        id: typeof source.id === 'string' ? source.id : `${section}-${index + 1}`,
        section: typeof source.section === 'string' ? source.section : section,
        channel,
        format: typeof source.format === 'string' ? source.format : section,
        title: typeof source.title === 'string' && source.title.trim() ? source.title : 'Generated content',
        bodyHtml: bodyHtml || bodyText,
        bodyText,
        wordCount: typeof source.wordCount === 'number' && Number.isFinite(source.wordCount)
          ? source.wordCount
          : bodyText.split(/\s+/).filter(Boolean).length,
        mediaUrl:typeof source.mediaUrl==='string'?source.mediaUrl:undefined,
        mediaType:source.mediaType==='image'||source.mediaType==='video'||source.mediaType==='pdf'||source.mediaType==='text'?source.mediaType:undefined,
        mediaPrompt:typeof source.mediaPrompt==='string'?source.mediaPrompt:undefined,
        aspectRatio:typeof source.aspectRatio==='string'?source.aspectRatio:undefined,
        mediaDuration:typeof source.mediaDuration==='number'?source.mediaDuration:undefined,
        mediaSceneCount:typeof source.mediaSceneCount==='number'?source.mediaSceneCount:undefined,
        mediaSceneTimings:Array.isArray(source.mediaSceneTimings)
          ?source.mediaSceneTimings.filter((timing):timing is {scene:number;start:number;end:number}=>Boolean(timing&&typeof timing==='object'
            &&typeof (timing as Record<string,unknown>).scene==='number'
            &&typeof (timing as Record<string,unknown>).start==='number'
            &&typeof (timing as Record<string,unknown>).end==='number'))
          :undefined,
      };
      return [normalized];
    });
    const channel = section === 'blogs'
      ? 'Blog & video'
      : section === 'website'
        ? 'Website'
        : section === 'ads'
          ? 'Ads & Messages'
          : null;
    return pieces.length
      ? [[section, pieces.map(piece => ({ ...piece, section, channel: channel || piece.channel }))]]
      : [];
  }));
}

function isGenerationQueueItem(value: unknown): value is GenerationQueueItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  const prefs = item.prefs;
  const validPrefs = Boolean(prefs && typeof prefs === 'object'
    && Array.isArray((prefs as Record<string, unknown>).platforms)
    && ((prefs as Record<string, unknown>).platforms as unknown[]).every(platform=>typeof platform==='string')
    && typeof (prefs as Record<string, unknown>).goal === 'string'
    && typeof (prefs as Record<string, unknown>).tone === 'string'
    && typeof (prefs as Record<string, unknown>).style === 'string'
    && typeof (prefs as Record<string, unknown>).extra === 'string');
  return typeof item.id === 'string'
    && typeof item.projectId === 'string'
    && validPrefs
    && (item.jobId===undefined||typeof item.jobId==='string')
    && (item.rowId===undefined||typeof item.rowId==='string')
    && (item.sections===undefined||isGenerationSections(item.sections))
    && (item.error===undefined||typeof item.error==='string')
    && ['queued', 'starting', 'running', 'completed', 'failed', 'cancelled'].includes(String(item.status));
}



function PlatformIcon({ channel }: { channel: string }) {
  const ch = channel.toLowerCase();
  const kind = ch === 'all'
    ? 'all'
    : ch.includes('instagram') ? 'instagram'
      : ch.includes('facebook') ? 'facebook'
        : ch.includes('linkedin') ? 'linkedin'
          : ch.includes('twitter') || ch.includes('x/') ? 'twitter'
            : ch.includes('youtube') ? 'youtube'
              : ch.includes('website') || ch.includes('seo') ? 'website'
                : ch.includes('ads') || ch.includes('email') || ch.includes('whatsapp') ? 'message'
                  : ch.includes('blog') || ch.includes('video') ? 'article'
                    : 'all';

  return <span className={`platform-icon-wrap ${kind}`} aria-hidden="true">
    <svg viewBox="0 0 20 20" fill="none">
      {kind === 'all' && <><rect x="3" y="3" width="5" height="5" rx="1"/><rect x="12" y="3" width="5" height="5" rx="1"/><rect x="3" y="12" width="5" height="5" rx="1"/><rect x="12" y="12" width="5" height="5" rx="1"/></>}
      {kind === 'website' && <><circle cx="10" cy="10" r="7"/><path d="M3.5 10h13M10 3c2 2 3 4.3 3 7s-1 5-3 7c-2-2-3-4.3-3-7s1-5 3-7Z"/></>}
      {kind === 'message' && <><rect x="3" y="4" width="14" height="12" rx="2"/><path d="m4 6 6 5 6-5"/></>}
      {kind === 'article' && <><rect x="4" y="2.5" width="12" height="15" rx="2"/><path d="M7 7h6M7 10h6M7 13h4"/></>}
      {kind === 'youtube' && <><rect x="2.5" y="5" width="15" height="10" rx="3"/><path d="m8.5 7.5 4.5 2.5-4.5 2.5v-5Z" fill="currentColor" stroke="none"/></>}
      {kind === 'instagram' && <><rect x="3" y="3" width="14" height="14" rx="4"/><circle cx="10" cy="10" r="3.2"/><circle cx="14.5" cy="5.7" r=".8" fill="currentColor" stroke="none"/></>}
      {kind === 'facebook' && <path d="M11.5 17v-6h2l.4-2.4h-2.4V7.1c0-.7.2-1.2 1.2-1.2H14V3.8c-.6-.1-1.2-.1-1.9-.1-2 0-3.3 1.2-3.3 3.4v1.5H7v2.4h1.8v6h2.7Z" fill="currentColor" stroke="none"/>}
      {kind === 'linkedin' && <><path d="M5 8v8M5 5.2v.1M9 16v-4.5a2.5 2.5 0 0 1 5 0V16M9 9v7"/><circle cx="5" cy="5" r=".8" fill="currentColor" stroke="none"/></>}
      {kind === 'twitter' && <path d="m4 4 12 12M16 4 4 16M5 4h3l7 12h-3L5 4Z"/>}
    </svg>
  </span>;

}

function platformDisplayName(channel: string) {
  const value = String(channel || '').trim().toLowerCase();
  if (value === 'ig' || value === 'instagram') return 'Instagram';
  if (value === 'fb' || value === 'facebook') return 'Facebook';
  if (value === 'in' || value === 'linkedin') return 'LinkedIn';
  if (value === 'x' || value === 'twitter' || value === 'x/twitter' || value === 'x / twitter') return 'X / Twitter';
  if (value === 'yt' || value === 'youtube') return 'YouTube';
  if (value === 'bl' || value === 'blog' || value === 'blog & video') return 'Blog & video';
  if (value === 'ads' || value === 'ads & messaging') return 'Ads & messaging';
  if (value === 'web' || value === 'website') return 'Website';
  return String(channel || '').trim();
}

function cleanVisibleContent(html: string, section?: string) {
  const content = String(html || '')
    .replace(
      /<(p|div)[^>]*>\s*Blog\s*image\s*<\/\1>/gi,
      ''
    )
    .replace(
      /<(p|div)[^>]*>\s*Generate\s+one\s+branded\s+visual\s+for\s+this\s+position\.?\s*<\/\1>/gi,
      ''
    )
    .trim();
  return section === 'blogs' ? content : cleanPublishedHtml(content);
}

function mediaSpec(piece: Piece) {

  const raw = cleanGeneratedText(String(piece.bodyText || ''));

  const type =
  piece.section === 'blogs'
    ? 'image'
    : piece.mediaType ||
      (/MEDIA_TYPE\s*[:\-]\s*VIDEO/i.test(raw)
        ? 'video'
        : /MEDIA_TYPE\s*[:\-]\s*IMAGE/i.test(raw)
          ? 'image'
          : 'text');
  if (type === 'text' || type === 'pdf') return null;

  const prompt = piece.mediaPrompt || raw.match(/AI\s+(?:IMAGE|VIDEO)(?:-GENERATION)?\s+PROMPT\s*[:\-]\s*([\s\S]*?)(?=\s*(?:CONTENT_FORMAT|MEDIA_TYPE|CONTENT_ANGLE|MEDIA_DURATION_SECONDS|MEDIA_SCENE_COUNT|SCENE_TIMINGS)\s*[:\-]|$)/i)?.[1]?.trim() || raw.slice(0, 2500);

  const ratio = piece.aspectRatio || raw.match(/(?:aspect[_ -]?ratio|ratio)\s*[:\-]\s*([0-9]+:[0-9]+)/i)?.[1] || (type === 'video' ? '9:16' : '1:1');

  const duration = piece.mediaDuration || Number(raw.match(/MEDIA_DURATION_SECONDS\s*[:\-]\s*(\d+)/i)?.[1] || 0);

  const sceneCount = piece.mediaSceneCount || Number(raw.match(/MEDIA_SCENE_COUNT\s*[:\-]\s*(\d+)/i)?.[1] || 0);

  const sceneTimings = piece.mediaSceneTimings?.length ? piece.mediaSceneTimings : [...raw.matchAll(/Scene\s*(\d+)\s*[:\-]\s*(\d+(?:\.\d+)?)\s*[-–—]\s*(\d+(?:\.\d+)?)/gi)]

    .map(m => ({ scene: Number(m[1]), start: Number(m[2]), end: Number(m[3]) }));

  return { type, prompt: prompt.slice(0, 8000), ratio, duration, sceneCount, sceneTimings };

}



function safeHex(value: unknown, fallback: string) {

  const v = String(value || '').trim();

  return /^#[0-9a-f]{6}$/i.test(v) ? v : fallback;

}

function contrastInk(color: string) {
  const hex = safeHex(color, '#ffffff').slice(1);
  const channels = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = (value: number) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  const luminance = 0.2126 * linear(channels[0]) + 0.7152 * linear(channels[1]) + 0.0722 * linear(channels[2]);
  return luminance > 0.179 ? '#111827' : '#ffffff';
}


function previewImageData(title: string, company: string, primary: string, background: string) {

  const esc = (v: string) => v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  const t = esc(title.slice(0, 58));

  const c = esc(company.slice(0, 42));

  const readableBackgroundInk = contrastInk(background);
  const readablePrimaryInk = contrastInk(primary);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><rect width="1200" height="675" fill="${background}"/><circle cx="1030" cy="110" r="210" fill="${primary}" opacity=".13"/><circle cx="150" cy="620" r="250" fill="${primary}" opacity=".09"/><rect x="70" y="70" width="1060" height="535" rx="34" fill="none" stroke="${primary}" stroke-width="3" opacity=".35"/><text x="100" y="145" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="${readablePrimaryInk}">${c}</text><text x="100" y="315" font-family="Arial,sans-serif" font-size="54" font-weight="800" fill="${readableBackgroundInk}">${t}</text><text x="100" y="560" font-family="Arial,sans-serif" font-size="20" fill="${readablePrimaryInk}">Preview image · Generate the final visual to replace this preview</text></svg>`;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;

}



function mediaDisplayUrl(url: string) {

  const raw = String(url || '').trim();

  if (!/^https?:\/\//i.test(raw)) return raw;

  return `/api/media-proxy?url=${encodeURIComponent(raw)}`;

}



function SocialMock({
  piece, company, logo, media, brandTheme, onGenerate, busy, expanded = false,
}: {
  piece: Piece; company: string; logo?: string; media?: { url?: string; type?: string; error?: string }; brandTheme?: Partial<BrandThemeType>;
  onGenerate: () => void; busy: boolean; expanded?: boolean;

}) {

  const initials = company.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'SP';

  const caption = piece.bodyText.slice(0, 180);

  const isVideo = media?.type === 'video' || piece.mediaType === 'video';

  const canGenerate = Boolean(mediaSpec(piece));

  return <div className={'social-mock' + (expanded ? ' social-mock-expanded' : '')}>

    <div className="mock-header">

      <span className="mock-avatar">{logo ? <SmartLogo src={'/api/brand-logo?src=' + encodeURIComponent(logo)} alt={company} fallback={initials} /> : initials}</span>

      <span>

        <span className="mock-name">{company || 'Your brand'}</span>

        <span className="mock-handle">{piece.channel}{piece.format ? ' · ' + piece.format : ''}</span>

      </span>

    </div>

    <div className={'mock-visual real-media-preview' + (media?.url ? ' has-media' : '')}>

      {media?.url ? (

        isVideo

          ? <video src={mediaDisplayUrl(media.url)} controls playsInline preload="metadata" onError={(event) => {

            const el = event.currentTarget;

            if (el.dataset.directFallback !== '1' && /^https?:\/\//i.test(media.url || '')) {

              el.dataset.directFallback = '1';

              el.src = media.url || '';

              el.load();

            } else {

              el.style.display = 'none';

              const wrap = el.parentElement;

              if (wrap && !wrap.querySelector('.media-fallback-error')) {

                const msg = document.createElement('div'); msg.className = 'media-fallback-error'; msg.textContent = 'Preview unavailable · Generate final visual'; wrap.appendChild(msg);

              }

            }

          }} />

          : <img src={mediaDisplayUrl(media.url)} alt={piece.title} loading="eager" referrerPolicy="no-referrer" onError={(event) => {

            const el = event.currentTarget;

            if (el.dataset.directFallback !== '1' && /^https?:\/\//i.test(media.url || '')) {

              el.dataset.directFallback = '1';

              el.src = media.url || '';

            } else {

              el.style.display = 'none';

              const wrap = el.parentElement;

              if (wrap && !wrap.querySelector('.media-fallback-error')) { const msg = document.createElement('div'); msg.className = 'media-fallback-error'; msg.textContent = 'Preview unavailable · Generate final visual'; wrap.appendChild(msg); }

            }

          }} />

      ) : (

        <div className="preview-image-wrap">

          <img className="preview-image" src={previewImageData(piece.title, company, safeHex(brandTheme?.primary_color, '#2563eb'), safeHex(brandTheme?.background_color, '#f8fafc'))} alt="Post preview image" />

          <div className="preview-image-overlay">

            <span>{media?.error || (canGenerate ? 'Preview image' : 'Text-only content')}</span>

            {canGenerate && <button type="button" className="media-generate-button" onClick={onGenerate} disabled={busy}>{busy ? 'Generating…' : 'Generate final visual'}</button>}

          </div>

        </div>

      )}

    </div>

    <div className="mock-caption">{caption}{piece.bodyText.length > 180 ? '…' : ''}</div>

    <div className="mock-actions">

      {piece.channel.toLowerCase().includes('youtube')

        ? <><span>Like</span><span>Share</span><span>Save</span></>

        : <><span>♡ Like</span><span>💬 Comment</span><span>↗ Share</span></>

      }

    </div>

  </div>;

}

function ExpandableCardBody({ piece, onExpand }: { piece: Piece; onExpand: () => void }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const measure = () => setOverflowing(body.scrollHeight > body.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, [piece.bodyHtml, piece.bodyText]);

  return <div className="library-piece-body-wrap">
    <div
      ref={bodyRef}
      className="piece-body library-piece-body"
      dangerouslySetInnerHTML={{__html:sanitizeHtml(cleanVisibleContent(piece.bodyHtml||piece.bodyText, piece.section))}}
    />
    {overflowing && <button type="button" className="btn btn-ghost btn-sm library-expand-button" onClick={onExpand} aria-label={`Expand ${piece.title}`}>
      Expand
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
      </svg>
    </button>}
  </div>;
}



function sectionsFromN8nResponse(data: any): Record<string, Piece[]> {

  const raw = typeof data?.html === 'string' ? data.html : typeof data?.content === 'string' ? data.content : '';

  if (!raw || /^https?:\/\/+/i.test(raw.trim())) return {};

  // The submit response is n8n's "Generating Content Package" placeholder page (four iframes),

  // not content. Treating it as content created junk cards and marked Website as loaded, so

  // polling never replaced it. Only accept HTML that really contains generated cards.

  if (/Generating Content Package|class=["']result-card|Updates automatically|ai-company-content-live-view/i.test(raw)) return {};

  if (!/media-card|output-field|platform-stack|platform-block|formatted-content|content-card/i.test(raw)) return {};

  const parsed = parseLiveViewHtml(raw);

  if (!parsed) return {};

  const all = splitIntoCards(parsed, 'generated', 'Generated');

  if (!all.length) return {};

  const out: Record<string, Piece[]> = {};

  const socialNames = ['instagram', 'facebook', 'linkedin', 'twitter', 'x/twitter', 'youtube'];

  all.forEach((card, index) => {

    const channel = card.channel.toLowerCase();

    let section = 'website';

    if (socialNames.some(name => channel.includes(name))) section = 'social';

    else if (channel.includes('ad') || channel.includes('message') || channel.includes('email') || channel.includes('whatsapp') || channel.includes('sms') || channel.includes('follow-up') || channel.includes('follow up')) section = 'ads';

    else if (channel.includes('blog') || channel.includes('video')) section = 'blogs';

    const normalized = {
      ...card,
      id: card.id || `generated-${section}-${index + 1}`,
      section,
      channel: section === 'blogs' ? 'Blog & video' : section === 'ads' ? 'Ads & Messages' : card.channel,
    } as Piece;

    (out[section] ||= []).push(normalized);

  });

  return out;

}



export default function StudioWorkspace({ libraryMode = false }: { libraryMode?: boolean }) {

  const {s,set,pieces,piece,ready,loadProjectJob,loadProject}=useStore();const router=useRouter();const toast=useToast();

  const[filter,setFilter]=useState('all');const[studioPlatforms,setStudioPlatforms]=useState<string[]>([]);const[studioGoal,setStudioGoal]=useState('');const[studioTone,setStudioTone]=useState('');const[studioStyle,setStudioStyle]=useState('');const[studioExtra,setStudioExtra]=useState('');const[generateBusy,setGenerateBusy]=useState(false);const[search,setSearch]=useState('');const[pollError,setPollError]=useState('');const[pollErrorCount,setPollErrorCount]=useState(0);const[retryBusy,setRetryBusy]=useState(false);
  const[generationQueue,setGenerationQueue]=useState<GenerationQueueItem[]>([]);
  const[queueLoadedProject,setQueueLoadedProject]=useState<string|null>(null);
  const[queueStorageError,setQueueStorageError]=useState('');
  const[libraryJobData,setLibraryJobData]=useState<{projectId:string;jobs:JobRow[]}|null>(null);
  const[libraryLoading,setLibraryLoading]=useState(false);
  const[libraryError,setLibraryError]=useState('');
  const queueLaunchRef=useRef(false);

  const[viewId,setViewId]=useState<string|null>(null);

const [editId,setEditId]=useState<string|null>(null);
const [editTitle,setEditTitle]=useState('');
const [editHtml,setEditHtml]=useState('');

const[schedId,setSchedId]=useState<string|null>(null);
const[scheduleTarget,setScheduleTarget]=useState<LibraryPiece|null>(null);

  const [cancelBusy,setCancelBusy]=useState(false);const[regenerateBusy,setRegenerateBusy]=useState(false);const[canRegenerate,setCanRegenerate]=useState(false);const[showUpgrade,setShowUpgrade]=useState(false);

  const [mediaState,setMediaState]=useState<Record<string,{url?:string;type?:string;error?:string;busy?:boolean}>>({});

const openSched = (id: string) => { setSchedId(id); };
const copyPiece = async (item: Piece) => {
  try {
    const text = [item.title.trim(), item.bodyText.trim()].filter(Boolean).join('\n\n');
    await navigator.clipboard.writeText(text);
    toast('Content copied');
  } catch {
    toast('Copy failed. Please select and copy the text manually.');
  }
};

  useEffect(()=>{
    if(libraryMode||typeof window==='undefined')return;
    if(new URLSearchParams(window.location.search).get('view')==='generation'){
      router.replace(`/library?project=${encodeURIComponent(s.projectId||'')}`);
    }
  },[libraryMode,router,s.projectId]);

  const showLibrary=()=>router.push(`/library?project=${encodeURIComponent(s.projectId||'')}`);

  useEffect(()=>{
    if(!s.projectId){
      setQueueLoadedProject(null);
      setGenerationQueue([]);
      return;
    }

    setQueueLoadedProject(null);
    try{
      const saved=window.sessionStorage.getItem(`sparrow-generation-queue:${s.projectId}`);
      const parsed:unknown=saved?JSON.parse(saved):[];
      if(!Array.isArray(parsed)||!parsed.every(isGenerationQueueItem)){
        throw new Error('Saved queue data is invalid.');
      }
      setGenerationQueue(parsed.filter(item=>item.projectId===s.projectId).map(item=>item.status==='starting'?{...item,status:'queued'}:item));
      setQueueStorageError('');
    }catch{
      setGenerationQueue([]);
      setQueueStorageError('Queued requests could not be restored. Create them again from the content brief.');
    }
    setQueueLoadedProject(s.projectId);
  },[s.projectId]);

  useEffect(()=>{
    if(!s.projectId||queueLoadedProject!==s.projectId)return;
    try{
      window.sessionStorage.setItem(`sparrow-generation-queue:${s.projectId}`,JSON.stringify(generationQueue));
      setQueueStorageError(current=>current==='Queued requests may be lost if you leave or reload this tab.'?'':current);
    }catch{
      setQueueStorageError('Queued requests may be lost if you leave or reload this tab.');
    }
  },[generationQueue,queueLoadedProject,s.projectId]);

  useEffect(()=>{
    if(!libraryMode||!ready||!s.projectId)return;
    let active=true;
    setLibraryLoading(true);
    setLibraryError('');
    void (async()=>{
      try{
        const token=await getAccessToken();
        if(!token)throw new Error('Sign in to load this content library.');
        const jobs=await listAllJobs(s.projectId!,token);
        if(active)setLibraryJobData({projectId:s.projectId!,jobs});
      }catch(error){
        if(active)setLibraryError(error instanceof Error?error.message:'Unable to load generated content.');
      }finally{
        if(active)setLibraryLoading(false);
      }
    })();
    return()=>{active=false;};
  },[libraryMode,ready,s.projectId,s.jobRowId]);



  useEffect(()=>{ if(s.projectId){ setStudioPlatforms([]); setStudioGoal(''); setStudioTone(''); setStudioStyle(''); setStudioExtra(''); } },[s.projectId]);



  useEffect(()=>{

    if(!ready||typeof window==='undefined') return;

    let active=true;

    void (async()=>{

      try {
        const token=await getAccessToken();

        if(!active)return;

        if(!token){ router.replace('/login?redirect='+encodeURIComponent(window.location.pathname+window.location.search)); return; }

        const params=new URLSearchParams(window.location.search); const projectId=params.get('project'); const jobId=params.get('job');

        if(projectId && jobId && (s.projectId!==projectId || s.jobRowId!==jobId)){ void loadProjectJob(projectId,jobId); return; }

        if(projectId && !jobId && s.projectId!==projectId){ void loadProject(projectId); return; }

        if(!s.projectId && !projectId) router.replace('/dashboard');
      } catch (error) {
        if(!active)return;
        const detail=error instanceof Error ? error.message : '';
        const message=`Unable to verify your sign-in.${detail ? ` ${detail}` : ' Please refresh and sign in again.'}`;
        if(libraryMode)setLibraryError(message);
        else toast(message);
      }
    })();

    return()=>{active=false;};
  },[s.jobId,s.profile,s.projectId,s.jobRowId,ready,router,loadProject,loadProjectJob,libraryMode,toast]);

  useEffect(()=>{
    let active=true;
    void (async()=>{
      try {
        const token=await getAccessToken();
        if(!token||!active)return;
        const res=await fetch('/api/account',{headers:{Authorization:`Bearer ${token}`}});
        if(!res.ok)throw new Error(`Account access check failed (HTTP ${res.status}).`);
        const account=await res.json();
        if(active)setCanRegenerate(Boolean(account.entitlements?.canRegenerate));
      } catch(error) {
        if(!active)return;
        const detail=error instanceof Error ? error.message : '';
        toast(`Unable to load account permissions.${detail ? ` ${detail}` : ' Please try again.'}`);
      }
    })();
    return()=>{active=false;};
  },[toast]);



  // Poll the existing n8n live-view endpoint only. The n8n workflow writes each

  // section as HTML and the live-view endpoint returns either a waiting shell or

  // the completed section. Keep the existing UI/state model; only make transport

  // handling more tolerant of the file-backed n8n workflow.

  const loadedRef = useRef<Record<string, boolean>>({});

  const sectionsRef = useRef(s.sections);

  sectionsRef.current = s.sections;

  useEffect(()=>{

    if(!s.jobId) return;

    loadedRef.current = Object.fromEntries(SEC_META.map(sec=>[sec.key, Boolean(s.sections[sec.key]?.length)]));

  },[s.jobId, s.sections]);



  useEffect(()=>{

    if(!s.jobId || s.generationStatus==='cancelled' || s.generationStatus==='completed') return;

    let cancelled=false;

    let timer: ReturnType<typeof setTimeout>|null=null;

    let delayIndex=0;

    const delays=[4000,8000,12000,20000];

    const clear=()=>{if(timer){clearTimeout(timer);timer=null;}};

    const schedule=()=>{

      if(cancelled||document.hidden)return;

      timer=setTimeout(poll,delays[Math.min(delayIndex,delays.length-1)]);

      delayIndex=Math.min(delayIndex+1,delays.length-1);

    };



    const fetchSection=async(sec: typeof SEC_META[number])=>{

      const theme: Partial<BrandThemeType> = s.brandTheme || {};

      const qs = new URLSearchParams({ job_id:s.jobId!, section:sec.key });

      if(theme.primary_color) qs.set('primary',theme.primary_color);

      if(theme.secondary_color) qs.set('secondary',theme.secondary_color);

      if(theme.background_color) qs.set('background',theme.background_color);

      if(theme.text_color) qs.set('text',theme.text_color);

      const token=await getAccessToken();

      const headers:Record<string,string>={};

      if(token) headers.Authorization=`Bearer ${token}`;

      if(s.liveViewToken) headers['X-Sparrow-Live-Token']=s.liveViewToken;

      const res=await fetch('/api/live-view?'+qs.toString(),{headers,cache:'no-store'});

      if(!res.ok){

        const body=await res.json().catch(()=>({}));

        throw new Error(body.error||`Live view unavailable (HTTP ${res.status}).`);

      }

      const html=await res.text();

      const liveStatus=res.headers.get('X-Sparrow-Live-Status');

      if(liveStatus==='pending' || !html.trim()) return [];

      // n8n's pending page uses either a waiting card or a refresh meta tag.

      if(/<meta[^>]+http-equiv=["']refresh["']/i.test(html)||/class=["'][^"']*\bwaiting\b/i.test(html)) return [];

      const parsed=parseLiveViewHtml(html);

      const ch=sec.key==='social'?'Social':sec.key==='ads'?'Ads & messaging':sec.key==='blogs'?'Blog & video':'Website';

      let cards = parsed ? splitIntoCards(parsed, sec.key, ch) : [];

      if (!cards.length) cards = splitIntoCards(html, sec.key, ch);

      const channel=sec.key==='blogs'
        ? 'Blog & video'
        : sec.key==='website'
          ? 'Website'
          : sec.key==='ads'
            ? 'Ads & Messages'
            : null;
      return cards
        .filter(card=>card.bodyText.trim())
        .map(card=>({...card,section:sec.key,channel:channel||card.channel}));

    };



    const poll=async()=>{

      if(cancelled||document.hidden)return;

      try{

        const targets=SEC_META.filter(sec=>!loadedRef.current[sec.key] && !sectionsRef.current[sec.key]?.length);

        if(!targets.length){ set({generationStatus:'completed'}); return; }

        const results=await Promise.allSettled(targets.map(fetchSection));

        if(cancelled)return;

        const updated={...sectionsRef.current};

        let changed=false;

        let hardError='';

        results.forEach((result,index)=>{

          const sec=targets[index];

          if(result.status==='fulfilled'){

            const cards=result.value;

            if(cards.length){

              updated[sec.key]=cards;

              loadedRef.current[sec.key]=true;

              changed=true;

            }

          }else if(!hardError){

            hardError=result.reason instanceof Error ? result.reason.message : 'Live content is temporarily unavailable.';

          }

        });

        if(hardError && !changed) {

          setPollErrorCount(v=>v+1);

        } else {

          setPollErrorCount(0);

          setPollError('');

        }

        if(changed){

          const done=SEC_META.every(sec=>Boolean(updated[sec.key]?.length));

          set({sections:updated,generationStatus:done?'completed':Object.keys(updated).length?'partial':'running'});

          if (s.jobRowId && s.projectId) {

            void persistJobState(s.projectId, s.jobRowId, {

              sections: updated,

              status: done ? 'completed' : 'partial',

              finished_at: done ? new Date().toISOString() : null

            });

          }

          delayIndex=0;

        }

        if(SEC_META.every(sec=>Boolean(loadedRef.current[sec.key]))) return;

        if(Date.now()-s.jobStarted>=GIVE_UP_MS){

          setPollError('Content generation is taking longer than expected.');

          set({generationStatus:'failed'});

          return;

        }

        schedule();

      }catch(error){

        if(cancelled)return;

        setPollErrorCount(v=>v+1);

        if(Date.now()-s.jobStarted>=GIVE_UP_MS){

          setPollError(error instanceof Error?error.message:'Content generation is taking longer than expected.');

          set({generationStatus:'failed'});

          return;

        }

        schedule();

      }

    };



    const onVisibility=()=>{clear();if(!document.hidden){delayIndex=0;void poll();}};

    document.addEventListener('visibilitychange',onVisibility);

    void poll();

    return()=>{cancelled=true;clear();document.removeEventListener('visibilitychange',onVisibility)};

  },[s.jobId,s.jobStarted,s.generationStatus,s.liveViewToken,s.brandTheme]);



  // Fresh generation => forget media from the previous generation (card ids like "instagram-1" repeat).
  useEffect(()=>{ setMediaState({}); },[s.jobId]);
  useEffect(()=>{ setFilter('all'); setSearch(''); },[s.jobId]);

  const generateMedia = async (p: Piece, libraryItem?: LibraryPiece) => {

    const spec = mediaSpec(p);

    if (!spec) return;

    setMediaState(prev => ({ ...prev, [p.id]: { ...prev[p.id], type: spec.type, busy: true, error: undefined } }));

    try {

      const token = await getAccessToken();

      const headers: Record<string,string> = { 'Content-Type': 'application/json' };

      if (token) headers.Authorization = `Bearer ${token}`;

      const body: Record<string,unknown> = {

        card_id: p.id, platform: p.channel, title: p.title, content: p.bodyText,

        prompt: spec.prompt, media_type: spec.type, aspect_ratio: spec.ratio,

        project_id: s.projectId,

        brand_theme: withVerifiedCompanyLogo(s.brandTheme), include_logo: Boolean(verifiedCompanyLogo(s.brandTheme)),

      };

      if (spec.type === 'video') {

        body.duration = spec.duration; body.requested_duration = spec.duration;

        body.scene_count = spec.sceneCount; body.scene_timings = spec.sceneTimings;

      }

      const res = await fetch('/api/media', { method: 'POST', headers, body: JSON.stringify(body) });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.media_url) throw new Error(data.error || 'Media generation failed.');

      const url = String(data.media_url);

      setMediaState(prev => ({ ...prev, [p.id]: { url, type: spec.type, busy: false } }));

      if (libraryItem) {
        const isCurrentJob = libraryItem.sourceJobId
          ? libraryItem.sourceJobId === s.jobRowId
          : Boolean(s.jobId);
        const sourceJob = libraryRows.find(job=>job.id===libraryItem.sourceJobId);
        if (!isCurrentJob && !sourceJob) throw new Error('The saved generation for this content could not be found.');

        const sourceSections = isCurrentJob
          ? sectionsRef.current
          : normalizeLibrarySections(sourceJob?.sections);
        const updatedSections = { ...sourceSections };
        let updatedPieceFound = false;
        for (const [section, list] of Object.entries(updatedSections)) {
          updatedSections[section] = (list || []).map(item => {
            if (item.id !== libraryItem.sourcePieceId) return item;
            updatedPieceFound = true;
            return { ...item, mediaUrl: url, mediaType: spec.type as Piece['mediaType'] };
          });
        }
        if (!updatedPieceFound) throw new Error('This content item changed before its visual could be saved. Refresh the Library and try again.');

        if (libraryItem.sourceJobId && s.projectId) {
          const saved = await persistJobState(s.projectId, libraryItem.sourceJobId, { sections: updatedSections });
          if (!saved) throw new Error('The visual was generated but could not be saved. Please try again.');
        }

        if (isCurrentJob) {
          sectionsRef.current = updatedSections;
          set({ sections: updatedSections });
        } else if (libraryItem.sourceJobId) {
          setLibraryJobData(current => current && current.projectId === s.projectId
            ? {
                ...current,
                jobs: current.jobs.map(job => job.id === libraryItem.sourceJobId ? { ...job, sections: updatedSections } : job),
              }
            : current);
        }
      } else {
        const updatedSections = { ...sectionsRef.current };
        for (const [section, list] of Object.entries(updatedSections)) {
          updatedSections[section] = (list || []).map(item => item.id === p.id ? { ...item, mediaUrl: url, mediaType: spec.type as Piece['mediaType'] } : item);
        }
        set({ sections: updatedSections });
        if (s.jobRowId && s.projectId) {
          void persistJobState(s.projectId, s.jobRowId, { sections: updatedSections });
        }
      }

      toast('Visual generated');

    } catch (e) {

      const message = e instanceof Error ? e.message : 'Media generation failed.';

      setMediaState(prev => ({ ...prev, [p.id]: { ...prev[p.id], busy: false, error: message } }));

      toast(message);

    }

  };

  const currentJobActive=['starting','running','partial'].includes(s.generationStatus);
  const queuedRequestExists=generationQueue.some(item=>item.projectId===s.projectId&&['queued','starting','running'].includes(item.status));

  const submitGeneration=useCallback(async(nextPrefs:Prefs,queueItemId?:string)=>{
    if(!s.profile||!s.projectId)return;

    setGenerateBusy(true);
    setPollError('');
    set({
      prefs:nextPrefs,
      jobId:null,
      jobRowId:null,
      liveViewToken:null,
      generationRequestId:null,
      jobStarted:Date.now(),
      finishedAt:null,
      generationStatus:'starting',
      sections:{},
      schedule:{__selectedPlatforms:[...nextPrefs.platforms]} as any,
    });
    if(!libraryMode&&!queueItemId)router.push(`/library?project=${encodeURIComponent(s.projectId)}`);

    if(queueItemId){
      setGenerationQueue(prev=>prev.map(item=>item.id===queueItemId?{...item,status:'starting',error:undefined}:item));
    }

    try{
      const token=await getAccessToken();
      const headers:Record<string,string>={'Content-Type':'application/json'};
      if(token) headers.Authorization=`Bearer ${token}`;

      const res=await fetch('/api/generate',{
        method:'POST',
        headers,
        body:JSON.stringify({...s.profile,...nextPrefs,brand_theme:s.brandTheme,project_id:s.projectId,regenerate:false,previous_content:''}),
      });
      const data=await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(data.error||'Generation failed.');

      const jobId=String(data.job_id||String(data.html||'').match(/job_id=([a-zA-Z0-9\_-]+)/)?.[1]||'');
      if(!jobId) throw new Error('Generation did not return a valid job ID.');

      const initialSections=sectionsFromN8nResponse(data);
      const initialCount=Object.keys(initialSections).length;
      const initialStatus=data.direct_provider
        ? 'completed'
        : initialCount===SEC_META.length
          ? 'completed'
          : initialCount>0
            ? 'partial'
            : 'running';
      const finishedAt=data.direct_provider?new Date().toISOString():null;

      set({
        jobId,
        jobRowId:data.jobRowId||null,
        liveViewToken:data.live_view_token||null,
        generationRequestId:data.request_id||null,
        jobStarted:Date.now(),
        finishedAt,
        generationStatus:initialStatus,
        sections:initialSections,
        schedule:{__selectedPlatforms:[...nextPrefs.platforms]} as any,
        brandTheme:data.brandTheme?{...s.brandTheme,...data.brandTheme}:s.brandTheme,
      });

      if(queueItemId){
        setGenerationQueue(prev=>prev.map(item=>item.id===queueItemId?{...item,status:'running',jobId,rowId:data.jobRowId||undefined}:item));
      }

      if(data.direct_provider&&s.projectId&&data.jobRowId){
        void persistJobState(s.projectId,data.jobRowId,{
          sections:initialSections,
          status:'completed',
          finished_at:finishedAt,
          job_id:jobId,
        });
      }

      toast(queueItemId?'Queued generation started':'Generation started');
      if(!libraryMode&&queueItemId)router.push(`/library?project=${encodeURIComponent(s.projectId)}`);
    }catch(e){
      const message=e instanceof Error?e.message:'Generation failed.';
      setPollError(message);
      set({generationStatus:'failed'});
      toast(message);
      if(queueItemId){
        setGenerationQueue(prev=>prev.map(item=>item.id===queueItemId?{...item,status:'failed',error:message}:item));
      }
    }finally{
      setGenerateBusy(false);
      queueLaunchRef.current=false;
    }
  },[s.profile,s.projectId,s.brandTheme,set,router,toast,libraryMode]);

  const startGeneration=async()=>{
    if(generateBusy||!studioPlatforms.length||!studioGoal||!studioTone||!studioStyle)return;

    const nextPrefs:Prefs={
      ...s.prefs,
      platforms:studioPlatforms,
      goal:studioGoal,
      tone:studioTone,
      style:studioStyle,
      extra:studioExtra.trim(),
    };
    if(currentJobActive||queuedRequestExists){
      const item:GenerationQueueItem={
        id:crypto.randomUUID(),
        projectId:s.projectId||'',
        prefs:nextPrefs,
        status:'queued',
      };
      const activeItem=currentJobActive&&s.jobId&&generationQueue.every(queued=>queued.jobId!==s.jobId)
        ? [{
            id:`active-${s.jobId}`,
            projectId:s.projectId||'',
            prefs:s.prefs,
            status:'running' as const,
            jobId:s.jobId,
            rowId:s.jobRowId||undefined,
          }]
        : [];
      const nextQueue=[...generationQueue,...activeItem,item];
      setGenerationQueue(nextQueue);
      let queuePersisted=true;
      try{
        window.sessionStorage.setItem(`sparrow-generation-queue:${s.projectId}`,JSON.stringify(nextQueue));
        setQueueStorageError('');
        showLibrary();
      }catch{
        queuePersisted=false;
        const message='Queued requests may be lost if you leave or reload this tab. Keep Studio open while this request runs.';
        setQueueStorageError(message);
        toast(message);
      }
      if(queuePersisted)toast('Generation added to the queue');
      return;
    }

    await submitGeneration(nextPrefs);
  };

  useEffect(()=>{
    if(!s.jobId)return;
    const status:GenerationQueueItem['status']=s.generationStatus==='completed'
      ? 'completed'
      : s.generationStatus==='failed'
        ? 'failed'
        : s.generationStatus==='cancelled'
          ? 'cancelled'
          : 'running';
    setGenerationQueue(prev=>prev.map(item=>{
      const matchesCurrentJob=item.rowId&&s.jobRowId
        ? item.rowId===s.jobRowId
        : item.jobId===s.jobId;
      if(matchesCurrentJob){
        const sections=['completed','failed','cancelled'].includes(status)?s.sections:item.sections;
        if(item.status!==status||item.rowId!==s.jobRowId||item.sections!==sections){
          return {...item,status,jobId:s.jobId||item.jobId||undefined,rowId:s.jobRowId||item.rowId||undefined,sections};
        }
      }
      if(s.generationStatus==='cancelled'&&item.status==='queued')return {...item,status:'cancelled'};
      return item;
    }));
  },[s.jobId,s.jobRowId,s.generationStatus,s.sections]);

  useEffect(()=>{
    if(!s.projectId||queueLoadedProject!==s.projectId)return;
    const missingSnapshots=generationQueue.filter(item=>item.projectId===s.projectId
      &&item.status==='completed'&&!item.sections&&!item.error&&Boolean(item.jobId));
    if(!missingSnapshots.length)return;

    let cancelled=false;
    void (async()=>{
      const token=await getAccessToken();
      if(!token)throw new Error('Sign in again to restore generated content.');
      const loaded=await Promise.all(missingSnapshots.map(async item=>({
        id:item.id,
        job:item.rowId
          ? await getJob(item.rowId,token)
          : await getJobByExternalId(item.jobId!,token),
      })));
      if(cancelled)return;
      setGenerationQueue(prev=>prev.map(item=>{
        const result=loaded.find(entry=>entry.id===item.id);
        if(!result)return item;
        if(!result.job
          ||result.job.project_id!==item.projectId
          ||(item.rowId&&result.job.id!==item.rowId)
          ||(item.jobId&&result.job.job_id!==item.jobId)
          ||!isGenerationSections(result.job.sections)){
          return {...item,error:'Saved content could not be restored. Open History to view this generation.'};
        }
        return {...item,rowId:result.job.id,sections:result.job.sections};
      }));
    })().catch(()=>{
      if(cancelled)return;
      setGenerationQueue(prev=>prev.map(item=>missingSnapshots.some(missing=>missing.id===item.id)
        ?{...item,error:'Unable to restore saved content. Open History and try again.'}
        :item));
    });

    return()=>{cancelled=true;};
  },[s.projectId,queueLoadedProject,generationQueue]);

  useEffect(()=>{
    if(!s.projectId||queueLoadedProject!==s.projectId||!ready||!s.profile||generateBusy||queueLaunchRef.current)return;
    if(generationQueue.some(item=>item.projectId===s.projectId&&(item.status==='starting'||item.status==='running')))return;
    const pending=generationQueue.find(item=>item.projectId===s.projectId&&item.status==='queued');
    if(!pending)return;
    if(['starting','running','partial'].includes(s.generationStatus))return;
    if(s.generationStatus==='cancelled'){
      setGenerationQueue(prev=>prev.map(item=>item.status==='queued'?{...item,status:'cancelled'}:item));
      return;
    }

    const dedupeDelay=s.jobStarted?Math.max(0,10_000-(Date.now()-s.jobStarted)):0;
    queueLaunchRef.current=true;
    const timer=setTimeout(()=>{
      setGenerationQueue(prev=>prev.map(item=>item.id===pending.id?{...item,status:'starting'}:item));
      void submitGeneration(pending.prefs,pending.id);
    },dedupeDelay);
    return()=>{
      clearTimeout(timer);
      if(!generateBusy)queueLaunchRef.current=false;
    };
  },[s.projectId,s.profile,s.jobStarted,s.generationStatus,ready,queueLoadedProject,generateBusy,generationQueue,submitGeneration]);



  const retryGeneration=async()=>{

    if(!s.profile||retryBusy||!s.prefs.platforms?.length)return;

    setRetryBusy(true); setPollError('');

    try{

      const token=await getAccessToken(); const headers:Record<string,string>={'Content-Type':'application/json'}; if(token) headers.Authorization=`Bearer ${token}`; const res=await fetch('/api/generate',{method:'POST',headers,body:JSON.stringify({...s.profile,...s.prefs,brand_theme:s.brandTheme,project_id:s.projectId,regenerate:false,previous_content:''})});

      const data=await res.json().catch(()=>({}));

      if(!res.ok) throw new Error(data.error||'Generation failed.');

      const jobId=String(data.job_id||String(data.html||'').match(/job_id=([a-zA-Z0-9\_-]+)/)?.[1]||'');

      if(!jobId) throw new Error('Generation did not return a valid job ID.');

      const initialSections = sectionsFromN8nResponse(data);

      const initialCount = Object.keys(initialSections).length;

      const started = Date.now();
const finishedAt = data.direct_provider ? new Date().toISOString() : null;

set({
  jobId,
  jobRowId: data.jobRowId || null,
  liveViewToken: data.live_view_token || null,
  generationRequestId: data.request_id || null,
  jobStarted: started,
  finishedAt,
  generationStatus: data.direct_provider
    ? 'completed'
    : initialCount === SEC_META.length
      ? 'completed'
      : initialCount
        ? 'partial'
        : 'running',
  sections: initialSections,
  schedule: { __selectedPlatforms: [...s.prefs.platforms] } as any,
  brandTheme: data.brandTheme
    ? { ...s.brandTheme, ...data.brandTheme }
    : s.brandTheme,
});

if (data.direct_provider && s.projectId && data.jobRowId) {
  void persistJobState(s.projectId, data.jobRowId, {
    sections: initialSections,
    status: 'completed',
    finished_at: finishedAt,
    job_id: jobId,
  });
}

    }catch(e){setPollError(e instanceof Error?e.message:'Generation failed.');}

    finally{setRetryBusy(false);}

  };



  const cancelGeneration=async()=>{

    if(cancelBusy || !s.jobId) return;

    setCancelBusy(true);

    try {
      // Stop this client from polling immediately and persist the terminal state.
      // The current n8n integration does not expose an execution-cancel endpoint,
      // so this cannot terminate work already running inside n8n itself.
      set({generationStatus:'cancelled', finishedAt:new Date().toISOString()});
      if (s.projectId && s.jobRowId) {
        const saved = await persistJobState(s.projectId, s.jobRowId, {
          status: 'cancelled',
          finished_at: new Date().toISOString(),
          last_error: 'Cancelled by the user in Studio.',
        });
        if (!saved) {
          toast('Stopped monitoring, but could not save cancellation status. Check your connection.');
          return;
        }
      }
      toast('Generation cancelled in Studio');

    } finally { setCancelBusy(false); }

  };



  const regenerateGeneration=async()=>{

    if(regenerateBusy||!s.profile||!s.projectId)return;

    if(!canRegenerate){setShowUpgrade(true);return;}

    setRegenerateBusy(true);setPollError('');set({generationStatus:'starting',sections:{},schedule:{}});

    try{

      const token=await getAccessToken();

      if(!token){setShowUpgrade(true);set({generationStatus:'completed'});return;}

      const headers:Record<string,string>={'Content-Type':'application/json',Authorization:`Bearer ${token}`};

      const previous=pieces().map(x=>`## ${x.title}\n${x.bodyText}`).join('\n\n---\n\n').slice(0,11500);

      const res=await fetch('/api/generate',{method:'POST',headers,body:JSON.stringify({...s.profile,...s.prefs,brand_theme:s.brandTheme,project_id:s.projectId,regenerate:true,previous_content:previous})});

      const data=await res.json().catch(()=>({}));

      if(res.status===402){setShowUpgrade(true);set({generationStatus:'completed'});return;}

      if(!res.ok)throw new Error(data.error||'Regeneration failed.');

      const jobId=String(data.job_id||String(data.html||'').match(/job_id=([a-zA-Z0-9\_-]+)/)?.[1]||'');

      if(!jobId)throw new Error('Regeneration did not return a valid job ID.');

      const initialSections = sectionsFromN8nResponse(data);

      const initialCount = Object.keys(initialSections).length;

      const finishedAt = data.direct_provider ? new Date().toISOString() : null;

set({
  jobId,
  jobRowId: data.jobRowId || null,
  liveViewToken: data.live_view_token || null,
  generationRequestId: data.request_id || null,
  jobStarted: Date.now(),
  finishedAt,
  generationStatus: data.direct_provider
    ? 'completed'
    : initialCount === SEC_META.length
      ? 'completed'
      : initialCount
        ? 'partial'
        : 'running',
  sections: initialSections,
  schedule: { __selectedPlatforms: [...s.prefs.platforms] } as any,
  brandTheme: data.brandTheme
    ? { ...s.brandTheme, ...data.brandTheme }
    : s.brandTheme,
});

if (data.direct_provider && s.projectId && data.jobRowId) {
  void persistJobState(s.projectId, data.jobRowId, {
    sections: initialSections,
    status: 'completed',
    finished_at: finishedAt,
    job_id: jobId,
  });
}

      toast('Improved content generation started');

    }catch(e){setPollError(e instanceof Error?e.message:'Regeneration failed.');set({generationStatus:'failed'});}finally{setRegenerateBusy(false);}

  };



  const company = s.profile?.company_name || '';
  const projectQueue = generationQueue.filter(item=>item.projectId===s.projectId);
  const queueStatusItems = projectQueue.filter(item=>{
    const isCurrentJob=item.rowId&&s.jobRowId
      ? item.rowId===s.jobRowId
      : item.jobId===s.jobId;
    return !isCurrentJob&&item.status!=='completed';
  });
  const selectedPlatforms = s.prefs.platforms.map(p => p.toLowerCase());
  const storedLibraryJobs = libraryJobData?.projectId===s.projectId ? libraryJobData.jobs : [];
  const currentLibraryJob:JobRow|null=s.jobId&&s.projectId?{
    id:s.jobRowId||`local-${s.jobId}`,
    project_id:s.projectId,
    job_id:s.jobId,
    status:s.generationStatus,
    started_at:s.jobStarted?new Date(s.jobStarted).toISOString():new Date().toISOString(),
    finished_at:s.finishedAt,
    request_id:s.generationRequestId,
    last_error:null,
    live_view_token:s.liveViewToken,
    sections:s.sections,
    schedule:s.schedule,
  }:null;
  const libraryRows=storedLibraryJobs.map(job=>{
    const isCurrent=currentLibraryJob&&(job.id===currentLibraryJob.id||job.job_id===currentLibraryJob.job_id);
    return isCurrent?{...job,...currentLibraryJob}:job;
  });
  if(currentLibraryJob&&!libraryRows.some(job=>job.id===currentLibraryJob.id||job.job_id===currentLibraryJob.job_id)){
    libraryRows.unshift(currentLibraryJob);
  }
  const libraryPieces:LibraryPiece[]=libraryRows.flatMap(job=>{
    const sections=job===currentLibraryJob||job.id===s.jobRowId||job.job_id===s.jobId
      ? normalizeLibrarySections(s.sections)
      : normalizeLibrarySections(job.sections);
    return Object.values(sections).flatMap(section=>section.map((piece,index)=>({
      ...piece,
      id:`library-${job.id}-${piece.id}-${index}`,
      sourceJobId:job.id.startsWith('local-')?null:job.id,
      sourcePieceId:piece.id,
    })));
  });
  const handleMediaGeneration = (item: Piece) => {
    if (!libraryMode) {
      void generateMedia(item);
      return;
    }
    const libraryItem = libraryPieces.find(candidate=>candidate.id===item.id);
    if (!libraryItem) {
      toast('This saved content item could not be found. Refresh the Library and try again.');
      return;
    }
    void generateMedia(item, libraryItem);
  };
  const allPieces = libraryMode ? libraryPieces : pieces();
  const channels = [...new Set(allPieces.map(x => x.channel))];
  const blogsPresent=allPieces.some(piece=>piece.section==='blogs'||channelFilterKey(piece.channel)==='blogs');
  const blogsSelected = selectedPlatforms.includes('blogs');

  // Show only channels explicitly selected for this generation. Never leak
  // Website, Ads, Blog, or unrelated platform cards into a platform-only view.

  const filtered = libraryMode ? allPieces : allPieces.filter(p => {
    if(blogsSelected&&p.section==='blogs')return true;
    return selectedPlatforms.some(sp=>channelFilterKey(p.channel)===channelFilterKey(sp));
  });

  const filterChannels = [...new Map(channels.map(channel=>[channelFilterKey(channel),channel])).values()];
  if(blogsPresent&&!filterChannels.some(channel=>channelFilterKey(channel)==='blogs'))filterChannels.push('Blogs');
  const filterPriority = (channel:string) => {
    const key=channelFilterKey(channel);
    const socialIndex=PLATFORMS.slice(0,5).findIndex(platform=>channelFilterKey(platform)===key);
    if(socialIndex>=0)return socialIndex;
    if(key==='website')return 5;
    if(key==='blogs')return 6;
    if(key==='ads')return 7;
    return 4.5;
  };
  filterChannels.sort((a,b)=>filterPriority(a)-filterPriority(b));
  const q = search.toLowerCase();

  const shown = filtered.filter(x => (filter === 'all' || matchesChannelFilter(x,filter)) && (!q || (x.title + ' ' + x.bodyText).toLowerCase().includes(q)));

  const activeSections = SEC_META.filter(sec => {
  if (sec.key === 'social') {
      return s.prefs.platforms.some(p =>
      ['Instagram', 'Facebook', 'LinkedIn', 'X/Twitter', 'YouTube'].includes(p)
    );
  }

  if (sec.key === 'blogs') {
      return s.prefs.platforms.includes('Blogs');
  }



  return false;

});



  const waiting = activeSections.filter(

    sec => !s.sections[sec.key]?.length

  ).length;

  // Group by channel

  const byChannel: Record<string, Piece[]> = {};

  shown.forEach(p => { (byChannel[p.channel] = byChannel[p.channel] || []).push(p); });



  const cnt = (f: string) => filtered.filter(x => f === 'all' || x.channel === f).length;

  const vp = viewId ? (libraryMode ? allPieces.find(item=>item.id===viewId) : piece(viewId)) : undefined;
const scheduleLibraryPiece = (id: string) => {
  const target = libraryPieces.find(item=>item.id===id);
  if (!target) {
    toast('Unable to schedule this content because its source could not be found.');
    return;
  }
  setViewId(null);
  setScheduleTarget(target);
};
const openEditor = (p: Piece) => {
  setEditId(p.id);
  setEditTitle(p.title || '');
  setEditHtml(p.bodyHtml || '');
};

const closeEditor = () => {
  setEditId(null);
  setEditTitle('');
  setEditHtml('');
};

const saveEditor = async () => {
  if (!editId) return;

  const updatedSections = { ...sectionsRef.current };

  for (const [section, list] of Object.entries(updatedSections)) {
    updatedSections[section] = (list || []).map(item => {
      if (item.id !== editId) return item;

      const temp = document.createElement('div');
      temp.innerHTML = editHtml;

      const bodyText = temp.innerText.trim();

      return {
        ...item,
        title: editTitle.trim() || item.title,
        bodyHtml: editHtml,
        bodyText,
        wordCount: bodyText
          ? bodyText.split(/\s+/).length
          : 0,
      };
    });
  }

  // Make the edited version the current Studio source of truth.
  set({
    sections: updatedSections,
  });

  // Persist the edited version so it survives refresh.
  if (s.jobRowId && s.projectId) {
    await persistJobState(
      s.projectId,
      s.jobRowId,
      {
        sections: updatedSections,
      }
    );
  }

  closeEditor();

  toast('Changes saved');
};

const formatEditor = (command: string, value?: string) => {
  document.execCommand(command, false, value);
};

  if(!ready)return <StoreLoading/>;
  if(!s.projectId || !s.profile)return null;

  return <div className="company-workspace reference-app"><CompanyHeader/>

  <BrandTheme/>

  <div className={`page-container${libraryMode?' library-content-page':''}`}>

    {libraryMode && <section className="studio-generation-heading">
      <button type="button" className="btn btn-ghost btn-sm studio-back-to-brief" onClick={()=>router.push(`/studio?project=${encodeURIComponent(s.projectId||'')}`)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m15 18-6-6 6-6M9 12h12" /></svg>
        Studio
      </button>
      <div>
        <h1>Content library</h1>
        <p>{company ? `Generated content for ${company}, across every saved generation.` : 'Generated content, across every saved generation.'}</p>
      </div>
    </section>}

    {!libraryMode && <section className="studio-options-panel">

      <div className="studio-options-head">
        <div className="studio-options-intro">
          <span className="studio-options-kicker"><i aria-hidden="true" /> STUDIO <span>·</span> CONTENT BRIEF</span>
          <h1>Choose what Sparrow should create.</h1>
          <p>Set the channels and point of view for your next review-ready draft.</p>
        </div>
      </div>

      <div className="studio-options-grid">

        <div className="studio-option-block studio-channels-block">
          <label>Channels</label>
          <div className="studio-channel-table">
            {PLATFORMS.map(pl => {
              const selected = studioPlatforms.includes(pl);
              const marks: Record<string, string> = {
                Instagram: 'IG',
                Facebook: 'f',
                LinkedIn: 'in',
                'X/Twitter': 'X',
                YouTube: '▶',
                Blogs: 'B',
              };
              return (
                <button
                  key={pl}
                  type="button"
                  className={selected ? 'selected' : ''}
                  aria-pressed={selected}
                  onClick={() => setStudioPlatforms(prev => prev.includes(pl) ? prev.filter(x => x !== pl) : [...prev, pl])}
                >
                  <span className="studio-channel-mark" style={{ '--channel-color': colorFor(pl)[0] } as React.CSSProperties} aria-hidden="true">{marks[pl] || pl.slice(0, 2)}</span>
                  <strong>{pl}</strong>
                  <span>{selected ? 'Selected' : 'Select'}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="studio-option-block"><label htmlFor="studio-goal">Content goal</label><select id="studio-goal" className="select" required value={studioGoal} onChange={e=>setStudioGoal(e.target.value)}><option value="" disabled>Select a goal</option><option>Brand / Product Awareness</option><option>Engagement</option></select></div>

        <div className="studio-option-block"><label htmlFor="studio-tone">Brand tone</label><select id="studio-tone" className="select" required value={studioTone} onChange={e=>setStudioTone(e.target.value)}><option value="" disabled>Select a tone</option><option>Professional</option><option>Friendly</option></select></div>

        <div className="studio-option-block"><label htmlFor="studio-style">Writing style</label><select id="studio-style" className="select" required value={studioStyle} onChange={e=>setStudioStyle(e.target.value)}><option value="" disabled>Select a writing style</option>{STYLES.map(x=><option key={x}>{x}</option>)}</select></div>

        <div className="studio-option-block studio-option-wide"><label htmlFor="studio-extra">Additional instructions</label><textarea id="studio-extra" className="textarea" rows={2} value={studioExtra} onChange={e=>setStudioExtra(e.target.value)} placeholder="Optional: campaigns, facts, offers, locations, or constraints." /></div>

      </div>

      <div className="studio-options-actions">
        {(s.jobId || currentJobActive || generateBusy || queuedRequestExists) && <button type="button" className="btn btn-ghost studio-latest-generation-action" onClick={showLibrary}>
          Open Library
        </button>}
        <button className="btn btn-primary studio-generate-action" onClick={startGeneration} disabled={generateBusy||!studioPlatforms.length||!studioGoal||!studioTone||!studioStyle}>
          {generateBusy?'Starting…':currentJobActive||queuedRequestExists?'Queue another generation':'Generate content'}
          {!generateBusy && <span aria-hidden="true">↗</span>}
        </button>
      </div>

    </section>}



    {libraryMode&&<>
      {pollError&&<div className="banner" role="alert"><span>{pollError}</span><button className="btn btn-primary btn-sm" onClick={retryGeneration} disabled={retryBusy}>{retryBusy?'Retrying...':'Retry generation'}</button></div>}
      {!pollError&&s.generationStatus==='cancelled'&&<div className="banner warn" role="status"><span>Generation cancelled.</span></div>}
      {s.generationStatus==='failed'&&!pollError&&<div className="banner" role="alert"><span>Generation failed to start. Your saved content is still available.</span><button className="btn btn-ghost btn-sm" onClick={()=>router.push(`/studio?project=${encodeURIComponent(s.projectId||'')}`)}>Return to Studio</button></div>}
      {libraryError&&<div className="banner" role="alert">{libraryError}</div>}
      {showUpgrade&&<div className="banner"><span>Regeneration is a Pro feature. Your existing content is safe; upgrade to create an improved version.</span><a className="btn btn-primary btn-sm" href="/pricing">View plans</a><button className="btn btn-ghost btn-sm" onClick={()=>setShowUpgrade(false)}>Close</button></div>}

      {s.generationStatus==='starting'&&!s.jobId && <div className="studio-generation-strip" role="status" aria-live="polite">
        <div className="studio-generation-main">
          <div className="studio-generation-row"><span>Starting generation</span><small>{generateBusy?'Preparing your selected channels':'Waiting for the job to start'}</small></div>
          <div className="studio-generation-progress is-indeterminate" aria-hidden="true"><span /></div>
        </div>
      </div>}

      {s.jobId && waiting>0 && !pollError && ['running','partial'].includes(s.generationStatus) && (() => {
        const received = activeSections.length - waiting;
        const progress = activeSections.length ? Math.round((received / activeSections.length) * 100) : 0;
        return <div className="studio-generation-strip">
          <div className="studio-generation-main">
            <div className="studio-generation-row"><span>Generating content</span><small>{received} of {activeSections.length} sections received</small></div>
            <div className="studio-generation-progress" role="progressbar" aria-valuemin={0} aria-valuemax={activeSections.length} aria-valuenow={received}>
              <span style={{width:`${Math.max(8,progress)}%`}} />
            </div>
          </div>
          <button className="btn btn-danger btn-sm" onClick={cancelGeneration} disabled={cancelBusy}>{cancelBusy?'Stopping...':'Cancel'}</button>
        </div>;
      })()}

      {queueStatusItems.length>0&&<section className="studio-queue-status" aria-label="Additional generations">
        <div className="studio-queue-heading">
          <h2>Additional generations</h2>
          <p>Requests start one at a time after the current generation finishes. Keep this tab open to track them.</p>
        </div>
        <ul>
          {queueStatusItems.map(item=>{
            const label=item.status==='queued'?'Queued'
              :item.status==='starting'?'Starting'
                :item.status==='running'?'In progress'
                  :item.status==='completed'?'Complete'
                    :item.status==='cancelled'?'Cancelled'
                      :'Could not start';
            return <li key={item.id}>
              <div className="studio-queue-summary">
                <div className="studio-queue-request">
                  <strong>{item.prefs.platforms.join(', ')}</strong>
                  <small>{item.prefs.goal} · {item.prefs.tone}</small>
                  {item.error&&<span className="studio-queue-error" role="alert">{item.error}</span>}
                </div>
                <span className={`studio-queue-state ${item.status}`}>{label}</span>
              </div>
            </li>;
          })}
        </ul>
      </section>}

      {queueStorageError&&<div className="banner warn" role="alert">{queueStorageError}</div>}
    </>}



    {libraryMode&&<>
    {libraryLoading&&allPieces.length===0&&<div className="empty" role="status">Loading generated content…</div>}

    {/* Platform filter tabs */}
    <div className="platform-tabs">

      {['all', ...filterChannels].map(rawF => { const f=String(rawF); return (

        <button key={f} className="platform-tab" aria-pressed={filter===f} onClick={()=>setFilter(f)}>

          <PlatformIcon channel={f} />

          {f === 'all' ? 'All' : platformDisplayName(f)}

          <span className="count"><CountUp value={cnt(f)} duration={600} /></span>

        </button>

      )})}

      <div className="studio-results-tools">

        <input className="input search studio-search-input" type="search" aria-label="Search generated content" placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)} />

        <button className="btn btn-ghost btn-sm" onClick={()=>router.push(`/calendar?project=${encodeURIComponent(s.projectId || '')}`)}>

          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>

          Calendar

        </button>

      </div>

    </div>



    {/* Content by platform */}

    {Object.entries(byChannel).sort(([a],[b])=>filterPriority(a)-filterPriority(b)).map(([channel, channelPieces]) => (

      <div key={channel} className="platform-block">

        <div className="platform-block-head">

          <PlatformIcon channel={channel} />

          <div>

            <h3>{channel}</h3>

            <span className="piece-count">{channelPieces.length} piece{channelPieces.length !== 1 ? 's' : ''}</span>

          </div>

          

        </div>



        <div className="platform-piece-grid">

        {channelPieces.map(p => (
          <div key={p.id} className="piece-card library-piece-card">

            <div className="piece-card-inner library-piece-card-inner">

              <div className="piece-preview">

                <SocialMock piece={p} company={company} logo={verifiedCompanyLogo(s.brandTheme)} brandTheme={s.brandTheme || undefined} media={mediaState[p.id] || (p.mediaUrl ? {url:p.mediaUrl,type:p.mediaType} : undefined)} onGenerate={()=>handleMediaGeneration(p)} busy={Boolean(mediaState[p.id]?.busy)} />

              </div>

              <div className="piece-copy-col">

                <div className="piece-copy-head">

                  <div>

                    <h3 className="piece-title">{p.title}</h3>

                    <div className="piece-meta" style={{marginTop:4}}>

                      <span className="fmt">{p.format || p.section}</span>

                      <span style={{fontSize:11,color:'var(--ink-3)'}}>{p.wordCount} words</span>

                    </div>

                  </div>

                  {libraryMode ? <div className="library-piece-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={()=>void copyPiece(p)}>Copy</button>
                    <button type="button" className="btn btn-primary btn-sm" onClick={()=>scheduleLibraryPiece(p.id)}>Schedule</button>
                  </div> : p.section==='ads'&&<button type="button" className="btn btn-ghost btn-sm ads-messages-card__copy" onClick={()=>void copyPiece(p)}>
                    Copy
                  </button>}

                </div>

                <ExpandableCardBody piece={p} onExpand={()=>setViewId(p.id)} />

              </div>

            </div>

          </div>
        ))}

        </div>

      </div>

    ))}



    {filter==='all'&&!q&&waiting>0&&<div className="board" style={{marginTop:24}}>{Array.from({length:Math.min(3,waiting)},(_,i)=><div key={'sk'+i} className="skel"/>)}</div>}

    {filtered.length===0&&waiting===0&&!libraryLoading&&<div className="empty">{libraryMode?'No generated content yet.':`No content for ${s.prefs.platforms.join(', ')} yet.`}</div>}

    </>}

  </div>



  {/* Detail modal */}

<Modal open={!!vp} onClose={() => setViewId(null)} label="Content details">
  {vp && (
    <>
      <div className="m-head">
        <div style={{ flex: 1 }}>
          <Chip channel={vp.channel} />

          <span className="fmt" style={{ marginLeft: 6 }}>
            {vp.format || vp.section}
          </span>

          <h2
            style={{
              fontSize: 20,
              fontWeight: 800,
              letterSpacing: '-.02em',
              margin: '8px 0 0',
            }}
          >
            {vp.title}
          </h2>
        </div>

        <button
          className="btn btn-ghost btn-icon"
          onClick={() => setViewId(null)}
          aria-label="Close"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>

      <div className="m-body">
  {s.schedule[vp.id] && (
    <div className="banner" style={{ margin: 0 }}>
      Scheduled for{' '}
      {fmtDate(
        new Date(s.schedule[vp.id].date + 'T00:00')
      )}{' '}
      at {fmtTime(s.schedule[vp.id].time)}
    </div>
  )}

  <div className="modal-preview">
    <SocialMock
      piece={vp}
      company={company}
      logo={verifiedCompanyLogo(s.brandTheme)}
      brandTheme={s.brandTheme || undefined}
      media={mediaState[vp.id] || (vp.mediaUrl ? {url:vp.mediaUrl,type:vp.mediaType} : undefined)}
      onGenerate={()=>handleMediaGeneration(vp)}
      busy={Boolean(mediaState[vp.id]?.busy)}
      expanded
    />
  </div>

  <div
    className="m-content"
    dangerouslySetInnerHTML={{
      __html: sanitizeHtml(libraryMode
        ? String(vp.bodyHtml || vp.bodyText || '')
        : cleanVisibleContent(vp.bodyHtml || vp.bodyText, vp.section)),
    }}
  />
</div>

{libraryMode ? <div className="m-foot">
  <button className="btn btn-ghost" onClick={()=>void copyPiece(vp)}>Copy content</button>
  <button className="btn btn-primary" onClick={()=>scheduleLibraryPiece(vp.id)}>Schedule</button>
</div> : <div className="m-foot">
  <button
    className="btn btn-primary"
    onClick={() => openSched(vp.id)}
  >
    {s.schedule[vp.id]
      ? 'Move on calendar'
      : 'Schedule'}
  </button>
</div>}
</>
)}
</Modal>


{/* Edit modal */}

<Modal open={!!editId} onClose={closeEditor} label="Edit content">
  <div className="m-head">
    <div style={{ flex: 1 }}>
      <span className="fmt">EDIT CONTENT</span>

      <input
        className="input"
        value={editTitle}
        onChange={e =>
          setEditTitle(e.target.value)
        }
        style={{
          width: '100%',
          marginTop: 8,
          fontSize: 20,
          fontWeight: 800,
        }}
      />
    </div>

    <button
      className="btn btn-ghost btn-icon"
      onClick={closeEditor}
      aria-label="Close"
    >
      ×
    </button>
  </div>

  <div className="m-body">

    {/* EDITOR TOOLBAR */}

    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
        paddingBottom: 12,
        borderBottom: '1px solid var(--line)',
        marginBottom: 14,
      }}
    >

      {/* Font family */}

      <select
        className="select"
        defaultValue="Arial"
        onChange={e =>
          formatEditor(
            'fontName',
            e.target.value
          )
        }
      >
        <option value="Arial">
          Arial
        </option>

        <option value="Georgia">
          Georgia
        </option>

        <option value="Times New Roman">
          Times New Roman
        </option>

        <option value="Verdana">
          Verdana
        </option>

        <option value="Tahoma">
          Tahoma
        </option>

        <option value="Courier New">
          Courier New
        </option>
      </select>


      {/* Font size */}

      <select
        className="select"
        defaultValue=""
        onChange={e => {
          if (e.target.value) {
            formatEditor(
              'fontSize',
              e.target.value
            );

            e.target.value = '';
          }
        }}
      >
        <option value="">
          Font size
        </option>

        <option value="1">
          10px
        </option>

        <option value="2">
          12px
        </option>

        <option value="3">
          14px
        </option>

        <option value="4">
          16px
        </option>

        <option value="5">
          18px
        </option>

        <option value="6">
          24px
        </option>

        <option value="7">
          32px
        </option>
      </select>


      {/* Bold */}

      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() =>
          formatEditor('bold')
        }
        title="Bold"
      >
        <strong>B</strong>
      </button>


      {/* Italic */}

      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() =>
          formatEditor('italic')
        }
        title="Italic"
      >
        <em>I</em>
      </button>


      {/* Underline */}

      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() =>
          formatEditor('underline')
        }
        title="Underline"
      >
        <u>U</u>
      </button>


      {/* Strikethrough */}

      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() =>
          formatEditor('strikeThrough')
        }
        title="Strikethrough"
      >
        <s>S</s>
      </button>


      {/* H1 */}

      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() =>
          formatEditor(
            'formatBlock',
            'h1'
          )
        }
      >
        H1
      </button>


      {/* H2 */}

      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() =>
          formatEditor(
            'formatBlock',
            'h2'
          )
        }
      >
        H2
      </button>


      {/* H3 */}

      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() =>
          formatEditor(
            'formatBlock',
            'h3'
          )
        }
      >
        H3
      </button>


      {/* Bullet list */}

      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() =>
          formatEditor(
            'insertUnorderedList'
          )
        }
      >
        • List
      </button>


      {/* Numbered list */}

      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() =>
          formatEditor(
            'insertOrderedList'
          )
        }
      >
        1. List
      </button>


      {/* Align left */}

      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() =>
          formatEditor(
            'justifyLeft'
          )
        }
        title="Align left"
      >
        ←
      </button>


      {/* Align center */}

      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() =>
          formatEditor(
            'justifyCenter'
          )
        }
        title="Align center"
      >
        ↔
      </button>


      {/* Align right */}

      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() =>
          formatEditor(
            'justifyRight'
          )
        }
        title="Align right"
      >
        →
      </button>


      {/* Text colour */}

      <label
        className="btn btn-ghost btn-sm"
        title="Text colour"
        style={{
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        A

        <input
          type="color"
          defaultValue="#111111"
          onChange={e =>
            formatEditor(
              'foreColor',
              e.target.value
            )
          }
          style={{
            width: 20,
            height: 20,
            padding: 0,
            border: 0,
            cursor: 'pointer',
          }}
        />
      </label>


      {/* Highlight colour */}

      <label
        className="btn btn-ghost btn-sm"
        title="Highlight colour"
        style={{
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
        }}
      >
        <span
          style={{
            background: '#fff59d',
            padding: '0 3px',
          }}
        >
          H
        </span>

        <input
          type="color"
          defaultValue="#fff59d"
          onChange={e =>
            formatEditor(
              'hiliteColor',
              e.target.value
            )
          }
          style={{
            width: 20,
            height: 20,
            padding: 0,
            border: 0,
            cursor: 'pointer',
          }}
        />
      </label>


      {/* Undo */}

      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() =>
          formatEditor('undo')
        }
        title="Undo"
      >
        ↶
      </button>


      {/* Redo */}

      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() =>
          formatEditor('redo')
        }
        title="Redo"
      >
        ↷
      </button>


      {/* Clear formatting */}

      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() =>
          formatEditor(
            'removeFormat'
          )
        }
        title="Clear formatting"
      >
        Clear
      </button>

    </div>


    {/* RICH TEXT EDITOR */}

    <div
      className="studio-rich-editor"
      contentEditable
      suppressContentEditableWarning
      dangerouslySetInnerHTML={{
        __html: sanitizeHtml(editHtml),
      }}
      onInput={e =>
        setEditHtml(
          e.currentTarget.innerHTML
        )
      }
      style={{
        minHeight: 420,
        maxHeight: '65vh',
        overflowY: 'auto',
        padding: 20,
        border: '1px solid var(--line)',
        borderRadius: 12,
        background: '#fff',
        outline: 'none',
        lineHeight: 1.7,
      }}
    />

  </div>

  <div className="m-foot">
    <button
      className="btn btn-ghost"
      onClick={closeEditor}
    >
      Cancel
    </button>

    <button
      className="btn btn-primary"
      onClick={saveEditor}
    >
      Save changes
    </button>
  </div>
</Modal>


{libraryMode && scheduleTarget && s.projectId && (
  <ScheduleComposer
    open
    projectId={s.projectId}
    piece={scheduleTarget}
    sourceJobId={scheduleTarget.sourceJobId}
    sourcePieceId={scheduleTarget.sourcePieceId}
    brandTheme={s.brandTheme}
    onSaved={() => toast('Post scheduled')}
    onClose={() => setScheduleTarget(null)}
  />
)}

{!libraryMode && schedId && piece(schedId) && (
  <ScheduleComposer
    open={!!schedId}
    projectId={s.projectId!}
    piece={piece(schedId)!}
    sourceJobId={s.jobRowId}
    sourcePieceId={schedId}
    brandTheme={s.brandTheme}
    onSaved={() => toast('Post scheduled')}
    onClose={() => setSchedId(null)}
  />
)}

</div>;

}
