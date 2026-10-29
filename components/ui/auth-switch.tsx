"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient, setAuthPersistence } from "@/lib/supabase";

type Mode = "signin" | "signup";

/* ── small inline icons (no extra dependency) ───────────────────────────── */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
const MailIcon = () => <Icon><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" /></Icon>;
const LockIcon = () => <Icon><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></Icon>;
const UserIcon = () => <Icon><circle cx="12" cy="8" r="3.6" /><path d="M4.5 20c.8-3.6 3.8-5.5 7.5-5.5s6.7 1.9 7.5 5.5" /></Icon>;
const EyeIcon = ({ visible }: { visible: boolean }) => (
  <Icon>
    {visible ? (
      <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.7" /></>
    ) : (
      <><path d="M3 3l18 18" /><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 5.2A10.7 10.7 0 0 1 12 5c5.2 0 8.8 4.6 9.5 6-.3.7-1.5 2.4-3.5 3.8" /><path d="M6.2 6.2C4.1 7.6 2.8 9.7 2.5 11c.7 1.4 4.3 6 9.5 6 1 0 1.9-.2 2.8-.5" /></>
    )}
  </Icon>
);

/* Only same-site paths are accepted as a post-login destination. */
function getDestination() {
  if (typeof window === "undefined") return "/dashboard";
  const redirect = new URLSearchParams(window.location.search).get("redirect");
  return redirect && redirect.startsWith("/") && !redirect.startsWith("//") ? redirect : "/dashboard";
}

function PasswordInput(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  autoComplete: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="as-field">
      <span className="as-field-icon"><LockIcon /></span>
      <input
        type={show ? "text" : "password"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        aria-label={props.placeholder}
        autoComplete={props.autoComplete}
        required
      />
      <button
        type="button"
        className="as-eye"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? "Hide password" : "Show password"}
      >
        <EyeIcon visible={show} />
      </button>
    </div>
  );
}

export default function AuthSwitch({ initialMode = "signin" }: { initialMode?: Mode }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [rememberMe, setRememberMe] = useState(true);

  // sign in
  const [siEmail, setSiEmail] = useState("");
  const [siPassword, setSiPassword] = useState("");

  // sign up
  const [fullName, setFullName] = useState("");
  const [suEmail, setSuEmail] = useState("");
  const [suPassword, setSuPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [awaitingOtp, setAwaitingOtp] = useState(false);
  const [otp, setOtp] = useState("");

  const isSignUp = mode === "signup";

  function switchMode(next: Mode) {
    if (next === mode) return;
    setError("");
    setNotice("");
    setMode(next);
    // keep the URL honest (/login <-> /signup) and preserve ?redirect=
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `${next === "signup" ? "/signup" : "/login"}${window.location.search}`);
    }
  }

  async function handleSignIn(e: FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      setAuthPersistence(rememberMe);
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Authentication is not configured.");
      const { data, error } = await supabase.auth.signInWithPassword({ email: siEmail.trim(), password: siPassword });
      if (error) throw error;
      if (data.session?.access_token && typeof window !== "undefined") {
        let deviceId = window.localStorage.getItem("qass_device_id");
        if (!deviceId) {
          deviceId = `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
          window.localStorage.setItem("qass_device_id", deviceId);
        }
        // A failed alert must not prevent a valid sign-in.
        void fetch("/api/security/login-alert", {
          method: "POST",
          headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId }),
        }).catch(() => undefined);
      }
      router.push(getDestination());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!siEmail.trim()) {
      setError("Enter your email first, then choose forgot password.");
      return;
    }
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Authentication is not configured.");
      const { error } = await supabase.auth.resetPasswordForEmail(siEmail.trim(), {
        redirectTo: `${window.location.origin}/login`,
      });
      if (error) throw error;
      setNotice("If that email has a Sparrow by TechBliss account, a reset link is on its way.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send a reset link.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSignUp(e: FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    if (suPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (suPassword !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      setAuthPersistence(rememberMe);
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Authentication is not configured.");
      const { data, error } = await supabase.auth.signUp({
        email: suEmail.trim(),
        password: suPassword,
        options: { data: { full_name: fullName.trim() } },
      });
      if (error) throw error;
      if (data.session) {
        router.push(getDestination());
      } else {
        setAwaitingOtp(true);
        setNotice("We sent a verification code to your email. Enter the code to verify your account.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create account.");
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp(e: FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    if (!/^\d{6}$/.test(otp.trim())) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setBusy(true);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Authentication is not configured.");
      const { data, error } = await supabase.auth.verifyOtp({ email: suEmail.trim(), token: otp.trim(), type: "signup" });
      if (error) throw error;
      if (!data.session) throw new Error("Email verified, but no session was created. Please sign in.");
      router.push(getDestination());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to verify your email.");
    } finally {
      setBusy(false);
    }
  }

  // Supabase owns the OAuth redirect so provider tokens never touch Sparrow routes.
  async function handleGoogle() {
    setError("");
    setBusy(true);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error("Authentication is not configured.");
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${window.location.origin}${getDestination()}` },
      });
      if (error) throw error;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to continue with Google.");
      setBusy(false);
    }
  }

  const messages = (
    <>
      {error && <div className="auth-error as-msg" role="alert">{error}</div>}
      {notice && <div className="auth-notice as-msg" role="status">{notice}</div>}
    </>
  );

  const googleButton = (label: string) => (
    <button type="button" className="as-google" onClick={handleGoogle} disabled={busy}>
      <span aria-hidden="true">G</span> {label}
    </button>
  );

  return (
    <div className="auth-switch">
      <style>{AUTH_SWITCH_CSS}</style>

      <div className={isSignUp ? "as-card is-signup" : "as-card"}>
        <div className="as-sweep" aria-hidden="true"><i /><i /><i /></div>
        <div className="as-forms">
          {/* ── Sign in ─────────────────────────────────────────────── */}
          <form
            className={`as-form${!isSignUp ? " is-active" : ""}`}
            onSubmit={handleSignIn}
            aria-hidden={isSignUp}
          >
            <h2 className="as-title">Welcome back.</h2>
            <p className="as-sub">Sign in to your companies, content and workspace history.</p>

            {googleButton("Continue with Google")}
            <div className="as-divider"><span>or sign in with email</span></div>

            <div className="as-field">
              <span className="as-field-icon"><MailIcon /></span>
              <input type="email" value={siEmail} onChange={(e) => setSiEmail(e.target.value)} placeholder="Email" aria-label="Email" autoComplete="email" required />
            </div>
            <PasswordInput value={siPassword} onChange={setSiPassword} placeholder="Password" autoComplete="current-password" />

            {!isSignUp && messages}

            <button type="submit" className="as-btn" disabled={busy}>{busy && !isSignUp ? <><span className="as-spin" aria-hidden="true" />Signing in…</> : "Sign in"}</button>
            <div className="as-row">
              <label className="as-remember">
                <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} /> <span>Remember me</span>
              </label>
              <button type="button" className="auth-link-button" onClick={resetPassword} disabled={busy}>Forgot password?</button>
            </div>
            <p className="as-mobile-switch">
              New to Sparrow by TechBliss?{" "}
              <button type="button" className="auth-link-button" onClick={() => switchMode("signup")}>Create an account</button>
            </p>
          </form>

          {/* ── Sign up ─────────────────────────────────────────────── */}
          {!awaitingOtp ? (
            <form
              className={`as-form${isSignUp ? " is-active" : ""}`}
              onSubmit={handleSignUp}
              aria-hidden={!isSignUp}
            >
              <h2 className="as-title">Create your account.</h2>
              <p className="as-sub">Keep research and generated content tied to your account.</p>

              {googleButton("Continue with Google")}
              <div className="as-divider"><span>or create with email</span></div>

              <div className="as-field">
                <span className="as-field-icon"><UserIcon /></span>
                <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name" aria-label="Full name" autoComplete="name" required />
              </div>
              <div className="as-field">
                <span className="as-field-icon"><MailIcon /></span>
                <input type="email" value={suEmail} onChange={(e) => setSuEmail(e.target.value)} placeholder="Email" aria-label="Email" autoComplete="email" required />
              </div>
              <PasswordInput value={suPassword} onChange={setSuPassword} placeholder="Password" autoComplete="new-password" />
              <PasswordInput value={confirm} onChange={setConfirm} placeholder="Confirm password" autoComplete="new-password" />

              {isSignUp && messages}

              <button type="submit" className="as-btn" disabled={busy}>{busy && isSignUp ? <><span className="as-spin" aria-hidden="true" />Creating…</> : "Create account"}</button>
              <label className="as-remember">
                <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} /> <span>Remember me on this device</span>
              </label>
              <p className="as-mobile-switch">
                Already have an account?{" "}
                <button type="button" className="auth-link-button" onClick={() => switchMode("signin")}>Sign in</button>
              </p>
            </form>
          ) : (
            <form
              className={`as-form${isSignUp ? " is-active" : ""}`}
              onSubmit={handleVerifyOtp}
              aria-hidden={!isSignUp}
            >
              <h2 className="as-title">Verify your email.</h2>
              <p className="as-sub">Enter the 6-digit code we sent to {suEmail.trim() || "your email"}.</p>
              <div className="as-field">
                <span className="as-field-icon"><LockIcon /></span>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="6-digit code"
                  aria-label="6-digit email verification code"
                  required
                />
              </div>
              {isSignUp && messages}
              <button type="submit" className="as-btn" disabled={busy}>{busy ? <><span className="as-spin" aria-hidden="true" />Verifying…</> : "Verify email"}</button>
              <p className="as-mobile-switch">
                <button type="button" className="auth-link-button" onClick={() => switchMode("signin")}>Back to sign in</button>
              </p>
            </form>
          )}
        </div>

        {/* ── Sliding panels (desktop only) ───────────────────────────── */}
        <div className="as-panels">
          <div className="as-panel as-panel-left">
            <div className="as-deco" aria-hidden="true"><i /><i /><i /></div>
            <div className="as-content">
              <h3>New here?</h3>
              <p>Create your account in seconds and start turning company research into content.</p>
              <button type="button" className="as-ghost" onClick={() => switchMode("signup")} tabIndex={isSignUp ? -1 : 0}>
                Sign up
              </button>
            </div>
          </div>
          <div className="as-panel as-panel-right">
            <div className="as-deco" aria-hidden="true"><i /><i /><i /></div>
            <div className="as-content">
              <h3>One of us?</h3>
              <p>Welcome back. Sign in to pick up where you left off.</p>
              <button type="button" className="as-ghost" onClick={() => switchMode("signin")} tabIndex={isSignUp ? 0 : -1}>
                Sign in
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Everything is scoped under .auth-switch and uses the app's own tokens
   (accent #d03e7c / #b42c66, paper, warm border #e8e1d9) with fallbacks. */
const AUTH_SWITCH_CSS = `
.auth-switch{--as-accent:var(--sparrow-orange,#d03e7c);--as-accent-dark:var(--sparrow-orange-dark,#b42c66);--as-ink:#282522;--as-muted:#655f6e;--as-line:#e8e1d9;--as-paper:#f7f4ef;--as-ease:cubic-bezier(.7,0,.2,1);--as-spring:cubic-bezier(.22,1,.36,1);width:min(920px,100%);margin:56px auto 0;position:relative;z-index:1;font-family:inherit}
.auth-switch,.auth-switch *{box-sizing:border-box}
.auth-switch .as-card{position:relative;width:100%;height:700px;background:#fff;border:1px solid var(--as-line);border-radius:20px;box-shadow:0 24px 70px rgb(42 35 27 / 10%);overflow:hidden;animation:as-pop .7s var(--as-spring) both}
.auth-switch .as-forms{position:absolute;inset:0}
.auth-switch .as-sweep{position:absolute;inset:0;z-index:4;pointer-events:none;overflow:hidden}
.auth-switch .as-sweep i{position:absolute;top:0;bottom:0;left:0;transition:transform .8s var(--as-ease),clip-path .8s var(--as-ease);clip-path:polygon(0 0,100% 0,85% 100%,0 100%);will-change:transform}
.auth-switch .as-sweep i:nth-child(1){width:54%;background:#1c1822;transition-delay:.12s}
.auth-switch .as-sweep i:nth-child(2){width:52%;background:var(--as-accent-dark);transition-delay:.06s}
.auth-switch .as-sweep i:nth-child(3){width:50%;background:linear-gradient(-45deg,var(--as-accent-dark) 0%,var(--as-accent) 100%)}
.auth-switch .as-card.is-signup .as-sweep i{clip-path:polygon(0 0,100% 0,100% 100%,15% 100%)}
.auth-switch .as-card.is-signup .as-sweep i:nth-child(1){transform:translateX(85.185%)}
.auth-switch .as-card.is-signup .as-sweep i:nth-child(2){transform:translateX(92.308%)}
.auth-switch .as-card.is-signup .as-sweep i:nth-child(3){transform:translateX(100%)}
.auth-switch .as-form{position:absolute;top:50%;left:75%;width:50%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;padding:0 3.2rem;z-index:5;opacity:0;visibility:hidden;pointer-events:none;transition:left .7s var(--as-ease),opacity .18s,visibility 0s .18s}
.auth-switch .as-card.is-signup .as-form{left:25%}
.auth-switch .as-form.is-active{opacity:1;visibility:visible;pointer-events:auto;transition:left .7s var(--as-ease),opacity .3s .2s,visibility 0s}
.auth-switch .as-form.is-active>*{animation:as-rise .55s var(--as-spring) both}
.auth-switch .as-form.is-active>:nth-child(1){animation-delay:.15s}
.auth-switch .as-form.is-active>:nth-child(2){animation-delay:.2s}
.auth-switch .as-form.is-active>:nth-child(3){animation-delay:.25s}
.auth-switch .as-form.is-active>:nth-child(4){animation-delay:.3s}
.auth-switch .as-form.is-active>:nth-child(5){animation-delay:.35s}
.auth-switch .as-form.is-active>:nth-child(6){animation-delay:.4s}
.auth-switch .as-form.is-active>:nth-child(7){animation-delay:.45s}
.auth-switch .as-form.is-active>:nth-child(8){animation-delay:.5s}
.auth-switch .as-form.is-active>:nth-child(9){animation-delay:.55s}
.auth-switch .as-form.is-active>.as-msg.auth-error{animation:as-shake .45s var(--as-spring) both}
.auth-switch .as-title{margin:0 0 4px;font-size:2rem;line-height:1.05;letter-spacing:-.05em;font-weight:800;color:var(--as-ink);text-align:center}
.auth-switch .as-sub{margin:0 0 16px;font-size:.85rem;line-height:1.5;color:var(--as-muted);text-align:center;max-width:340px}
.auth-switch .as-google{width:100%;max-width:380px;height:46px;display:flex;align-items:center;justify-content:center;gap:9px;border:1px solid var(--as-line);border-radius:11px;background:#fff;color:var(--as-ink);font-weight:750;font-size:.9rem;cursor:pointer;transition:transform .2s var(--as-spring),border-color .2s,background .2s,box-shadow .2s}
.auth-switch .as-google span{font-weight:900;color:var(--as-accent)}
.auth-switch .as-google:hover:not(:disabled){border-color:var(--as-accent);background:#fff7fa;transform:translateY(-2px);box-shadow:0 8px 18px rgb(208 62 124 / 12%)}
.auth-switch .as-google:active:not(:disabled){transform:scale(.98)}
.auth-switch .as-divider{width:100%;max-width:380px;display:flex;align-items:center;gap:10px;margin:14px 0 6px;color:#8a8590;font-size:.68rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.auth-switch .as-divider:before,.auth-switch .as-divider:after{content:"";flex:1;border-top:1px solid var(--as-line)}
.auth-switch .as-field{width:100%;max-width:380px;height:48px;margin:7px 0;display:flex;align-items:center;gap:4px;padding:0 6px 0 4px;background:var(--as-paper);border:1px solid var(--as-line);border-radius:11px;transition:background .2s,border-color .2s,box-shadow .2s,transform .25s var(--as-spring)}
.auth-switch .as-field:focus-within{background:#fff;border-color:var(--as-accent);box-shadow:0 0 0 3px rgb(208 62 124 / 13%),0 8px 18px rgb(208 62 124 / 8%);transform:translateY(-1px)}
.auth-switch .as-field-icon{width:38px;display:flex;align-items:center;justify-content:center;color:var(--as-muted);flex:none;transition:color .2s,transform .3s var(--as-spring)}
.auth-switch .as-field:focus-within .as-field-icon{color:var(--as-accent);transform:scale(1.15)}
.auth-switch .as-field input{flex:1;min-width:0;height:100%;border:0;outline:0;background:transparent;color:#1c1822;font-size:.92rem;font-weight:500}
.auth-switch .as-field input::placeholder{color:#9b95a1;font-weight:400}
.auth-switch .as-eye{border:0;background:transparent;color:var(--as-muted);width:34px;height:34px;display:grid;place-items:center;border-radius:8px;cursor:pointer;transition:color .2s,background .2s,transform .2s var(--as-spring)}
.auth-switch .as-eye:hover{color:var(--as-ink);background:rgb(28 24 34 / 6%)}
.auth-switch .as-eye:active{transform:scale(.9)}
.auth-switch .as-msg{width:100%;max-width:380px;margin:6px 0}
.auth-switch .as-btn{position:relative;overflow:hidden;width:100%;max-width:380px;height:48px;margin:10px 0 6px;border:0;border-radius:11px;background:var(--as-accent);color:#fff;font-weight:800;font-size:.92rem;cursor:pointer;box-shadow:0 8px 20px rgb(208 62 124 / 18%);transition:transform .2s var(--as-spring),background .2s,box-shadow .2s}
.auth-switch .as-btn:after{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(110deg,transparent 30%,rgb(255 255 255 / 38%) 50%,transparent 70%);transform:translateX(-130%)}
.auth-switch .as-btn:hover:not(:disabled){background:var(--as-accent-dark);transform:translateY(-2px);box-shadow:0 12px 26px rgb(208 62 124 / 28%)}
.auth-switch .as-btn:hover:not(:disabled):after{transform:translateX(130%);transition:transform .7s var(--as-spring)}
.auth-switch .as-btn:active:not(:disabled){transform:scale(.98)}
.auth-switch .as-btn:disabled,.auth-switch .as-google:disabled{opacity:.7;cursor:not-allowed}
.auth-switch .as-spin{display:inline-block;width:14px;height:14px;margin-right:8px;vertical-align:-2px;border:2px solid rgb(255 255 255 / 45%);border-top-color:#fff;border-radius:50%;animation:as-spin .7s linear infinite}
.auth-switch .as-row{width:100%;max-width:380px;display:flex;align-items:center;justify-content:space-between;gap:10px}
.auth-switch .as-remember{display:flex;align-items:center;gap:8px;font-size:.78rem;color:var(--as-muted);cursor:pointer}
.auth-switch .as-remember input{width:15px;height:15px;accent-color:var(--as-accent)}
.auth-switch .auth-link-button{font-size:.78rem}
.auth-switch .as-btn:focus-visible,.auth-switch .as-google:focus-visible,.auth-switch .as-eye:focus-visible{outline:none;box-shadow:0 0 0 3px rgb(208 62 124 / 30%)}
.auth-switch .as-ghost:focus-visible{outline:none;box-shadow:0 0 0 3px rgb(255 255 255 / 55%)}
.auth-switch .as-mobile-switch{display:none;margin:14px 0 0;font-size:.82rem;color:var(--as-muted);text-align:center}
.auth-switch .as-panels{position:absolute;inset:0;display:grid;grid-template-columns:repeat(2,1fr);z-index:7;pointer-events:none}
.auth-switch .as-panel{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:3rem 9%}
.auth-switch .as-panel-left{pointer-events:auto}
.auth-switch .as-deco{position:absolute;inset:0;overflow:hidden;pointer-events:none;transition:opacity .35s .15s}
.auth-switch .as-deco i{position:absolute;border:1.5px solid rgb(255 255 255 / 24%);border-radius:50%;animation:as-float 7s ease-in-out infinite}
.auth-switch .as-deco i:nth-child(1){width:150px;height:150px;top:-44px;left:-44px}
.auth-switch .as-deco i:nth-child(2){width:96px;height:96px;bottom:46px;right:24px;animation-delay:-2.2s}
.auth-switch .as-deco i:nth-child(3){width:16px;height:16px;bottom:120px;left:40px;border:0;background:rgb(255 255 255 / 38%);animation-delay:-4.4s}
.auth-switch .as-content{position:relative;color:#fff;transition:transform .6s var(--as-spring) .15s,opacity .35s .15s}
.auth-switch .as-content h3{margin:0 0 10px;font-size:1.7rem;font-weight:800;letter-spacing:-.04em;line-height:1}
.auth-switch .as-content p{margin:0 0 18px;font-size:.92rem;line-height:1.55;color:rgb(255 255 255 / 92%)}
.auth-switch .as-ghost{width:130px;height:42px;border:2px solid #fff;border-radius:11px;background:transparent;color:#fff;font-weight:800;font-size:.8rem;text-transform:uppercase;letter-spacing:.04em;cursor:pointer;transition:background .2s,color .2s,transform .2s var(--as-spring),box-shadow .2s}
.auth-switch .as-ghost:hover{background:#fff;color:var(--as-accent-dark);transform:translateY(-2px);box-shadow:0 10px 22px rgb(0 0 0 / 18%)}
.auth-switch .as-ghost:active{transform:scale(.97)}
.auth-switch .as-panel-right .as-content{transform:translateX(70px);opacity:0}
.auth-switch .as-panel-right .as-deco{opacity:0}
.auth-switch .as-card.is-signup .as-panel-left{pointer-events:none}
.auth-switch .as-card.is-signup .as-panel-right{pointer-events:auto}
.auth-switch .as-card.is-signup .as-panel-left .as-content{transform:translateX(-70px);opacity:0}
.auth-switch .as-card.is-signup .as-panel-left .as-deco{opacity:0}
.auth-switch .as-card.is-signup .as-panel-right .as-content{transform:none;opacity:1}
.auth-switch .as-card.is-signup .as-panel-right .as-deco{opacity:1}
@keyframes as-pop{from{opacity:0;transform:translateY(24px) scale(.98)}to{opacity:1;transform:none}}
@keyframes as-rise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
@keyframes as-shake{0%{opacity:0;transform:translateX(-8px)}25%{opacity:1;transform:translateX(7px)}50%{transform:translateX(-5px)}75%{transform:translateX(3px)}100%{transform:none}}
@keyframes as-float{0%,100%{transform:translate(0,0)}50%{transform:translate(8px,-14px)}}
@keyframes as-spin{to{transform:rotate(360deg)}}
@media (max-width:870px){
  .auth-switch{margin-top:40px}
  .auth-switch .as-card{height:auto;min-height:0}
  .auth-switch .as-sweep,.auth-switch .as-panels{display:none}
  .auth-switch .as-forms{position:static}
  .auth-switch .as-card .as-form,.auth-switch .as-card.is-signup .as-form{position:static;transform:none;width:100%;padding:2rem 1.4rem;display:none;opacity:1;visibility:visible;transition:none}
  .auth-switch .as-card .as-form.is-active{display:flex}
  .auth-switch .as-mobile-switch{display:block}
}
@media (prefers-reduced-motion:reduce){
  .auth-switch .as-card,.auth-switch .as-form.is-active>*,.auth-switch .as-deco i{animation:none!important}
  .auth-switch .as-sweep i,.auth-switch .as-form,.auth-switch .as-content,.auth-switch .as-btn:after{transition-duration:.01ms!important;transition-delay:0s!important}
}
`;
