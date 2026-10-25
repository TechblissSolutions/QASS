const REQUIRED = [
  'N8N_BASE', 'N8N_ANALYSE_PATH', 'N8N_GENERATE_PATH', 'N8N_LIVE_VIEW_PATH',
  'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SPARROW_LIVE_VIEW_SECRET',
];

let checked = false;

export function assertServerEnv() {
  if (checked) return;
  const missing = REQUIRED.filter(name => !process.env[name]);
  if (process.env.NODE_ENV === 'production' && (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN)) missing.push('UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN');
  if (process.env.NODE_ENV === 'production' && !process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length) throw new Error(`Missing required environment variables: ${[...new Set(missing)].join(', ')}`);
  if (!/^https?:\/\//i.test(process.env.N8N_BASE || '')) throw new Error('N8N_BASE must be an HTTP(S) URL.');
  if ((process.env.SPARROW_LIVE_VIEW_SECRET || '').length < 32) throw new Error('SPARROW_LIVE_VIEW_SECRET must be at least 32 characters.');
  checked = true;
}
