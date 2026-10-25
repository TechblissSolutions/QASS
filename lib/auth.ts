'use client';

import { getSupabaseClient } from './supabase';

export async function getAccessToken(): Promise<string | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) return null;
  const expiresAt = data.session.expires_at;
  if (typeof expiresAt === 'number' && expiresAt * 1000 <= Date.now() + 60_000) {
    return refreshAccessToken();
  }
  return data.session.access_token || null;
}

export async function refreshAccessToken(): Promise<string | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.refreshSession();
  if (error) return null;
  return data.session?.access_token || null;
}

export async function getCurrentUser() {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data } = await supabase.auth.getUser();
  return data.user || null;
}
