'use client';
import { useStore } from '@/lib/store';
import type { BrandTheme as BrandThemeType } from '@/lib/types';

function isHex(value: unknown): value is string {
  return /^#[0-9a-f]{6}$/i.test(String(value || ''));
}

function contrastInk(color: string, fallback: string = '#000000') {
  const hex = String(color || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(hex)) return fallback;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = (value: number) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  return luminance > 0.48 ? '#000000' : '#ffffff';
}

export default function BrandTheme() {
  const { s } = useStore();
  const t: Partial<BrandThemeType> = s.brandTheme || {};

  // Never expose an empty CSS custom property. Empty/invalid custom properties can
  // invalidate color-mix() and make buttons/text disappear. These are safe until the
  // website-derived theme arrives, then they are replaced immediately.
  const primary = isHex(t.primary_color) ? String(t.primary_color) : '#111827';
  const secondary = isHex(t.secondary_color) ? String(t.secondary_color) : primary;
  const background = isHex(t.background_color) ? String(t.background_color) : '#ffffff';
  const text = isHex(t.text_color) ? String(t.text_color) : contrastInk(background, '#111827');
  const onPrimary = contrastInk(primary, '#ffffff');
  const onBackground = contrastInk(background, '#111827');
  const onSecondary = contrastInk(secondary, '#111827');

  const vars: Record<string, string> = {
    '--brand-primary': primary,
    '--brand-secondary': secondary,
    '--brand-background': background,
    '--brand-text': text,
    '--client-primary': primary,
    '--client-secondary': secondary,
    '--client-background': background,
    '--client-text': text,
    '--client-on-primary': onPrimary,
    '--client-on-background': onBackground,
    '--client-on-secondary': onSecondary,
    '--client-line': `color-mix(in srgb, ${text} 16%, ${background})`,
    '--client-muted': `color-mix(in srgb, ${text} 58%, ${background})`,
  };

  const declarations = Object.entries(vars).map(([key, value]) => `${key}:${value}`).join(';');
  return <style data-brand-theme>{`.company-workspace{${declarations}} .company-workspace *{--client-primary:${primary};--client-secondary:${secondary};--client-background:${background};--client-text:${text};--client-on-primary:${onPrimary};--client-on-background:${onBackground};--client-on-secondary:${onSecondary};}`}</style>;
}
