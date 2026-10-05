'use client';
import { Suspense, useEffect, useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { DEFAULT_PREFS, useStore } from '@/lib/store';
import { getAccessToken } from '@/lib/auth';
import { updateProject } from '@/lib/supabase';
import { parseForm2Html } from '@/lib/parser';
import { normaliseUrl } from '@/lib/utils';
import StoreLoading from '@/components/StoreLoading';

const STEPS=[{at:0,l:'Opening the website'},{at:8,l:'Reading pages and offers'},{at:22,l:'Building your brand profile'},{at:40,l:'Preparing your profile for review'}];

export default function AnalysePageWrapper() {
  return <Suspense fallback={<StoreLoading />}><AnalysePage /></Suspense>;
}

function AnalysePage() {
  const {s,set,ready,reset}=useStore();
  const router=useRouter();
  const searchParams=useSearchParams();
  const [sec,setSec]=useState(0);
  const [err,setErr]=useState('');
  const [mounted,setMounted]=useState(false);
  const [urlInput,setUrlInput]=useState('');
  const abortRef=useRef<AbortController|null>(null);
  const ran=useRef(false);
  const t0=useRef(Date.now());
  const isNew=searchParams.get('new')==='1';
  const [newReady,setNewReady]=useState(!isNew);

  useEffect(()=>{setMounted(true)},[]);
  useEffect(()=>{const t=setInterval(()=>setSec(Math.floor((Date.now()-t0.current)/1000)),500);return()=>clearInterval(t)},[]);

  // /analyse?new=1 is an explicit clean start for another company.
  useEffect(()=>{
    if(!ready || !isNew) return;
    reset();
    setNewReady(true);
  },[ready,isNew]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(()=>{
    if(!ready || (isNew && !newReady) || !s.url) return;
    if(ran.current) return;
    ran.current=true;
    if(!s.url){ran.current=false;return;}
    const ac=new AbortController();abortRef.current=ac;
    (async()=>{try{
      const token=await getAccessToken();
      if(!token){ router.replace('/login?redirect='+encodeURIComponent('/analyse?new=1')); return; }
      const headers:Record<string,string>={'Content-Type':'application/json'};
      if(token) headers.Authorization=`Bearer ${token}`;
      const res=await fetch('/api/analyse',{method:'POST',headers,body:JSON.stringify({url:s.url}),signal:ac.signal});
      if(!res.ok){const e=await res.json().catch(()=>({error:'Status '+res.status}));if(res.status===402)throw new Error((e.error||'You have reached your company limit.')+' Visit /pricing to view plans.');throw new Error(e.error||`Analysis failed (${res.status}).`)}
      const data=await res.json();
      const html=String(data.html||'');
      const profile=parseForm2Html(html);
      if(!profile.company_name&&!profile.company_summary)throw new Error('No brand data returned. Check the analysis workflow and try again.');
      set({projectId:data.projectId||null,jobRowId:null,profile,prefs:{...DEFAULT_PREFS},jobId:null,generationRequestId:null,jobStarted:0,generationStatus:'idle',sections:{},schedule:{},brandTheme:null});
      if(data.projectId)await updateProject(String(data.projectId),{profile,prefs:DEFAULT_PREFS},token||undefined);
      router.push(data.projectId?`/brand?project=${encodeURIComponent(data.projectId)}`:'/brand');
    }catch(e:unknown){if(e instanceof DOMException&&e.name==='AbortError')return;setErr(e instanceof Error?e.message:'Analysis failed.');}})();
    return()=>ac.abort();
  },[ready,isNew,newReady,s.url,router,set]);

  function startAnalysis(){
    setErr('');
    const url=normaliseUrl(urlInput);
    if(!url){setErr("Enter a valid company website, like yourcompany.com");return;}
    set({url});
  }

  if(!ready)return <StoreLoading/>;
  if(!s.url){
    return <div className="center-page analyse-page"><div className="work-card analyse-card"><div className="analyse-inner"><div className="auth-kicker">ANALYSE WEBSITE</div><h2>Start with your company website.</h2><p className="analyse-copy">Sparrow will analyse the website, build the company profile and save it as a workspace you can return to.</p><div className="analyse-urlbar"><div className="analyse-url-input"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-6.3-3.8-9S9.5 5.7 12 3z"/></svg><input autoFocus type="url" placeholder="yourcompany.com" value={urlInput} onChange={e=>setUrlInput(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')startAnalysis()}}/></div><button className="btn btn-primary analyse-submit" onClick={startAnalysis}>Analyse website</button></div>{err&&<p className="err" role="alert">{err}</p>}<div className="analyse-back"><button className="btn btn-ghost" onClick={()=>router.push('/dashboard')}>← Back to workspace</button></div></div></div></div>;
  }

  if(err)return <div className="center-page"><div className="work-card"><h2>Something went wrong</h2><p className="err" role="alert">{err}</p><div style={{display:'flex',gap:8,justifyContent:'center',marginTop:18}}><button className="btn btn-ghost" onClick={()=>{abortRef.current?.abort();reset();router.push('/dashboard')}}>Back to workspace</button><button className="btn btn-primary" onClick={()=>{ran.current=false;setErr('');set({url:s.url})}}>Try again</button></div></div></div>;

  const progressPercent=Math.min(92,Math.max(8,12+sec*0.72));
  const activeStep=STEPS.reduce((idx,step,i)=>sec>=step.at?i:idx,0);
  return <div className="center-page analyse-page"><div className="work-card analyse-card analyse-loading-card" role="status" aria-live="polite"><div className="analyse-loading-inner"><div className="analyse-kicker">ANALYSING WEBSITE</div><h2>Reading your website</h2><div className="analyse-url">{mounted?s.url:''}</div><div className="analyse-progress-track" aria-label="Analysis progress"><div className="analyse-progress-fill" style={{width:`${progressPercent}%`}}/></div><div className="analyse-steps">{STEPS.map((st,i)=><div key={i} className={`analyse-step ${i<activeStep?'done':''} ${i===activeStep?'current':''}`}><span className="analyse-step-icon">{i<activeStep?'✓':i===activeStep?'•':''}</span><span>{st.l}</span></div>)}</div><div className="analyse-loading-footer"><span>Building your company profile</span><button className="btn btn-danger btn-sm" onClick={()=>{abortRef.current?.abort();reset();router.push('/dashboard')}}>Cancel analysis</button></div></div></div></div>;
}
