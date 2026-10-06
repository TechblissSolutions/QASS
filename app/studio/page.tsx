'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';
import { getAccessToken } from '@/lib/auth';
import { persistJobState } from '@/lib/job-persistence';
import { useToast } from '@/components/Toast';
import { SEC_META, GIVE_UP_MS, colorFor, PLATFORMS, STYLES } from '@/lib/constants';
import { fmtDate, fmtTime, copyText, sanitizeHtml } from '@/lib/utils';
import { parseLiveViewHtml, splitIntoCards } from '@/lib/parser';
import Modal from '@/components/Modal';
import TimePicker from '@/components/TimePicker';
import Chip from '@/components/Chip';
import BrandTheme from '@/components/BrandTheme';
import type { Piece, BrandTheme as BrandThemeType } from '@/lib/types';
import StoreLoading from '@/components/StoreLoading';
import CompanyHeader from '@/components/CompanyHeader';
import SmartLogo from '@/components/SmartLogo';
import { getSupabaseClient } from '@/lib/supabase';

function PlatformIcon({ channel }: { channel: string }) {
  const ch = channel.toLowerCase();
  let cls = 'default';
  let letter = channel.charAt(0).toUpperCase();
  if (ch.includes('instagram')) { cls = 'instagram'; letter = 'IG'; }
  else if (ch.includes('facebook')) { cls = 'facebook'; letter = 'FB'; }
  else if (ch.includes('linkedin')) { cls = 'linkedin'; letter = 'in'; }
  else if (ch.includes('twitter') || ch.includes('x/')) { cls = 'x-twitter'; letter = 'X'; }
  else if (ch.includes('youtube')) { cls = 'youtube'; letter = 'YT'; }
  else if (ch.includes('website') || ch.includes('seo')) { cls = 'website'; letter = 'W'; }
  else if (ch.includes('ads') || ch.includes('email') || ch.includes('whatsapp')) { cls = 'ads'; letter = 'Ad'; }
  else if (ch.includes('blog') || ch.includes('video')) { cls = 'blog'; letter = 'Bl'; }
  return <span className={'platform-icon-wrap ' + cls}>{letter}</span>;
}

function mediaSpec(piece: Piece) {
  const raw = String(piece.bodyText || '');
  const type = piece.mediaType || (/MEDIA_TYPE\s*[:\-]\s*VIDEO/i.test(raw) ? 'video' : /MEDIA_TYPE\s*[:\-]\s*IMAGE/i.test(raw) ? 'image' : 'text');
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

function previewImageData(title: string, company: string, primary: string, background: string) {
  const esc = (v: string) => v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const t = esc(title.slice(0, 58));
  const c = esc(company.slice(0, 42));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><rect width="1200" height="675" fill="${background}"/><circle cx="1030" cy="110" r="210" fill="${primary}" opacity=".13"/><circle cx="150" cy="620" r="250" fill="${primary}" opacity=".09"/><rect x="70" y="70" width="1060" height="535" rx="34" fill="none" stroke="${primary}" stroke-width="3" opacity=".35"/><text x="100" y="145" font-family="Arial,sans-serif" font-size="24" font-weight="700" fill="${primary}">${c}</text><text x="100" y="315" font-family="Arial,sans-serif" font-size="54" font-weight="800" fill="${safeHex(background,'#ffffff') === '#ffffff' ? '#111111' : '#ffffff'}">${t}</text><text x="100" y="560" font-family="Arial,sans-serif" font-size="20" fill="${primary}">Preview image · Generate the final visual to replace this preview</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function mediaDisplayUrl(url: string) {
  const raw = String(url || '').trim();
  if (!/^https?:\/\//i.test(raw)) return raw;
  return `/api/media-proxy?url=${encodeURIComponent(raw)}`;
}

function MediaView({ url, type, alt }: { url: string; type?: string; alt: string }) {
  const [direct, setDirect] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { setDirect(false); setFailed(false); }, [url]);
  const src = direct ? url : mediaDisplayUrl(url);
  const onError = () => { if (!direct && /^https?:\/\//i.test(url)) setDirect(true); else setFailed(true); };
  if (failed) return <div className="modal-media-error">Preview unavailable</div>;
  return type === 'video'
    ? <video className="modal-media" src={src} controls playsInline preload="metadata" onError={onError} />
    : <img className="modal-media" src={src} alt={alt} referrerPolicy="no-referrer" onError={onError} />;
}

function SocialMock({
  piece, company, logo, media, brandTheme, onGenerate, busy,
}: {
  piece: Piece; company: string; logo?: string; media?: { url?: string; type?: string; error?: string }; brandTheme?: Partial<BrandThemeType>;
  onGenerate: () => void; busy: boolean;
}) {
  const initials = company.split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || 'SP';
  const caption = piece.bodyText.slice(0, 180);
  const isVideo = media?.type === 'video' || piece.mediaType === 'video';
  const canGenerate = Boolean(mediaSpec(piece));
  return <div className="social-mock">
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

function sectionsFromN8nResponse(data: any): Record<string, Piece[]> {
  const raw = typeof data?.html === 'string' ? data.html : typeof data?.content === 'string' ? data.content : '';
  if (!raw || /^https?:\/\//i.test(raw.trim())) return {};
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
    else if (channel.includes('ad') || channel.includes('message') || channel.includes('email') || channel.includes('whatsapp')) section = 'ads';
    else if (channel.includes('blog') || channel.includes('video')) section = 'blogs';
    const normalized = { ...card, id: card.id || `generated-${section}-${index + 1}`, section } as Piece;
    (out[section] ||= []).push(normalized);
  });
  return out;
}

export default function StudioPage() {
  const {s,set,pieces,piece,ready,loadProjectJob,loadProject}=useStore();const router=useRouter();const toast=useToast();
  const[filter,setFilter]=useState('all');const[studioPlatforms,setStudioPlatforms]=useState<string[]>(s.prefs.platforms||['Instagram','LinkedIn']);const[studioGoal,setStudioGoal]=useState(s.prefs.goal||'Brand / Product Awareness');const[studioTone,setStudioTone]=useState(s.prefs.tone||'Professional');const[studioStyle,setStudioStyle]=useState(s.prefs.style||STYLES[0]);const[studioExtra,setStudioExtra]=useState(s.prefs.extra||'');const[generateBusy,setGenerateBusy]=useState(false);const[search,setSearch]=useState('');const[pollError,setPollError]=useState('');const[pollErrorCount,setPollErrorCount]=useState(0);const[retryBusy,setRetryBusy]=useState(false);
  const[viewId,setViewId]=useState<string|null>(null);
  const[schedId,setSchedId]=useState<string|null>(null);
  const [cancelBusy,setCancelBusy]=useState(false);const[regenerateBusy,setRegenerateBusy]=useState(false);const[canRegenerate,setCanRegenerate]=useState(false);const[showUpgrade,setShowUpgrade]=useState(false);const[schedDate,setSchedDate]=useState('');const[schedTime,setSchedTime]=useState('10:00');
  const [mediaState,setMediaState]=useState<Record<string,{url?:string;type?:string;error?:string;busy?:boolean}>>({});

  useEffect(()=>{ if(s.projectId){ setStudioPlatforms(s.prefs.platforms||['Instagram','LinkedIn']); setStudioGoal(s.prefs.goal||'Brand / Product Awareness'); setStudioTone(s.prefs.tone||'Professional'); setStudioStyle(s.prefs.style||STYLES[0]); setStudioExtra(s.prefs.extra||''); } },[s.projectId]);

  useEffect(()=>{
    if(!ready||typeof window==='undefined') return;
    void (async()=>{
      const token=await getAccessToken();
      if(!token){ router.replace('/login?redirect='+encodeURIComponent(window.location.pathname+window.location.search)); return; }
      const params=new URLSearchParams(window.location.search); const projectId=params.get('project'); const jobId=params.get('job');
    if(projectId && jobId && (s.projectId!==projectId || s.jobRowId!==jobId)){ void loadProjectJob(projectId,jobId); return; }
    if(projectId && !jobId && s.projectId!==projectId){ void loadProject(projectId); return; }
    if(!s.projectId && !projectId) router.replace('/dashboard');
    })();
  },[s.jobId,s.profile,s.projectId,s.jobRowId,ready,router,loadProject,loadProjectJob]);
  useEffect(()=>{(async()=>{const token=await getAccessToken();if(!token)return;const res=await fetch('/api/account',{headers:{Authorization:`Bearer ${token}`}});if(res.ok){const a=await res.json();setCanRegenerate(Boolean(a.entitlements?.canRegenerate));}})()},[]);

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
      let cards=parsed ? splitIntoCards(parsed,sec.key,ch) : [];
      if(!cards.length) cards=splitIntoCards(html,sec.key,ch);
      return cards.filter(card=>card.bodyText.trim());
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

  // Fresh generation => forget media from the previous one (card ids like "instagram-1" repeat).
  useEffect(()=>{ setMediaState({}); },[s.jobId]);
  if(!ready)return <StoreLoading/>;
  if(!s.projectId || !s.profile)return null;

  const generateMedia = async (p: Piece) => {
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
        brand_theme: s.brandTheme || {}, include_logo: true,
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
      const updatedSections = { ...sectionsRef.current };
      for (const [section, list] of Object.entries(updatedSections)) {
        updatedSections[section] = (list || []).map(item => item.id === p.id ? { ...item, mediaUrl: url, mediaType: spec.type as Piece['mediaType'] } : item);
      }
      set({ sections: updatedSections });
      if (s.jobRowId && s.projectId) {
        void persistJobState(s.projectId, s.jobRowId, { sections: updatedSections });
      }
      toast('Visual generated');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Media generation failed.';
      setMediaState(prev => ({ ...prev, [p.id]: { ...prev[p.id], busy: false, error: message } }));
      toast(message);
    }
  };

  const startGeneration=async()=>{
    if(generateBusy || !studioPlatforms.length)return;
    setGenerateBusy(true); setPollError('');
    try{
      const token=await getAccessToken();
      const headers:Record<string,string>={'Content-Type':'application/json'}; if(token) headers.Authorization=`Bearer ${token}`;
      const extra=studioExtra.trim();
      const nextPrefs={...s.prefs,platforms:studioPlatforms,goal:studioGoal,tone:studioTone,style:studioStyle,extra};
      set({prefs:nextPrefs});
      const res=await fetch('/api/generate',{method:'POST',headers,body:JSON.stringify({...s.profile,...nextPrefs,brand_theme:s.brandTheme,project_id:s.projectId,regenerate:false,previous_content:''})});
      const data=await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(data.error||'Generation failed.');
      const jobId=String(data.job_id||String(data.html||'').match(/job_id=([a-zA-Z0-9_-]+)/)?.[1]||'');
      if(!jobId) throw new Error('Generation did not return a valid job ID.');
      const initialSections = sectionsFromN8nResponse(data);
      const initialCount = Object.keys(initialSections).length;
      const initialStatus = initialCount === SEC_META.length ? 'completed' : initialCount > 0 ? 'partial' : 'running';
      set({jobId,jobRowId:data.jobRowId||null,liveViewToken:data.live_view_token||null,generationRequestId:data.request_id||null,jobStarted:Date.now(),finishedAt:null,generationStatus:initialStatus,sections:initialSections,schedule:{__selectedPlatforms:[...studioPlatforms]} as any,brandTheme:data.brandTheme?{...s.brandTheme,...data.brandTheme}:s.brandTheme});
      router.replace(`/studio?project=${encodeURIComponent(s.projectId||'')}`);
      toast('Generation started');
    }catch(e){setPollError(e instanceof Error?e.message:'Generation failed.');}
    finally{setGenerateBusy(false);}
  };

  const retryGeneration=async()=>{
    if(!s.profile||retryBusy)return;
    setRetryBusy(true); setPollError('');
    try{
      const token=await getAccessToken(); const headers:Record<string,string>={'Content-Type':'application/json'}; if(token) headers.Authorization=`Bearer ${token}`; const res=await fetch('/api/generate',{method:'POST',headers,body:JSON.stringify({...s.profile,...s.prefs,brand_theme:s.brandTheme,project_id:s.projectId,regenerate:false,previous_content:''})});
      const data=await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(data.error||'Generation failed.');
      const jobId=String(data.job_id||String(data.html||'').match(/job_id=([a-zA-Z0-9_-]+)/)?.[1]||'');
      if(!jobId) throw new Error('Generation did not return a valid job ID.');
      const initialSections = sectionsFromN8nResponse(data);
      const initialCount = Object.keys(initialSections).length;
      const started=Date.now(); set({jobId,jobRowId:data.jobRowId||null,liveViewToken:data.live_view_token||null,generationRequestId:data.request_id||null,jobStarted:started,finishedAt:null,generationStatus:initialCount===SEC_META.length?'completed':initialCount?'partial':'running',sections:initialSections,schedule:{__selectedPlatforms:[...s.prefs.platforms]} as any,brandTheme:data.brandTheme?{...s.brandTheme,...data.brandTheme}:s.brandTheme});
    }catch(e){setPollError(e instanceof Error?e.message:'Generation failed.');}
    finally{setRetryBusy(false);}
  };

  const cancelGeneration=async()=>{
    if(cancelBusy) return;
    setCancelBusy(true);
    try {
      set({generationStatus:'cancelled'});
      toast('Generation monitoring stopped');
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
      const jobId=String(data.job_id||String(data.html||'').match(/job_id=([a-zA-Z0-9_-]+)/)?.[1]||'');
      if(!jobId)throw new Error('Regeneration did not return a valid job ID.');
      const initialSections = sectionsFromN8nResponse(data);
      const initialCount = Object.keys(initialSections).length;
      set({jobId,jobRowId:data.jobRowId||null,liveViewToken:data.live_view_token||null,generationRequestId:data.request_id||null,jobStarted:Date.now(),finishedAt:null,generationStatus:initialCount===SEC_META.length?'completed':initialCount?'partial':'running',sections:initialSections,schedule:{__selectedPlatforms:[...s.prefs.platforms]} as any,brandTheme:data.brandTheme?{...s.brandTheme,...data.brandTheme}:s.brandTheme});
      toast('Improved content generation started');
    }catch(e){setPollError(e instanceof Error?e.message:'Regeneration failed.');set({generationStatus:'failed'});}finally{setRegenerateBusy(false);}
  };

  const selectedPlatforms = s.prefs.platforms.map(p => p.toLowerCase());
const allPieces = pieces();

const channels = [...new Set(allPieces.map(x => x.channel))];

const blogsSelected = selectedPlatforms.includes('blogs');
  // Show only channels explicitly selected for this generation. Never leak
  // Website, Ads, Blog, or unrelated platform cards into a platform-only view.
  const filtered = allPieces.filter(p => {
  const ch = p.channel.toLowerCase().replace(/\s+/g, ' ').trim();

  if (blogsSelected && p.section === 'blogs') {
    return true;
  }

  return selectedPlatforms.some(sp => {
    if (sp === 'blogs') return false;

    const normalized = sp
      .replace('x/twitter', 'twitter')
      .replace('x/', '')
      .trim();

    return (
      ch === normalized ||
      ch.includes(normalized) ||
      normalized.includes(ch)
    );
  });
});

  const filterChannels = [
  ...channels,
  ...(blogsSelected && !channels.some(ch =>
    ch.toLowerCase().includes('blog')
  )
    ? ['Blogs']
    : []),
];
  const q = search.toLowerCase();
  const shown = filtered.filter(x => (filter === 'all' || x.channel === filter) && (!q || (x.title + ' ' + x.bodyText).toLowerCase().includes(q)));
  const activeSections = SEC_META.filter(sec => {
  if (sec.key === 'social') {
    return studioPlatforms.some(p =>
      ['Instagram', 'Facebook', 'LinkedIn', 'X/Twitter', 'YouTube'].includes(p)
    );
  }

  if (sec.key === 'blogs') {
    return studioPlatforms.includes('Blogs');
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
  const vp = viewId ? piece(viewId) : undefined;

  const localDate=()=>{const d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
  const openSched=(id:string)=>{const c=s.schedule[id];setSchedId(id);setSchedDate(c?.date||localDate());setSchedTime(c?.time||'10:00');setViewId(null)};
  const saveSched=(d:string,t:string)=>{if(!schedId)return;set({schedule:{...s.schedule,[schedId]:{date:d,time:t}}});setSchedId(null);toast('Scheduled')};
  const removeSched=()=>{if(!schedId)return;const ns={...s.schedule};delete ns[schedId];set({schedule:ns});setSchedId(null);toast('Removed')};
  const company = s.profile?.company_name || '';

  return<div className="company-workspace"><CompanyHeader/>
  <BrandTheme/>
  <div className="page-container">
    <section className="studio-options-panel">
      <div className="studio-options-head"><div><span>STUDIO</span><h2>Choose what Sparrow should create.</h2><p>Choose the channels and writing preferences for this generation.</p></div><button className="btn btn-primary" onClick={startGeneration} disabled={generateBusy||!studioPlatforms.length}>{generateBusy?'Starting…':'Generate content'}</button></div>
      <div className="studio-options-grid">
        <div className="studio-option-block"><label>Channels</label><div className="studio-channel-table">{PLATFORMS.map(pl=><button key={pl} type="button" className={studioPlatforms.includes(pl)?'selected':''} onClick={()=>setStudioPlatforms(prev=>prev.includes(pl)?prev.filter(x=>x!==pl):[...prev,pl])}><span className="studio-channel-dot" style={{background:colorFor(pl)[0]}}/><strong>{pl}</strong><span>{studioPlatforms.includes(pl)?'Selected':'Select'}</span></button>)}</div></div>
        <div className="studio-option-block"><label htmlFor="studio-goal">Content goal</label><select id="studio-goal" className="select" value={studioGoal} onChange={e=>setStudioGoal(e.target.value)}><option>Brand / Product Awareness</option><option>Engagement</option></select></div>
        <div className="studio-option-block"><label htmlFor="studio-tone">Brand tone</label><select id="studio-tone" className="select" value={studioTone} onChange={e=>setStudioTone(e.target.value)}><option>Professional</option><option>Friendly</option></select></div>
        <div className="studio-option-block"><label htmlFor="studio-style">Writing style</label><select id="studio-style" className="select" value={studioStyle} onChange={e=>setStudioStyle(e.target.value)}>{STYLES.map(x=><option key={x}>{x}</option>)}</select></div>
        <div className="studio-option-block studio-option-wide"><label htmlFor="studio-extra">Additional instructions</label><textarea id="studio-extra" className="textarea" rows={2} value={studioExtra} onChange={e=>setStudioExtra(e.target.value)} placeholder="Optional: campaigns, facts, offers, locations, or constraints." /></div>
      </div>
    </section>

    {pollError&&<div className="banner" role="alert"><span>{pollError}</span><button className="btn btn-primary btn-sm" onClick={retryGeneration} disabled={retryBusy}>{retryBusy?'Retrying...':'Retry generation'}</button></div>}
    {!pollError&&s.generationStatus==='cancelled'&&<div className="banner warn"><span>Generation cancelled.</span></div>}
    {showUpgrade&&<div className="banner"><span>Regeneration is a Pro feature. Your existing content is safe; upgrade to create an improved version.</span><a className="btn btn-primary btn-sm" href="/pricing">View plans</a><button className="btn btn-ghost btn-sm" onClick={()=>setShowUpgrade(false)}>Close</button></div>}
    {s.jobId && waiting>0 && !pollError && s.generationStatus!=='cancelled' && (() => {
      const received = activeSections.length - waiting;
      const progress = activeSections.length
  ? Math.round((received / activeSections.length) * 100)
  : 0;
      return <div className="studio-generation-strip">
        <div className="studio-generation-main">
          <div className="studio-generation-row"><span>Generating content</span><small>{received} of {SEC_META.length} sections received</small></div>
          <div className="studio-generation-progress" role="progressbar" aria-valuemin={0} aria-valuemax={activeSections.length} aria-valuenow={received}>
            <span style={{width:`${Math.max(8,progress)}%`}} />
          </div>
        </div>
        <button className="btn btn-danger btn-sm" onClick={cancelGeneration} disabled={cancelBusy}>{cancelBusy?'Stopping...':'Cancel'}</button>
      </div>;
    })()}

    {/* Platform filter tabs */}
    <div className="platform-tabs">
      {['all', ...filterChannels].map(rawF => { const f=String(rawF); return (
        <button key={f} className="platform-tab" aria-pressed={filter===f} onClick={()=>setFilter(f)}>
          {f !== 'all' && <PlatformIcon channel={f} />}
          {f === 'all' ? 'All' : f}
          <span className="count">{cnt(f)}</span>
        </button>
      )})}
      <div style={{marginLeft:'auto',display:'flex',gap:8,alignItems:'center'}}>
        <input className="input search" type="search" placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)} style={{maxWidth:200,padding:'7px 12px',fontSize:13}}/>
        <button className="btn btn-ghost btn-sm" onClick={()=>router.push(`/calendar?project=${encodeURIComponent(s.projectId || '')}&job=${encodeURIComponent(s.jobRowId || '')}`)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>
          Calendar
        </button>
      </div>
    </div>

    {/* Content by platform */}
    {Object.entries(byChannel).map(([channel, channelPieces]) => (
      <div key={channel} className="platform-block">
        <div className="platform-block-head">
          <PlatformIcon channel={channel} />
          <div>
            <h3>{channel}</h3>
            <span className="piece-count">{channelPieces.length} piece{channelPieces.length !== 1 ? 's' : ''}</span>
          </div>
          <button className="btn btn-ghost btn-sm" style={{marginLeft:'auto'}} onClick={()=>{
            const text = channelPieces.map(p => p.title + '\n\n' + p.bodyText).join('\n\n---\n\n');
            copyText(text).then(()=>toast('All '+channel+' content copied'));
          }}>Copy all</button>
        </div>

        <div className="platform-piece-grid">
        {channelPieces.map(p => (
          <div key={p.id} className="piece-card">
            <div className="piece-card-inner">
              <div className="piece-preview">
                <SocialMock piece={p} company={company} logo={String(s.brandTheme?.logo_url || '')} brandTheme={s.brandTheme || undefined} media={mediaState[p.id] || (p.mediaUrl ? {url:p.mediaUrl,type:p.mediaType} : undefined)} onGenerate={()=>void generateMedia(p)} busy={Boolean(mediaState[p.id]?.busy)} />
              </div>
              <div className="piece-copy-col">
                <div className="piece-copy-head">
                  <div>
                    <h3 className="piece-title">{p.title}</h3>
                    <div className="piece-meta" style={{marginTop:4}}>
                      <span className="fmt">{p.format || p.section}</span>
                      <span style={{fontSize:11,color:'var(--ink-3)'}}>{p.wordCount} words</span>
                      {s.schedule[p.id] && <span className="sched-badge">{fmtDate(new Date(s.schedule[p.id].date+'T00:00'))}</span>}
                    </div>
                  </div>
                  <div style={{display:'flex',gap:6,flexShrink:0}}>
                    <button className="btn btn-ghost btn-sm" onClick={()=>{copyText(p.title+'\n\n'+p.bodyText).then(()=>toast('Copied'))}}>Copy piece</button>
                    <button className="btn btn-primary btn-sm studio-schedule-button" onClick={()=>openSched(p.id)}>{s.schedule[p.id]?'Move':'Schedule'}</button>
                    <button className="btn btn-ghost btn-sm btn-icon" onClick={()=>setViewId(p.id)} aria-label="Expand">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
                    </button>
                  </div>
                </div>
                <div className="piece-body" dangerouslySetInnerHTML={{__html: sanitizeHtml(p.bodyHtml)}} />
              </div>
            </div>
          </div>
        ))}
        </div>
      </div>
    ))}

    {filter==='all'&&!q&&waiting>0&&<div className="board" style={{marginTop:24}}>{Array.from({length:Math.min(3,waiting)},(_,i)=><div key={'sk'+i} className="skel"/>)}</div>}
    {filtered.length===0&&waiting===0&&<div className="empty">No content for {s.prefs.platforms.join(', ')} yet.</div>}
  </div>

  {/* Detail modal */}
  <Modal open={!!vp} onClose={()=>setViewId(null)}>{vp&&<>
    <div className="m-head"><div style={{flex:1}}>
      <Chip channel={vp.channel}/><span className="fmt" style={{marginLeft:6}}>{vp.format||vp.section}</span>
      <h2 style={{fontSize:20,fontWeight:800,letterSpacing:'-.02em',margin:'8px 0 0'}}>{vp.title}</h2>
    </div><button className="btn btn-ghost btn-icon" onClick={()=>setViewId(null)} aria-label="Close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <div className="m-body">{s.schedule[vp.id]&&<div className="banner" style={{margin:0}}>Scheduled for {fmtDate(new Date(s.schedule[vp.id].date+'T00:00'))} at {fmtTime(s.schedule[vp.id].time)}</div>}{(mediaState[vp.id]?.url||vp.mediaUrl)&&<div className="modal-media-wrap"><MediaView url={String(mediaState[vp.id]?.url||vp.mediaUrl)} type={mediaState[vp.id]?.type||vp.mediaType} alt={vp.title}/></div>}<div className="m-content" dangerouslySetInnerHTML={{__html: sanitizeHtml(vp.bodyHtml)}}/></div>
    <div className="m-foot"><button className="btn btn-ghost" onClick={()=>{copyText(vp.title+'\n\n'+vp.bodyText).then(()=>toast('Copied'))}}>Copy text</button><button className="btn btn-primary" onClick={()=>openSched(vp.id)}>{s.schedule[vp.id]?'Move on calendar':'Schedule'}</button></div>
  </>}</Modal>

  {schedId&&piece(schedId)&&<TimePicker piece={piece(schedId)!} initDate={schedDate} initTime={schedTime} hasExisting={!!s.schedule[schedId]} onSave={saveSched} onRemove={removeSched} onClose={()=>setSchedId(null)}/>}
  </div>;
}
