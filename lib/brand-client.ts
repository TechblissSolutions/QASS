// One shared, de-duplicated way to ask /api/brand-appearance for a company's logo + colours.
// Before this, the header, store and dashboard each fetched on their own and the header
// re-fetched every time the theme changed, which hit the rate limit (HTTP 429) and left
// the logo/colours empty.
export type BrandAppearance = Record<string, unknown>;

const inflight = new Map<string, Promise<BrandAppearance | null>>();
const done = new Map<string, BrandAppearance | null>();

function normaliseHex(value: unknown): string {
  const raw = String(value || '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(raw)) return raw;
  const short = raw.match(/^#([0-9a-f]{3})$/);
  if (short) return '#' + short[1].split('').map((char) => char + char).join('');
  return '';
}

function isNearWhite(value: unknown): boolean {
  const hex = normaliseHex(value);
  if (!hex) return false;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return r > 220 && g > 220 && b > 220;
}

export function brandThemeComplete(theme: unknown): boolean {
  const t = (theme || {}) as Record<string, unknown>;
  const logo = String(t.logo_url || '').trim();
  const primary = String(t.primary_color || '').trim();
  const secondary = String(t.secondary_color || '').trim();
  const background = String(t.background_color || '').trim();
  const text = String(t.text_color || '').trim();

  if (!logo || !primary || !secondary || !background || !text) return false;

  // A previous scraper version could incorrectly store theme-color (#fff) as
  // the primary brand colour. If both primary and background are effectively
  // white, treat the saved theme as incomplete so the dashboard refreshes it.
  // This still allows legitimate white primary colours when the background is
  // dark or otherwise different.
  if (isNearWhite(primary) && isNearWhite(background)) return false;

  return true;
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
