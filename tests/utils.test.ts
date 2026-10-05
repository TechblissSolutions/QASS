import { normaliseUrl, ymd, shiftColor, htmlToText } from '@/lib/utils';

describe('utils', () => {
  test('normaliseUrl adds https and rejects malformed URLs', () => {
    expect(normaliseUrl('example.com')).toBe('https://example.com');
    expect(normaliseUrl('https://example.com/path')).toBe('https://example.com/path');
    expect(normaliseUrl('not a url')).toBe('');
  });
  test('ymd uses local calendar date components', () => {
    expect(ymd(new Date(2026, 8, 29))).toBe('2026-09-29');
  });
  test('shiftColor shifts and clamps RGB channels', () => {
    expect(shiftColor('#102030', 16)).toBe('#203040');
    expect(shiftColor('#fff', 50)).toBe('#ffffff');
    expect(shiftColor('bad', 10)).toBe('#888');
  });
  test('htmlToText removes markup', () => {
    expect(htmlToText('<h1>Hello</h1><p>World</p>')).toContain('HelloWorld');
  });
});
