export type Plan = 'free' | 'pro' | 'owner';

export type Entitlements = {
  plan: Plan;
  maxCompanies: number | null;
  canRegenerate: boolean;
  canUseAllFeatures: boolean;
};

export function isOwnerEmail(email: string | null | undefined) {
  if (!email) return false;
  const owners = String(process.env.SPARROW_OWNER_EMAILS || '')
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(Boolean);
  return owners.includes(email.toLowerCase());
}

export function isOwnerUserId(id: string | null | undefined) {
  if (!id) return false;
  const owners = String(process.env.SPARROW_OWNER_USER_IDS || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
  return owners.includes(id);
}

export function entitlementsFor(plan: Plan): Entitlements {
  if (plan === 'owner') return { plan, maxCompanies: null, canRegenerate: true, canUseAllFeatures: true };
  if (plan === 'pro') return { plan, maxCompanies: 5, canRegenerate: true, canUseAllFeatures: true };
  return { plan: 'free', maxCompanies: 1, canRegenerate: false, canUseAllFeatures: false };
}

export async function getEntitlementsForToken(accessToken: string) {
  const { getSupabaseClient, getUserFromToken } = await import('./supabase');
  const user = await getUserFromToken(accessToken);
  if (!user) return { user: null, ...entitlementsFor('free') };
  if (isOwnerEmail(user.email) || isOwnerUserId(user.id)) return { user, ...entitlementsFor('owner') };
  const supabase = getSupabaseClient(accessToken);
  const [{ data }, { data: subscription }] = await Promise.all([
    supabase!.from('profiles').select('plan,role').eq('id', user.id).maybeSingle(),
    supabase!.from('subscriptions').select('plan,status').eq('user_id', user.id).maybeSingle(),
  ]);
  const hasProSubscription = subscription?.plan === 'pro' && ['active','trialing'].includes(String(subscription.status));
  const plan: Plan = data?.role === 'owner' ? 'owner' : (data?.plan === 'pro' || hasProSubscription) ? 'pro' : 'free';
  return { user, ...entitlementsFor(plan) };
}
