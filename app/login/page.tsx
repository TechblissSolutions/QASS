'use client';
import { Suspense, FormEvent, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { clearAuthPersistence, getSupabaseClient, setAuthPersistence } from '@/lib/supabase';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/dashboard';
  const destination = redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/dashboard';
  const [email,setEmail]=useState(''); const [password,setPassword]=useState('');
  const [rememberMe,setRememberMe]=useState(true);
  const [error,setError]=useState(''); const [notice,setNotice]=useState(''); const [busy,setBusy]=useState(false);

  async function submit(e:FormEvent){
    e.preventDefault(); setError(''); setNotice(''); setBusy(true);
    try {
      setAuthPersistence(rememberMe);
      const supabase=getSupabaseClient();
      if(!supabase) throw new Error('Authentication is not configured.');
      const {error}=await supabase.auth.signInWithPassword({email:email.trim(),password});
      if(error) throw error;
      router.push(destination);
    } catch(err){
      setError(err instanceof Error?err.message:'Unable to sign in.');
    } finally { setBusy(false); }
  }

  async function resetPassword(){
    if(!email.trim()){setError('Enter your email first, then choose reset password.');return}
    setError('');setNotice('');setBusy(true);
    try { const supabase=getSupabaseClient(); if(!supabase) throw new Error('Authentication is not configured.'); const {error}=await supabase.auth.resetPasswordForEmail(email.trim(),{redirectTo:`${window.location.origin}/login`}); if(error) throw error; setNotice('If that email has a Sparrow account, a reset link is on its way.'); }
    catch(err){setError(err instanceof Error?err.message:'Unable to send a reset link.')} finally{setBusy(false)}
  }

  // Supabase owns the OAuth redirect so provider tokens never pass through
  // Sparrow API routes or custom client-side storage.
  async function signInWithGoogle() {
    setError(''); setBusy(true);
    try {
      const supabase = getSupabaseClient(); if (!supabase) throw new Error('Authentication is not configured.');
      const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}${destination}` } });
      if (error) throw error;
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to continue with Google.'); setBusy(false); }
  }

  return <div className="auth-page"><div className="auth-card">
    <a href="/" className="auth-logo">Sparrow</a><div className="auth-kicker">CONTENT INTELLIGENCE PLATFORM</div>
    <h1>Welcome back.</h1><p>Sign in to access your companies, generated content and workspace history.</p>
    <button className="btn btn-google" type="button" onClick={signInWithGoogle} disabled={busy}><span aria-hidden="true">G</span> Continue with Google</button>
    <div className="auth-divider"><span>or sign in with email</span></div>
    <form onSubmit={submit}>
      <label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="email" /></label>
      <label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required autoComplete="current-password" /></label>
      {error&&<div className="auth-error" role="alert">{error}</div>}{notice&&<div className="auth-notice" role="status">{notice}</div>}
      <button className="btn btn-primary auth-submit" disabled={busy}>{busy?'Signing in…':'Sign in'}</button>
      <label className="remember-row"><input type="checkbox" checked={rememberMe} onChange={e=>setRememberMe(e.target.checked)} /> <span>Remember me</span></label>
    </form>
    <button className="auth-link-button" type="button" onClick={resetPassword} disabled={busy}>Forgot password?</button>
    <div className="auth-footer">New to Sparrow? <a href="/signup">Create an account</a></div>
  </div></div>;
}
export default function LoginPage() { return <Suspense fallback={<div className="auth-page"><div className="auth-card"><h1>Loading…</h1></div></div>}><LoginForm /></Suspense>; }
