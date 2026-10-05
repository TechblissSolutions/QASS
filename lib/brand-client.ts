// One shared, de-duplicated way to ask /api/brand-appearance for a company's logo + colours.
// Before this, the header, store and dashboard each fetched on their own and the header
// re-fetched every time the theme changed, which hit the rate limit (HTTP 429) and left
// the logo/colours empty.
export type BrandAppearance = Record<string, unknown>;

const inflight = new Map<string, Promise<BrandAppearance | null>>();
const done = new Map<string, BrandAppearance | null>();

export function brandThemeComplete(theme: unknown): boolean {
  const t = (theme || {}) as Record<string, unknown>;
  return Boolean(
    String(t.logo_url || '').trim() &&
    String(t.primary_color || '').trim() &&
    String(t.secondary_color || '').trim() &&
    String(t.background_color || '').trim() &&
    String(t.text_color || '').trim()
  );
}

export function mergeTheme(current: unknown, fetched: unknown): BrandAppearance {
  return Object.entries({ ...((current || {}) as BrandAppearance), ...((fetched || {}) as BrandAppearance) })
    .reduce<BrandAppearance>((acc, [key, value]) => {
      if (value !== null && value !== undefined && String(value).trim() !== '') acc[key] = value;
      return acc;
    }, {});
}

export function fetchBrandAppearance(url: string, refresh = false): Promise<BrandAppearance | null> {
  const key = String(url || '').trim();
  if (!key) return Promise.resolve(null);
  if (!refresh && done.has(key)) return Promise.resolve(done.get(key) ?? null);
  // Refresh bypasses the completed-value cache, but still shares an in-flight
  // request so Header/Studio/Dashboard cannot create duplicate scraper calls.
  const existing = inflight.get(key);
  if (existing) return existing;
  const request = (async () => {
    try {
      const res = await fetch('/api/brand-appearance?url=' + encodeURIComponent(key) + (refresh ? '&refresh=1' : ''), { cache: 'no-store' });
      if (!res.ok) return null; // failures are never remembered as a successful theme
      const data = await res.json() as BrandAppearance;
      if (!data || typeof data !== 'object') return null;
      if (brandThemeComplete(data)) done.set(key, data);
      return data;
    } catch { return null; }
    finally { inflight.delete(key); }
  })();
  inflight.set(key, request);
  return request;
}
