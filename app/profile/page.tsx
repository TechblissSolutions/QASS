'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useStore } from '@/lib/store';
import { getAccessToken } from '@/lib/auth';
import { listProjects, updateProject, type ProjectRow } from '@/lib/supabase';
import { companyInitials, companyNameFromUrl } from '@/lib/utils';
import { fetchBrandAppearance } from '@/lib/brand-client';
import SmartLogo from '@/components/SmartLogo';
import AccountMenu from '@/components/AccountMenu';
import StoreLoading from '@/components/StoreLoading';
import { useToast } from '@/components/Toast';

type Provider = { id:'instagram'|'facebook'|'linkedin'|'x'|'youtube'|'wordpress'; label:string; description:string };
type Account={id:string;provider:string;account_name:string;account_handle?:string|null;account_avatar_url?:string|null;username?:string|null;avatar_url?:string|null;status:string};
type AccountResponse={accounts:Account[];providers:Array<{id:string;configured:boolean}>;error?:string};
type UserAccount={user:{id:string;email?:string;fullName?:string|null};role:string;entitlements:{plan:string;maxCompanies:number|null;canRegenerate:boolean;canUseAllFeatures:boolean}};

const providers:Provider[]=[
  {id:'instagram',label:'Instagram',description:'Connect the Instagram business account you want Sparrow to publish to.'},
  {id:'facebook',label:'Facebook',description:'Connect a Facebook Page for publishing.'},
  {id:'linkedin',label:'LinkedIn',description:'Connect your LinkedIn account for publishing.'},
  {id:'x',label:'X / Twitter',description:'Connect the X account you want Sparrow to publish to.'},
  {id:'youtube',label:'YouTube',description:'Connect your YouTube channel for publishing.'},
  {id:'wordpress',label:'WordPress',description:'Connect your WordPress site for publishing.'},
];

function companyName(project:ProjectRow){return String((project.profile as any)?.company_name||companyNameFromUrl(project.url)||'Company');}
function planLabel(plan:string){return plan==='owner'?'Owner':plan==='pro'?'Pro':'Free';}
function color(value:unknown,fallback:string){return String(value||fallback);}

function ProfileContent(){
  const {s,ready}=useStore();
  const router=useRouter();
  const params=useSearchParams();
  const toast=useToast();
  const socialRef=useRef<HTMLElement|null>(null);
  const [projects,setProjects]=useState<ProjectRow[]>([]);
  const [account,setAccount]=useState<UserAccount|null>(null);
  const [selectedId,setSelectedId]=useState<string>(params.get('project')||s.projectId||'');
  const [accounts,setAccounts]=useState<Account[]>([]);
  const [loading,setLoading]=useState(true);
  const [socialLoading,setSocialLoading]=useState(false);
  const [connecting,setConnecting]=useState<string|null>(null);
  const [handleDraft,setHandleDraft]=useState<Record<string,string>>({});
  const [savingHandles,setSavingHandles]=useState(false);
  const [providerConfig,setProviderConfig]=useState<Record<string,boolean>>({});
  const [editingHandle,setEditingHandle]=useState<string|null>(null);

  const selectedProject=useMemo(()=>projects.find(p=>p.id===selectedId)||projects[0]||null,[projects,selectedId]);
  const selectedTheme=(selectedProject?.brand_theme||{}) as Record<string,unknown>;
  const selectedHandles=((selectedProject?.profile as any)?.social_handles||{}) as Record<string,string>;
  const byProvider=useMemo(()=>new Map(accounts.map(a=>[a.provider,a])),[accounts]);
  const connectedCount=accounts.filter(a=>a.status==='connected').length;
  const requestedProvider=params.get('connect');

  async function loadProfile(){
    setLoading(true);
    try{
      const token=await getAccessToken();
      if(!token){router.replace('/login');return;}
      const [rows,accountRes]=await Promise.all([
        listProjects(50,token),
        fetch('/api/account',{headers:{Authorization:`Bearer ${token}`},cache:'no-store'}),
      ]);
      if(!accountRes.ok)throw new Error('Unable to load your profile.');
      const accountData=await accountRes.json() as UserAccount;
      setProjects(rows);setAccount(accountData);
      const requested=params.get('project')||s.projectId;
      const initial=rows.find(p=>p.id===requested)?.id||rows[0]?.id||'';
      setSelectedId(initial);
    }catch(e){toast(e instanceof Error?e.message:'Unable to load your profile.');}
    finally{setLoading(false);}
  }

  async function loadSocial(projectId:string){
    setSocialLoading(true);
    try{
      const token=await getAccessToken();
      const r=await fetch(`/api/scheduling/accounts?project=${encodeURIComponent(projectId)}`,{headers:token?{Authorization:`Bearer ${token}`}:{},cache:'no-store'});
      const d=await r.json() as AccountResponse;
      if(!r.ok)throw new Error(d.error||'Unable to load social connections.');
      setAccounts(d.accounts||[]);
      setProviderConfig(Object.fromEntries((d.providers||[]).map((p)=>[p.id,Boolean(p.configured)])));
    }catch(e){toast(e instanceof Error?e.message:'Unable to load social connections.');}
    finally{setSocialLoading(false);}
  }

  useEffect(()=>{if(ready)void loadProfile();},[ready]);
  useEffect(()=>{if(selectedProject?.id)void loadSocial(selectedProject.id);else setAccounts([]);},[selectedProject?.id]);
  useEffect(()=>{
    if(!selectedProject?.id || !selectedProject.url) return;
    const current=(selectedProject.brand_theme||{}) as Record<string,unknown>;
    const genericPrimary=['#111','#111111','#111827'].includes(String(current.primary_color||'').toLowerCase());
    const genericSecondary=['#64748b','#d8d8d2'].includes(String(current.secondary_color||'').toLowerCase());
    const needsRefresh=!String(current.logo_url||'').trim() || !String(current.primary_color||'').trim() || !String(current.secondary_color||'').trim() || !String(current.background_color||'').trim() || !String(current.text_color||'').trim() || (genericPrimary && genericSecondary);
    if(!needsRefresh) return;
    let alive=true;
    void (async()=>{
      let fetched=await fetchBrandAppearance(selectedProject.url,true);
      if(!fetched || !String((fetched as any).logo_url||'').trim() || !String((fetched as any).primary_color||'').trim()) { await new Promise(resolve=>setTimeout(resolve,650)); fetched=await fetchBrandAppearance(selectedProject.url,true); }
      if(!alive || !fetched) return;
      const merged={...current};
      for(const [key,value] of Object.entries(fetched)){
        if(value===null||value===undefined||String(value).trim()==='') continue;
        const shouldUseFetched=!current[key] || key==='logo_url' || (key==='primary_color'&&genericPrimary) || (key==='secondary_color'&&genericSecondary);
        if(shouldUseFetched) merged[key]=value;
      }
      setProjects(prev=>prev.map(p=>p.id===selectedProject.id?{...p,brand_theme:merged}:p));
      void updateProject(selectedProject.id,{brand_theme:merged}).catch(()=>{});
    })();
    return()=>{alive=false;};
  },[selectedProject?.id,selectedProject?.url]);
  useEffect(()=>{setHandleDraft({...selectedHandles});},[selectedProject?.id]);
  useEffect(()=>{
    const ok=params.get('social_connected');const err=params.get('social_error');const prompt=params.get('social_prompt');
    const requested=params.get('connect');
    if(ok)toast(`${ok} connected successfully.`);
    else if(err)toast(err);
    else if(!loading && prompt && requested && requested!=='1'){toast(`Please connect ${providers.find(p=>p.id===requested)?.label||requested} for this post.`);}
    if((ok||err)&&selectedProject?.id)router.replace(`/profile?project=${encodeURIComponent(selectedProject.id)}&focus=social`);
  },[params,selectedProject?.id,loading]);
  useEffect(()=>{
    if(!loading&&requestedProvider&&socialRef.current){setTimeout(()=>socialRef.current?.scrollIntoView({behavior:'smooth',block:'start'}),120);}
  },[loading,requestedProvider]);

  async function connect(provider:string){
    if(!selectedProject)return;
    setConnecting(provider);
    try{
      const token=await getAccessToken();if(!token)throw new Error('Please sign in again.');
      const r=await fetch(`/api/scheduling/oauth/${provider}?project=${encodeURIComponent(selectedProject.id)}`,{headers:{Authorization:`Bearer ${token}`}});
      const d=await r.json().catch(()=>({}));
      if(r.ok&&d.url){window.location.href=d.url;return;}
      throw new Error(String(d.error||'Unable to start this connection.'));
    }catch(e){toast(e instanceof Error?e.message:'Unable to start the connection.');setConnecting(null);}
  }

  function chooseCompany(id:string){
    setSelectedId(id);
    router.replace(`/profile?project=${encodeURIComponent(id)}`);
  }

  async function saveHandles(){
    if(!selectedProject)return;
    setSavingHandles(true);
    try{
      const clean=Object.fromEntries(providers.map(p=>[p.id,String(handleDraft[p.id]||'').trim()]).filter(([,v])=>v));
      const nextProfile={...((selectedProject.profile||{}) as Record<string,unknown>),social_handles:clean};
      const token=await getAccessToken();
      const updated=await updateProject(selectedProject.id,{profile:nextProfile},token||undefined);
      if(!updated) throw new Error('Unable to save publishing destinations.');
      setProjects(prev=>prev.map(p=>p.id===updated.id?updated:p));
      setEditingHandle(null);
      toast('Publishing destination saved.');
    }catch(e){toast(e instanceof Error?e.message:'Unable to save publishing destination.');}
    finally{setSavingHandles(false);}
  }

  async function disconnect(accountId:string,provider:string){
    if(!selectedProject)return;
    if(!window.confirm(`Disconnect ${providers.find(p=>p.id===provider)?.label||provider} from this company?`))return;
    try{
      const token=await getAccessToken();
      const r=await fetch(`/api/scheduling/accounts?project=${encodeURIComponent(selectedProject.id)}&account=${encodeURIComponent(accountId)}`,{method:'DELETE',headers:token?{Authorization:`Bearer ${token}`}:{}});
      const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.error||'Unable to disconnect this account.');
      setAccounts(prev=>prev.filter(a=>a.id!==accountId));
      toast('Social account disconnected.');
    }catch(e){toast(e instanceof Error?e.message:'Unable to disconnect this account.');}
  }

  function startConnect(provider:string){
    if(!providerConfig[provider]){
      toast(`${providers.find(p=>p.id===provider)?.label||provider} connection is not configured for this Sparrow environment yet.`);
      return;
    }
    void connect(provider);
  }

  if(!ready||loading)return <StoreLoading/>;

  return <div className="sparrow-account-shell">
    <header className="sparrow-account-header"><div className="sparrow-header-left"><button className="sparrow-wordmark" onClick={()=>router.push('/dashboard')} aria-label="Back to Sparrow"><span className="sparrow-mark">S</span><span>sparrow</span></button><nav className="sparrow-global-nav"><button onClick={()=>router.push('/dashboard')}>All companies</button><button onClick={()=>router.push('/analyse?new=1')}>＋ Add company</button></nav></div><AccountMenu compact /></header>
    <main className="page-container profile-page">
      <section className="profile-hero">
        <div>
          <span className="calendar-kicker">PROFILE</span>
          <h1>Your Sparrow profile</h1>
          <p>Manage your companies, Brand Data, publishing accounts, plan and future API access from one place.</p>
        </div>
        <div className="profile-user-card"><div className="profile-user-avatar">{String(account?.user?.fullName||account?.user?.email||'?').slice(0,1).toUpperCase()}</div><div><strong>{account?.user?.fullName||account?.user?.email||'Account'}</strong><span>{account?.user?.email}</span></div></div>
      </section>

      <section className="profile-section">
        <div className="profile-section-head"><div><span>MY COMPANIES</span><h2>Your company workspaces</h2></div><small>{projects.length} {projects.length===1?'company':'companies'}</small></div>
        {projects.length===0?<div className="profile-empty"><strong>No companies yet</strong><span>Add a company from your workspace to get started.</span><button className="btn btn-primary" onClick={()=>router.push('/analyse?new=1')}>＋ Add company</button></div>:<div className="profile-company-grid">
          {projects.map(project=>{const theme=(project.brand_theme||{}) as any;const active=selectedProject?.id===project.id;const name=companyName(project);const cardStyle={'--client-primary':color(theme.primary_color,'#f97316'),'--client-secondary':color(theme.secondary_color,color(theme.primary_color,'#f97316')),'--client-background':color(theme.background_color,'#ffffff'),'--client-text':color(theme.text_color,'#111827'),'--client-muted':color(theme.text_color,'#64748b'),'--client-line':`color-mix(in srgb, ${color(theme.text_color,'#111827')} 18%, ${color(theme.background_color,'#ffffff')})`,'--client-soft':`color-mix(in srgb, ${color(theme.primary_color,'#f97316')} 8%, ${color(theme.background_color,'#ffffff')})`} as React.CSSProperties;return <button key={project.id} style={cardStyle} className={`profile-company-card ${active?'active':''}`} onClick={()=>chooseCompany(project.id)}><span className="profile-company-logo">{theme.logo_url?<SmartLogo src={'/api/brand-logo?src='+encodeURIComponent(String(theme.logo_url))} alt="" fallback={companyInitials(name)}/>:<b>{companyInitials(name)}</b>}</span><span className="profile-company-copy"><strong>{name}</strong><small>{project.url}</small></span><span className="profile-company-arrow">{active?'Selected':'View →'}</span></button>})}
        </div>}
      </section>

      {selectedProject&&<>
        <section className="profile-company-detail" style={{'--client-primary':color(selectedTheme.primary_color,'#f97316'),'--client-secondary':color(selectedTheme.secondary_color,color(selectedTheme.primary_color,'#f97316')),'--client-background':color(selectedTheme.background_color,'#ffffff'),'--client-text':color(selectedTheme.text_color,'#111827'),'--client-muted':color(selectedTheme.text_color,'#64748b'),'--client-line':`color-mix(in srgb, ${color(selectedTheme.text_color,'#111827')} 18%, ${color(selectedTheme.background_color,'#ffffff')})`,'--client-soft':`color-mix(in srgb, ${color(selectedTheme.primary_color,'#f97316')} 8%, ${color(selectedTheme.background_color,'#ffffff')})`} as React.CSSProperties}>
          <div className="profile-detail-heading"><div><span>COMPANY PROFILE</span><h2>{companyName(selectedProject)}</h2><p>{selectedProject.url}</p></div><button className="btn btn-ghost" onClick={()=>router.push(`/studio?project=${encodeURIComponent(selectedProject.id)}`)}>Open workspace</button></div>
          <div className="profile-detail-grid">
            <section className="profile-panel profile-brand-panel">
              <div className="profile-panel-head"><div><span>BRAND DATA</span><h3>Your saved brand identity</h3></div><button className="btn btn-ghost btn-sm" onClick={()=>router.push(`/brand?project=${encodeURIComponent(selectedProject.id)}`)}>Open Brand Data</button></div>
              <div className="profile-brand-preview"><div className="profile-brand-logo">{selectedTheme.logo_url?<SmartLogo src={'/api/brand-logo?src='+encodeURIComponent(String(selectedTheme.logo_url))} alt="" fallback={companyInitials(companyName(selectedProject))}/>:<b>{companyInitials(companyName(selectedProject))}</b>}</div><div><strong>{companyName(selectedProject)}</strong><span>{String((selectedProject.profile as any)?.company_summary||'Saved company identity and brand settings.')}</span></div></div>
              <div className="profile-color-row"><div><span>Primary</span><b style={{background:color(selectedTheme.primary_color,'#111827')}}/></div><div><span>Secondary</span><b style={{background:color(selectedTheme.secondary_color,'#64748b')}}/></div><div><span>Background</span><b style={{background:color(selectedTheme.background_color,'#ffffff')}}/></div><div><span>Text</span><b style={{background:color(selectedTheme.text_color,'#111827')}}/></div></div>
              <div className="profile-brand-meta"><span>Font</span><strong>{String(selectedTheme.font_family||'Inter')}</strong></div>
            </section>

            <section className="profile-panel profile-plan-panel">
              <div className="profile-panel-head"><div><span>SUBSCRIPTION</span><h3>Your current plan</h3></div></div>
              <div className="profile-plan-badge">{planLabel(account?.entitlements.plan||'free')}</div>
              <p>{account?.entitlements.plan==='pro'?'You have access to Sparrow Pro features.':'You are currently using the Sparrow Free plan.'}</p>
              <div className="profile-plan-facts"><div><span>Company workspaces</span><strong>{account?.entitlements.maxCompanies==null?'Unlimited':account.entitlements.maxCompanies}</strong></div><div><span>Regeneration</span><strong>{account?.entitlements.canRegenerate?'Included':'Limited'}</strong></div></div>
              <button className="btn btn-ghost" onClick={()=>router.push('/pricing')}>View plans & billing</button>
            </section>
          </div>
        </section>

        <section ref={socialRef} className="profile-section profile-social-section">
          <div className="profile-section-head"><div><span>SOCIAL CONNECTIONS</span><h2>{companyName(selectedProject)} publishing accounts</h2><p>Connect only the platforms you want Sparrow to publish to. You do not need to connect all of them.</p></div><strong className="profile-connected-count">{connectedCount} connected</strong></div>
          {socialLoading?<div className="profile-loading-row">Loading your connections…</div>:<div className="social-connect-grid-page">{providers.map(p=>{const a=byProvider.get(p.id);const connected=a?.status==='connected'||a?.status==='expired';const expired=a?.status==='expired';const focus=requestedProvider===p.id;return <article key={p.id} className={`social-connect-card ${connected?'connected':''} ${focus?'focus':''}`}><div className="social-connect-card-head"><div className={`social-provider-icon social-provider-${p.id}`}>{p.label.slice(0,1)}</div><div className="social-connect-card-copy"><div className="social-card-title-row"><h2>{p.label}</h2>{connected&&<span className="social-card-status">{expired?'Reconnect required':'Connected'}</span>}</div></div></div>{connected?<div className="social-connected-row"><div className="social-connected-avatar">{(a?.avatar_url||a?.account_avatar_url)?<img src={a.avatar_url||a.account_avatar_url||''} alt=""/>:<span>{p.label.slice(0,1)}</span>}</div><div className="social-connected-identity"><strong>{a?.account_name||p.label}</strong><span>{a?.username||a?.account_handle||'Connected account'}</span></div><div className="social-card-actions"><button className="profile-reconnect" disabled={connecting===p.id} onClick={()=>void startConnect(p.id)}>{connecting===p.id?'Connecting…':expired?'Reconnect account':'Reconnect'}</button><button className="profile-disconnect" onClick={()=>void disconnect(a!.id,p.id)}>Disconnect</button></div></div>:<div className="social-disconnected-body"><div className="social-connect-actions"><button className="social-connect-big" disabled={connecting===p.id} onClick={()=>startConnect(p.id)}>{connecting===p.id?'Connecting…':'Connect'}</button></div></div>}</article>})}</div>}
        </section>

      </>}

      <section className="profile-section profile-api-section profile-api-global">
        <div className="profile-section-head"><div><span>API ACCESS</span><h2>Connect Sparrow to your own systems</h2><p>API access belongs to your Sparrow account and can be configured here when the feature is released.</p></div><span className="profile-coming-soon">Coming soon</span></div>
        <div className="profile-api-card"><div className="profile-api-icon">API</div><div><strong>Account-level API access</strong><span>Future API keys and integration credentials will be managed globally for your Sparrow account, independent of individual companies.</span></div><button className="btn btn-ghost" disabled>Configure later</button></div>
      </section>

      <button className="btn btn-ghost profile-back" onClick={()=>router.push('/dashboard')}>← Back to My Companies</button>
    </main>
  </div>;
}

export default function ProfilePage(){return <Suspense fallback={<StoreLoading/>}><ProfileContent/></Suspense>}
