'use client';
import AuthScene from '@/components/fx/AuthScene';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getSupabaseClient, setAuthPersistence } from '@/lib/supabase';

function PasswordEyeIcon({ visible }: { visible: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {visible ? <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"/><circle cx="12" cy="12" r="2.7"/></> : <><path d="M3 3l18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10.7 10.7 0 0 1 12 5c5.2 0 8.8 4.6 9.5 6-.3.7-1.5 2.4-3.5 3.8"/><path d="M6.2 6.2C4.1 7.6 2.8 9.7 2.5 11c.7 1.4 4.3 6 9.5 6 1 0 1.9-.2 2.8-.5"/></>}
  </svg>;
}

export default function SignupPage(){
  const router=useRouter();
  const[fullName,setFullName]=useState('');const[email,setEmail]=useState('');const[password,setPassword]=useState('');const[confirm,setConfirm]=useState('');const[showPassword,setShowPassword]=useState(false);const[showConfirm,setShowConfirm]=useState(false);
  const[rememberMe,setRememberMe]=useState(true);const[error,setError]=useState('');const[notice,setNotice]=useState('');const[busy,setBusy]=useState(false);const[otp,setOtp]=useState('');const[awaitingOtp,setAwaitingOtp]=useState(false);
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
      else { setAwaitingOtp(true); setNotice('We sent a verification code to your email. Enter the code to verify your account.'); }
    }catch(err){setError(err instanceof Error?err.message:'Unable to create account.')}finally{setBusy(false)}
  }

  async function verifySignupOtp(e: FormEvent) {
    e.preventDefault(); setError(''); setNotice('');
    if (!/^\d{6}$/.test(otp.trim())) { setError('Enter the 6-digit code from your email.'); return; }
    setBusy(true);
    try {
      const supabase = getSupabaseClient(); if (!supabase) throw new Error('Authentication is not configured.');
      const { data, error } = await supabase.auth.verifyOtp({ email: email.trim(), token: otp.trim(), type: 'signup' });
      if (error) throw error;
      if (!data.session) throw new Error('Email verified, but no session was created. Please sign in.');
      const redirect = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('redirect') : null;
      const destination = redirect && redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/dashboard';
      router.push(destination);
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to verify your email.'); }
    finally { setBusy(false); }
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
  return <div className="auth-page"><AuthScene /><div className="auth-card">
    <a href="/" className="auth-logo">Sparrow by TechBliss</a><div className="auth-kicker">START YOUR WORKSPACE</div>
    <h1>Create your account.</h1><p>Keep company research and generated content safely tied to your account.</p>
    <button className="btn btn-google" type="button" onClick={signUpWithGoogle} disabled={busy}><span aria-hidden="true">G</span> Continue with Google</button>
    <div className="auth-divider"><span>or create with email</span></div>
    {!awaitingOtp && <form onSubmit={submit}>
      <label>Full name<input type="text" value={fullName} onChange={e=>setFullName(e.target.value)} required autoComplete="name" /></label>
      <label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="email" /></label>
      <label>Password<div className="auth-password-row"><input type={showPassword?"text":"password"} value={password} onChange={e=>setPassword(e.target.value)} required autoComplete="new-password" /><button type="button" onClick={()=>setShowPassword(v=>!v)} aria-label={showPassword?"Hide password":"Show password"}><PasswordEyeIcon visible={showPassword} /></button></div></label>
      <label>Confirm password<div className="auth-password-row"><input type={showConfirm?"text":"password"} value={confirm} onChange={e=>setConfirm(e.target.value)} required autoComplete="new-password" /><button type="button" onClick={()=>setShowConfirm(v=>!v)} aria-label={showConfirm?"Hide password":"Show password"}><PasswordEyeIcon visible={showConfirm} /></button></div></label>
      {error&&<div className="auth-error" role="alert">{error}</div>}{notice&&<div className="auth-notice" role="status">{notice}</div>}
      <button className="btn btn-primary auth-submit" disabled={busy}>{busy?'Creating…':'Create account'}</button>
      <label className="remember-row"><input type="checkbox" checked={rememberMe} onChange={e=>setRememberMe(e.target.checked)} /> <span>Remember me on this device</span></label>
    </form>}
    {awaitingOtp && <form onSubmit={verifySignupOtp}>
      <label>6-digit email verification code<input type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={e=>setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} required /></label>
      {error&&<div className="auth-error" role="alert">{error}</div>}
      {notice&&<div className="auth-notice" role="status">{notice}</div>}
      <button className="btn btn-primary auth-submit" disabled={busy}>{busy?'Verifying…':'Verify email'}</button>
    </form>}
    <div className="auth-footer">Already have an account? <a href="/login">Sign in</a></div>
  </div></div>
}
