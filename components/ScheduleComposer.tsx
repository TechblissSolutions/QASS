'use client';

import { cleanGeneratedHtml, cleanGeneratedText, cleanPublishedHtml } from '@/lib/content-cleanup';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Piece, BrandTheme as BrandThemeType } from '@/lib/types';
import SmartLogo from './SmartLogo';
import { getAccessToken } from '@/lib/auth';
import Modal from './Modal';
import { useToast } from './Toast';

type Account={id:string;provider:string;account_name:string;account_handle?:string|null;account_avatar_url?:string|null;username?:string|null;avatar_url?:string|null;status:string};
type Props={open:boolean;onClose:()=>void;projectId:string;piece?:Piece|null;sourceJobId?:string|null;sourcePieceId?:string|null;existing?:any|null;onSaved:()=>void;brandTheme?:Partial<BrandThemeType>|null};

const providerLabels:Record<string,string>={instagram:'Instagram',facebook:'Facebook',linkedin:'LinkedIn',x:'X / Twitter',youtube:'YouTube',wordpress:'WordPress'};
const providers=['instagram','facebook','linkedin','x','youtube','wordpress'] as const;

function stripHtml(v:string){return cleanGeneratedText(String(v||'').replace(/<\s*br\s*\/?\s*>/gi,'\n').replace(/<\s*\/(?:p|div|li|h[1-6])\s*>/gi,'\n').replace(/<\s*li\b[^>]*>/gi,'• ').replace(/<[^>]*>/g,'').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'\"').replace(/&#39;/gi,"'").replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim());}
function zonedTimeToUtc(date:string,time:string,timeZone:string){
  const [y,m,d]=date.split('-').map(Number); const [hh,mm]=time.split(':').map(Number); const guess=Date.UTC(y,m-1,d,hh,mm,0);
  const parts=new Intl.DateTimeFormat('en-US',{timeZone,hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(new Date(guess));
  const get=(type:string)=>Number(parts.find(p=>p.type===type)?.value||0); const asUtc=Date.UTC(get('year'),get('month')-1,get('day'),get('hour')===24?0:get('hour'),get('minute'),get('second')); return new Date(guess-(asUtc-guess)).toISOString();
}

export default function ScheduleComposer({open,onClose,projectId,piece,sourceJobId,sourcePieceId,existing,onSaved,brandTheme}:Props){
  const router=useRouter();
  const toast=useToast();
  const [accounts,setAccounts]=useState<Account[]>([]); const [html,setHtml]=useState(''); const [title,setTitle]=useState(''); const [mediaUrl,setMediaUrl]=useState(''); const [mediaType,setMediaType]=useState('');
  const [date,setDate]=useState(''); const [time,setTime]=useState('19:00'); const [timezone,setTimezone]=useState(Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Kolkata');
  const [selected,setSelected]=useState<string[]>([]); const [fontSize,setFontSize]=useState('16px'); const [fontFamily,setFontFamily]=useState('Inter'); const [loading,setLoading]=useState(false); const [error,setError]=useState(''); const [accountLoading,setAccountLoading]=useState(false);
  const [mediaOpen,setMediaOpen]=useState(false); const [mediaInput,setMediaInput]=useState(''); const [uploading,setUploading]=useState(false); const fileRef=useRef<HTMLInputElement|null>(null); const [platformOpen,setPlatformOpen]=useState(false);
  const brandPrimary=String(brandTheme?.primary_color||'#111827'); const brandSecondary=String(brandTheme?.secondary_color||brandPrimary); const brandBackground=String(brandTheme?.background_color||'#ffffff'); const brandText=String(brandTheme?.text_color||'#111827'); const brandLogo=String(brandTheme?.logo_url||''); const brandFont=String(brandTheme?.font_family||'Inter');

  useEffect(()=>{if(!open)return; const initial=existing?.caption_html ? cleanGeneratedHtml(existing.caption_html) : cleanPublishedHtml(piece?.bodyHtml||`<p>${(piece?.bodyText||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>`); setHtml(initial); setTitle(existing?.title||piece?.title||''); setMediaUrl(existing?.media_url||piece?.mediaUrl||''); setMediaType(existing?.media_type||piece?.mediaType||''); const dt=existing?.scheduled_at?new Date(existing.scheduled_at):new Date(Date.now()+3600000); setDate(dt.toLocaleDateString('en-CA')); setTime(dt.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',hour12:false})); setTimezone(existing?.timezone||Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Kolkata'); setFontFamily(existing?.editor_settings?.fontFamily||brandFont||'Inter'); setFontSize(existing?.editor_settings?.fontSize||'16px'); setSelected(existing?.platforms?.map((x:any)=>x.account_id||x.social_account_id).filter(Boolean)||[]); setError(''); void loadAccounts(); // eslint-disable-line react-hooks/exhaustive-deps
  },[open,existing?.id,piece?.id]);

  async function loadAccounts(){setAccountLoading(true);try{const token=await getAccessToken();const r=await fetch(`/api/scheduling/accounts?project=${encodeURIComponent(projectId)}`,{headers:token?{Authorization:`Bearer ${token}`}:{},cache:'no-store'});const d=await r.json();if(r.ok)setAccounts(d.accounts||[]);}catch{}finally{setAccountLoading(false);}}
  const connectedAccounts=useMemo(()=>accounts.filter(a=>a.status==='connected'),[accounts]);
  const selectedAccounts=connectedAccounts.filter(a=>selected.includes(a.id));
  const accountByProvider=useMemo(()=>{const map=new Map<string,Account>(); for(const a of connectedAccounts){if(!map.has(a.provider)) map.set(a.provider,a);} return map;},[connectedAccounts]);
  const toggle=(id:string)=>setSelected(v=>v.includes(id)?v.filter(x=>x!==id):[...v,id]);
  const exec=(cmd:string,value?:string)=>{document.execCommand(cmd,false,value);const el=document.getElementById('schedule-rich-editor');if(el)setHtml(el.innerHTML);};
  const savedBrand=existing?.editor_settings?.brand_theme||existing?.editor_settings?.brandTheme||null;

  function safeFileName(value:string){return (value||'sparrow-post').replace(/[^a-z0-9-_]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,80)||'sparrow-post';}
  function downloadText(){
    const content = `${title || 'Sparrow social post'}\n\n${stripHtml(cleanGeneratedHtml(html))}\n`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href=url; a.download=`${safeFileName(title || 'sparrow-post')}.txt`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    toast('Text downloaded.');
  }
  async function downloadImage(){
    if(!mediaUrl) return;
    try { const r=await fetch(`/api/scheduling/media-download?url=${encodeURIComponent(mediaUrl)}`); if(!r.ok) throw new Error('Image download failed.'); const blob=await r.blob(); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=`${safeFileName(title || 'sparrow-post')}-image`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); toast('Image downloaded.'); }
    catch(e){ setError(e instanceof Error?e.message:'Image download failed.'); }
  }

  async function uploadFile(file:File){setError('');if(!file.type.startsWith('image/'))return setError('Please choose an image file.');if(file.size>10*1024*1024)return setError('Images must be 10 MB or smaller.');setUploading(true);try{const token=await getAccessToken();const form=new FormData();form.append('projectId',projectId);form.append('file',file);const r=await fetch('/api/scheduling/media-upload',{method:'POST',headers:token?{Authorization:`Bearer ${token}`}:{},body:form});const d=await r.json();if(!r.ok)throw new Error(d.error||'Image upload failed.');setMediaUrl(d.media_url);setMediaType('image');setMediaOpen(false);}catch(e){setError(e instanceof Error?e.message:'Image upload failed.');}finally{setUploading(false);}}

  async function save(){setError('');if(!date||!time)return setError('Choose a date and time.');if(selected.length===0){setError('Choose at least one connected social account.');toast('Please select at least one connected social account.');return;}setLoading(true);try{const token=await getAccessToken();if(!token)throw new Error('Sign in again to schedule this post.');const scheduledAt=zonedTimeToUtc(date,time,timezone);const effectiveBrand=savedBrand||{logo_url:brandLogo||null,primary_color:brandPrimary,secondary_color:brandSecondary,background_color:brandBackground,text_color:brandText,font_family:brandFont};const payload={projectId,sourceJobId:existing?.source_job_id||sourceJobId||null,sourcePieceId:existing?.source_piece_id||sourcePieceId||piece?.id||null,title,captionHtml:cleanGeneratedHtml(html),captionText:stripHtml(cleanGeneratedHtml(html)),mediaUrl:mediaUrl||null,mediaType:mediaType||null,scheduledAt,timezone,editorSettings:{fontSize,fontFamily,use_brand_style:true,brand_theme:effectiveBrand},accountIds:selected};const r=await fetch('/api/scheduling/posts',{method:existing?'PATCH':'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(existing?{...payload,id:existing.id}:payload)});const d=await r.json();if(!r.ok)throw new Error(d.error||'Unable to save schedule.');onSaved();onClose();}catch(e){setError(e instanceof Error?e.message:'Unable to save schedule.');}finally{setLoading(false);}}

  function goToSocialAccounts(provider?:string){
    const label=provider?providerLabels[provider]||provider:'social accounts';
    toast(`Please connect ${label} to use it for this post.`);
    const query=provider?`&connect=${encodeURIComponent(provider)}&social_prompt=1`:'&connect=1&social_prompt=1';
    window.setTimeout(()=>{onClose();router.push(`/profile?project=${encodeURIComponent(projectId)}${query}`);},250);
  }
  if(!open)return null;
  const previewName=selectedAccounts[0]?.account_name||'Your company';
  return <Modal open onClose={onClose}>
    <div className="schedule-composer" style={{'--schedule-brand-primary':brandPrimary,'--schedule-brand-secondary':brandSecondary,'--schedule-brand-background':brandBackground,'--schedule-brand-text':brandText} as React.CSSProperties}>
      <div className="schedule-ref-head"><div><span className="schedule-modal-kicker">{existing?'EDIT POST':'NEW SOCIAL POST'}</span><h2>{title||'Create social post'}</h2></div><button className="schedule-modal-close" onClick={onClose}>×</button></div>
      <div className="schedule-ref-layout">
        <section className="schedule-ref-editor">
          <label className="schedule-ref-label">Post to</label>
          <div className="schedule-postto-wrap">
            <button type="button" className={`schedule-postto ${platformOpen?'is-open':''}`} onClick={()=>setPlatformOpen(v=>!v)} aria-expanded={platformOpen}><span className="schedule-postto-copy"><strong>{selectedAccounts.length ? `${selectedAccounts.length} ${selectedAccounts.length===1?'destination':'destinations'} selected` : 'Choose publishing destinations'}</strong><small>{selectedAccounts.length ? selectedAccounts.map(a=>providerLabels[a.provider]||a.provider).join(' · ') : 'Select the accounts you want Sparrow to publish to'}</small></span><span className="schedule-postto-chevron">⌄</span></button>
            {platformOpen&&<div className="schedule-platform-menu">
              {accountLoading?<div className="schedule-menu-empty">Loading your social accounts…</div>:<>
                <div className="schedule-menu-title"><span>Publishing destinations</span><small>Select one or more connected accounts</small></div>
                {providers.map(provider=>{
                  const a=accountByProvider.get(provider);
                  const connected=Boolean(a);
                  const label=providerLabels[provider];
                  return connected ? (
                    <button className="schedule-account-choice" key={provider} onClick={()=>toggle(a!.id)}>
                      <span className="schedule-menu-check">{selected.includes(a!.id)?'✓':''}</span>
                      <span className="social-account-avatar">{(a!.avatar_url||a!.account_avatar_url)?<img src={a!.avatar_url||a!.account_avatar_url||''} alt=""/>:label.slice(0,1)}</span>
                      <span><strong>{label}</strong><small>{a!.username||a!.account_handle||a!.account_name||'Connected account'}</small></span>
                      <b className="schedule-connected-pill">Connected</b>
                    </button>
                  ) : (
                    <button className="schedule-account-choice schedule-account-choice-disabled" key={provider} onClick={()=>goToSocialAccounts(provider)}>
                      <span className="schedule-menu-check"></span>
                      <span className="social-account-avatar schedule-disconnected-avatar">{label.slice(0,1)}</span>
                      <span><strong>{label}</strong><small>Not connected · Click to connect</small></span>
                      <b className="schedule-not-connected-pill">Not connected</b>
                    </button>
                  );
                })}
                <button className="schedule-manage-accounts" onClick={()=>goToSocialAccounts()}>Manage social accounts →</button>
              </>}
            </div>}
          </div>
          <label className="schedule-ref-label content-label">Type content</label>
          <div className="schedule-ref-contentbox">
            <div id="schedule-rich-editor" className="schedule-rich-editor schedule-ref-rich" contentEditable suppressContentEditableWarning dangerouslySetInnerHTML={{__html:html}} onInput={e=>setHtml(e.currentTarget.innerHTML)} data-placeholder="Write your post here..." />
            <div className="schedule-ref-toolbar"><button type="button" className="schedule-ai-btn" onClick={()=>{setError('AI caption assistance is not connected in this build yet. Your post has not been changed.');toast('AI caption assistance is not configured yet.');}}>✦ AI</button><span className="toolbar-divider"/><select value={fontFamily} onChange={e=>{setFontFamily(e.target.value);exec('fontName',e.target.value)}}><option>Inter</option><option>Arial</option><option>Georgia</option><option>Verdana</option></select><select value={fontSize} onChange={e=>{setFontSize(e.target.value);exec('fontSize',e.target.value==='12px'?'2':e.target.value==='16px'?'3':e.target.value==='20px'?'5':'7')}}><option value="12px">12</option><option value="16px">16</option><option value="20px">20</option><option value="28px">28</option></select><button onMouseDown={e=>{e.preventDefault();exec('bold')}}>B</button><button onMouseDown={e=>{e.preventDefault();exec('italic')}}><i>I</i></button><button onClick={()=>setHtml(v=>v+' #hashtag')}>#</button><button onClick={()=>{const url=window.prompt('Enter link URL');if(url)exec('createLink',url)}}>↗</button><button onClick={()=>setMediaOpen(true)}>▧</button><button onClick={()=>fileRef.current?.click()}>＋</button><button onClick={()=>exec('insertUnorderedList')}>≡</button><input ref={fileRef} type="file" accept="image/*" hidden onChange={e=>{const f=e.target.files?.[0];if(f)void uploadFile(f);e.currentTarget.value='';}} /></div>
          </div>
          <div className="schedule-add-post-box"><div><strong>Add your post</strong><span>Upload your own image instead of the generated media, or keep the generated image.</span></div><div className="schedule-add-post-actions"><button className="btn btn-ghost btn-sm" onClick={downloadText}>Download text</button>{mediaUrl&&<button className="btn btn-ghost btn-sm" onClick={()=>void downloadImage()}>Download image</button>}{mediaUrl&&<button className="btn btn-ghost btn-sm" onClick={()=>{setMediaUrl('');setMediaType('')}}>Remove image</button>}<button className="btn btn-ghost btn-sm" onClick={()=>fileRef.current?.click()}>Upload image</button><button className="btn btn-ghost btn-sm" onClick={()=>setMediaOpen(v=>!v)}>Use image URL</button></div></div>
          {mediaUrl&&<div className="schedule-media-preview"><img src={mediaUrl} alt="Selected post media"/><div><strong>{mediaType==='image'?'Image attached':'Media attached'}</strong><button className="btn btn-ghost btn-sm" onClick={()=>{setMediaUrl('');setMediaType('')}}>Delete</button></div></div>}
          {mediaOpen&&<div className="schedule-image-pop"><input className="input" value={mediaInput} onChange={e=>setMediaInput(e.target.value)} placeholder="Paste a public image URL"/><div><button className="btn btn-ghost btn-sm" onClick={()=>setMediaOpen(false)}>Cancel</button><button className="btn btn-primary btn-sm" onClick={()=>{setMediaUrl(mediaInput.trim());setMediaType(mediaInput.trim()?'image':'');setMediaOpen(false)}}>Use image</button></div></div>}
        </section>
        <aside className="schedule-ref-preview"><div className="schedule-ref-preview-title">Post Preview</div><div className="schedule-ref-tabs"><button className="active">All</button>{selectedAccounts.slice(0,4).map(a=><button key={a.id}>{providerLabels[a.provider]}</button>)}</div><div className="schedule-social-preview" style={{background:brandBackground,color:brandText,fontFamily,fontSize,borderColor:brandPrimary} as React.CSSProperties}><div className="schedule-preview-user"><span className="schedule-preview-avatar">{brandLogo?<SmartLogo src={'/api/brand-logo?src='+encodeURIComponent(brandLogo)} alt="" fallback="B"/>:<b>{previewName.slice(0,1).toUpperCase()}</b>}</span><div><strong>{previewName}</strong><small>{selectedAccounts[0]?.username||selectedAccounts[0]?.account_handle?`@${selectedAccounts[0]?.username||selectedAccounts[0]?.account_handle}`:'Your social account'}</small></div><span className="preview-more">•••</span></div>{mediaUrl?<img src={mediaUrl} alt="Post media"/>:<div className="schedule-preview-empty-media">Your post image will appear here</div>}<div className="schedule-preview-copy" dangerouslySetInnerHTML={{__html:html}}/><div className="schedule-preview-actions">♡　◯　↗　▢</div></div></aside>
      </div>
      <div className="schedule-ref-bottom"><div className="schedule-date-section"><div className="field"><label>Date</label><input className="input" type="date" value={date} min={new Date().toLocaleDateString('en-CA')} onChange={e=>setDate(e.target.value)}/></div><div className="field"><label>Time</label><input className="input" type="time" value={time} onChange={e=>setTime(e.target.value)}/></div><div className="field"><label>Timezone</label><select className="input" value={timezone} onChange={e=>setTimezone(e.target.value)}><option>Asia/Kolkata</option><option>UTC</option><option>America/New_York</option><option>Europe/London</option><option>Asia/Dubai</option><option>Asia/Singapore</option></select></div></div>{error&&<div className="schedule-error">{error}</div>}<div className="m-foot"><button className="btn btn-ghost" onClick={onClose}>Save for later</button><button className="btn btn-primary" disabled={loading||uploading||accountLoading} onClick={save}>{loading?'Scheduling…':existing?'Save changes & schedule':'Schedule post'} <span>⌄</span></button></div></div>
    </div>
  </Modal>;
}
