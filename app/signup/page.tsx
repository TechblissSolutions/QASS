'use client';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseClient, setAuthPersistence } from '@/lib/supabase';

export default function SignupPage(){
  const router=useRouter();
  const[fullName,setFullName]=useState('');const[email,setEmail]=useState('');const[password,setPassword]=useState('');const[confirm,setConfirm]=useState('');
  const[rememberMe,setRememberMe]=useState(true);const[error,setError]=useState('');const[notice,setNotice]=useState('');const[busy,setBusy]=useState(false);
  async function submit(e:FormEvent){
    e.preventDefault();setError('');setNotice('');
    if(password.length<8){setError('Password must be at least 8 characters.');return}
    if(password!==confirm){setError('Passwords do not match.');return}
    setBusy(true);
    try{
      setAuthPersistence(rememberMe);
      const supabase=getSupabaseClient();if(!supabase)throw new Error('Authentication is not configured.');
      const{data,error}=await supabase.auth.signUp({email:email.trim(),password,options:{data:{full_name:fullName.trim()}}});if(error)throw error;
      if(data.session){ const redirect = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('redirect') : null; const destination = redirect && redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/dashboard'; router.push(destination); }
      else setNotice('Account created. Check your email to confirm your account, then sign in. Your company data will stay tied to this account.');
    }catch(err){setError(err instanceof Error?err.message:'Unable to create account.')}finally{setBusy(false)}
  }
  // Keep provider auth on the managed OAuth redirect; Sparrow only receives
  // the authenticated session callback and returns the user to the workspace.
  async function signUpWithGoogle() {
    setError(''); setBusy(true);
    try {
      const supabase = getSupabaseClient(); if (!supabase) throw new Error('Authentication is not configured.');
      const redirect = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('redirect') : null;
      const destination = redirect && redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/dashboard';
      const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}${destination}` } });
      if (error) throw error;
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to continue with Google.'); setBusy(false); }
  }
  return <div className="auth-page"><div className="auth-card">
    <a href="/" className="auth-logo">Sparrow</a><div className="auth-kicker">START YOUR WORKSPACE</div>
    <h1>Create your account.</h1><p>Keep company research and generated content safely tied to your account.</p>
    <button className="btn btn-google" type="button" onClick={signUpWithGoogle} disabled={busy}><span aria-hidden="true">G</span> Continue with Google</button>
    <div className="auth-divider"><span>or create with email</span></div>
    <form onSubmit={submit}>
      <label>Full name<input type="text" value={fullName} onChange={e=>setFullName(e.target.value)} required autoComplete="name" /></label>
      <label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="email" /></label>
      <label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required autoComplete="new-password" /></label>
      <label>Confirm password<input type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} required autoComplete="new-password" /></label>
      {error&&<div className="auth-error" role="alert">{error}</div>}{notice&&<div className="auth-notice" role="status">{notice}</div>}
      <button className="btn btn-primary auth-submit" disabled={busy}>{busy?'Creating…':'Create account'}</button>
      <label className="remember-row"><input type="checkbox" checked={rememberMe} onChange={e=>setRememberMe(e.target.checked)} /> <span>Remember me on this device</span></label>
    </form>
    <div className="auth-footer">Already have an account? <a href="/login">Sign in</a></div>
  </div></div>
}
