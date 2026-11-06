"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";

function safeDestination(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function completeSignIn() {
      try {
        const params = new URLSearchParams(window.location.search);
        const supabase = getSupabaseClient();
        if (!supabase) throw new Error("Authentication is not configured.");

        const code = params.get("code");
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        }

        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!data.session?.access_token) throw new Error("Google sign-in could not be completed. Please try again.");

        if (typeof window !== "undefined") {
          let deviceId = window.localStorage.getItem("qass_device_id");
          if (!deviceId) {
            deviceId = `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
            window.localStorage.setItem("qass_device_id", deviceId);
          }
          void fetch("/api/security/login-alert", {
            method: "POST",
            headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ deviceId }),
          }).catch(() => undefined);
        }

        if (active) router.replace(safeDestination(params.get("redirect")));
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to complete Google sign-in.");
      }
    }

    void completeSignIn();
    return () => { active = false; };
  }, [router]);

  return (
    <main className="center-page" role="status" aria-live="polite">
      <div className="work-card">
        <p>{error || "Completing Google sign-in…"}</p>
        {error && <a href="/login">Return to sign in</a>}
      </div>
    </main>
  );
}
