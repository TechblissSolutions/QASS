'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store';
import { getAccessToken } from '@/lib/auth';
import { updateProject } from '@/lib/supabase';
import type { BrandTheme } from '@/lib/types';
import StoreLoading from '@/components/StoreLoading';
import CompanyHeader from '@/components/CompanyHeader';
import SmartLogo from '@/components/SmartLogo';

export default function BrandPage() {
  const {s,set,ready,loadProject}=useStore();const router=useRouter();const[err,setErr]=useState('');const[saveBusy,setSaveBusy]=useState(false);const[saved,setSaved]=useState(false);
  const p=s.profile;

  useEffect(()=>{
    if(!ready||typeof window==='undefined') return;
    void (async()=>{
      const token=await getAccessToken();
      if(!token){
        router.replace('/login?redirect='+encodeURIComponent(window.location.pathname+window.location.search));
        return;
      }
      const projectId=new URLSearchParams(window.location.search).get('project');
      if(projectId && projectId!==s.projectId){ void loadProject(projectId); return; }
      if(!projectId&&!p) router.replace('/dashboard');
    })();
  },[p,ready,router,s.projectId,loadProject]);

  useEffect(()=>{
    if(!p?.company_website) return;
    void (async()=>{
      const token = await getAccessToken();
      if (!token) return;
      const response = await fetch('/api/brand-appearance?url='+encodeURIComponent(p.company_website), { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      if (!response.ok) throw new Error('Brand appearance lookup failed.');
      const theme = await response.json() as BrandTheme;
      set({ brandTheme: theme });
    })().catch(()=>{});
  },[p?.company_website]); // eslint-disable-line



  if(!ready)return <StoreLoading/>;
  if(!p)return null;
  const up=(k:string,v:string)=>set({profile:{...p,[k]:v}});
  const saveProfile=async()=>{
    if(!s.projectId) return;
    setErr('');setSaved(false);setSaveBusy(true);
    try{
      const token=await getAccessToken();
      const updated=await updateProject(s.projectId,{profile:p,brand_theme:s.brandTheme},token||undefined);
      if(updated) set({profile:(updated.profile as unknown as typeof p)||p,brandTheme:(updated.brand_theme as BrandTheme|null)||s.brandTheme});
      setSaved(true);
    }catch(e:unknown){setErr(e instanceof Error?e.message:'Could not save profile.');}
    finally{setSaveBusy(false);}
  };


  return<div className="company-workspace"><CompanyHeader/><div className="page-container brand-data-page">
    <div className="page-head brand-data-head"><div><div className="auth-kicker">COMPANY PROFILE</div><h1>Brand Data</h1><p>Review the company information Sparrow uses when creating content.</p></div><div className="brand-data-actions"><a className="source" href={p.company_website} target="_blank" rel="noopener"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-6.3-3.8-9S9.5 5.7 12 3z"/></svg>{p.company_website}</a><button className="btn btn-primary brand-save-button" onClick={saveProfile} disabled={saveBusy}>{saveBusy?'Saving profile...':saved?'Profile saved':'Save profile'}</button></div></div>

    <div className="brand-identity"><div className="brand-identity-logo">{s.brandTheme?.logo_url?<SmartLogo src={'/api/brand-logo?src='+encodeURIComponent(s.brandTheme.logo_url)} alt={p.company_name}/>:<span>{p.company_name.slice(0,1).toUpperCase()}</span>}</div><div><strong>{p.company_name}</strong><span>{s.brandTheme?.logo_url?'Website logo detected':'Logo could not be detected from the website'}</span></div><div className="brand-swatches">{[s.brandTheme?.primary_color,s.brandTheme?.secondary_color,s.brandTheme?.background_color,s.brandTheme?.text_color].filter(Boolean).map(c=><span key={c} title={c} style={{background:c as string}}/>)}</div></div>

    <div className="brand-profile-panel panel"><div className="panel-head"><div><h2>Profile</h2><p>Everything here is editable.</p></div><span className="brand-data-save-note">Save changes before leaving this page.</span></div><div className="panel-body">
      <div className="fields">
        <div className="field"><label htmlFor="fn">Company name</label><input className="input" id="fn" value={p.company_name} onChange={e=>{setSaved(false);set({profile:{...p,company_name:e.target.value}})}}/></div>
        <div className="field"><label htmlFor="fp">Product or service</label><input className="input" id="fp" value={p.product} onChange={e=>{setSaved(false);set({profile:{...p,product:e.target.value}})}}/></div>
        <div className="field wide"><label htmlFor="fs">Summary</label><textarea className="textarea" id="fs" rows={4} value={p.company_summary} onChange={e=>{setSaved(false);set({profile:{...p,company_summary:e.target.value}})}}/></div>
        <div className="field wide"><label htmlFor="fd">Company details</label><textarea className="textarea" id="fd" rows={7} value={p.company_details} onChange={e=>{setSaved(false);set({profile:{...p,company_details:e.target.value}})}}/></div>
        <div className="field wide"><label htmlFor="fa">Target audience</label><textarea className="textarea" id="fa" rows={4} value={p.target_audience} onChange={e=>{setSaved(false);set({profile:{...p,target_audience:e.target.value}})}}/></div>
      </div>
      <div className="brand-profile-footer"><div>{err&&<p className="err" role="alert">{err}</p>}{!err&&saved&&<span className="brand-saved">✓ Profile saved successfully.</span>}</div><button className="btn btn-primary" onClick={saveProfile} disabled={saveBusy}>{saveBusy?'Saving profile...':saved?'Saved':'Save profile'}</button></div>
    </div></div>

    <div className="brand-next-card"><div><span className="auth-kicker">NEXT STEP</span><h2>Ready to create content?</h2><p>Open Studio to choose channels, set writing preferences and generate content.</p></div><button className="btn btn-primary" onClick={()=>router.push(`/studio?project=${encodeURIComponent(s.projectId || '')}`)}>Open Studio</button></div>
  </div></div>;
}
