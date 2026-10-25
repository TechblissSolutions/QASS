import { normaliseUrl } from '@/lib/utils';

describe('normaliseUrl', () => {
  test('adds https prefix', () => {
    expect(normaliseUrl('example.com')).toBe('https://example.com');
  });

  test('strips www', () => {
    expect(normaliseUrl('https://www.example.com')).toBe('https://example.com');
  });

  test('strips trailing slash', () => {
    expect(normaliseUrl('https://example.com/')).toBe('https://example.com');
  });

  test('strips hash and search', () => {
    expect(normaliseUrl('https://example.com/page?q=1#top')).toBe('https://example.com/page');
  });

  test('lowercases hostname', () => {
    expect(normaliseUrl('https://EXAMPLE.COM/Path')).toBe('https://example.com/Path');
  });

  test('returns empty for empty input', () => {
    expect(normaliseUrl('')).toBe('');
  });

  test('strips default ports', () => {
    expect(normaliseUrl('https://example.com:443')).toBe('https://example.com');
    expect(normaliseUrl('http://example.com:80')).toBe('http://example.com');
  });
});
