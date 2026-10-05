/** @jest-environment node */
// Runs the REAL server sanitizer and the REAL browser-side parser together, using jsdom for the DOM.
jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { JSDOM } = require('jsdom');
const dom = new JSDOM('');
Object.assign(globalThis, { document: dom.window.document, DOMParser: dom.window.DOMParser });
import { sanitizeHtml } from '@/lib/server';
import { parseLiveViewHtml, splitIntoCards } from '@/lib/parser';

// Same shape as n8n's "Build Live Section View" output: full document, <meta> first, <style> in head.
const doc = (body: string, refresh = '') =>
  `<!doctype html><html><head><meta charset="utf-8">${refresh}<meta name="viewport" content="width=device-width,initial-scale=1"><title>x</title><style>.a{color:red}</style></head><body>${body}</body></html>`;

const socialBody = `<div class="output-field"><div class="platform-stack">
  <article class="platform-block"><div class="platform-title"><h3>Instagram</h3><span>2 content pieces</span></div><div class="media-stack">
    <article class="media-card" data-card-id="social-ig-1"><div class="media-card-head"><div><span class="content-number">Content 1</span><h4>Colour that lasts</h4></div><span class="type-badge">Media type: IMAGE</span></div><div class="content-box formatted-content"><p>Caption one &amp; more.</p></div><script>alert(1)</script></article>
    <article class="media-card" data-card-id="social-ig-2"><div class="media-card-head"><h4>Second</h4></div><div class="content-box formatted-content"><p>Caption two.</p></div></article>
  </div></article>
  <article class="platform-block"><div class="platform-title"><h3>LinkedIn</h3><span>1 content pieces</span></div><div class="media-stack">
    <article class="media-card" data-card-id="social-li-1"><div class="media-card-head"><h4>B2B post</h4></div><div class="content-box formatted-content"><p>Professional copy.</p></div></article>
  </div></article></div></div>`;

describe('live-view pipeline (n8n document -> cards)', () => {
  test('sanitizer no longer deletes everything after <meta>', () => {
    const out = sanitizeHtml(doc(socialBody));
    expect(out).toContain('media-card');
    expect(out).toContain('Caption two.');
    expect(out).toContain('data-card-id="social-ig-1"');
    expect(out).not.toMatch(/<script|alert\(1\)|<meta|<style|\.a\{color/i);
    expect(out).not.toContain('&amp;amp;');
  });

  test('unclosed dangerous blocks are still dropped entirely', () => {
    const out = sanitizeHtml('<p>ok</p><script>alert(1)');
    expect(out).toContain('ok');
    expect(out).not.toContain('alert');
    expect(sanitizeHtml('<p>ok</p><iframe src="https://x.test">tail')).not.toContain('tail');
  });

  test('event handlers and javascript: urls are still stripped, data-* kept', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)" onclick="x()" data-id="7">a</a><img src="x" onerror="y()">');
    expect(out).not.toMatch(/javascript:|onclick|onerror/i);
    expect(out).toContain('data-id="7"');
  });

  test('server-sanitised social document yields clean channels and cards', () => {
    const parsed = parseLiveViewHtml(sanitizeHtml(doc(socialBody)));
    expect(parsed).toBeTruthy();
    const cards = splitIntoCards(parsed as string, 'social', 'Social');
    expect(cards.map(c => c.channel)).toEqual(['Instagram', 'Instagram', 'LinkedIn']);
    expect(cards[0].id).toBe('social-ig-1');
    expect(cards[0].title).toBe('Colour that lasts');
  });

  test('waiting shell is treated as pending', () => {
    const waiting = doc('<div class="waiting"><strong>Generating…</strong></div>', '<meta http-equiv="refresh" content="3;url=x">');
    expect(parseLiveViewHtml(sanitizeHtml(waiting))).toBeNull();
  });
});
