import type { Profile, Piece } from './types';
import { htmlToText, sanitizeHtml } from './utils';

const cleanDash = (value: string) => String(value || '').replace(/[\u2014\u2013]/g, '-');

export function parseForm2Html(html: string): Profile {
  const doc = new DOMParser().parseFromString(html,'text/html');
  const val = (name: string, fb='') => { const el = doc.querySelector('[name="'+name+'"]') as any; if(!el) return fb; if(el.tagName==='SELECT') return el.options[el.selectedIndex]?.value||fb; if(el.tagName==='TEXTAREA') return el.textContent||el.value||fb; return el.value||fb; };
  const opts: string[] = []; doc.querySelectorAll('[name="product_or_service"] option').forEach((o:any) => { if(o.value) opts.push(o.value); });
  return { company_name:val('company_name'), company_website:val('company_website'), company_summary:val('company_summary'), company_details:val('company_details'), target_audience:val('target_audience'), product_options:opts, product:opts[0]||'', company_research:val('company_research') };
}

export function parseLiveViewHtml(html: string): string|null {
  const raw = String(html || '').trim();
  // Some n8n Respond to Webhook configurations return JSON instead of HTML.
  // Convert common structured content shapes into the same card markup used by
  // the HTML parser, so the UI does not depend on one exact response format.
  if (/^[\[{]/.test(raw)) {
    try {
      const structured = JSON.parse(raw);
      // n8n may wrap the live HTML in {html}, {live_view_html},
      // {content}, {result}, or {body} depending on the Respond to Webhook
      // configuration. Unwrap those strings before treating the response as
      // generic structured data; otherwise a perfectly valid HTML preview can
      // be mistaken for an object with no renderable cards.
      const unwrapHtml = (value: unknown, depth = 0): string => {
        if (depth > 5 || value == null) return '';
        if (typeof value === 'string') {
          const text = value.trim();
          return /<(?:!doctype|html|body|section|article|div)\b/i.test(text) ? text : '';
        }
        if (Array.isArray(value)) {
          for (const item of value) { const found = unwrapHtml(item, depth + 1); if (found) return found; }
          return '';
        }
        if (typeof value !== 'object') return '';
        const obj = value as Record<string, unknown>;
        for (const key of ['html','live_view_html','content','output_html','generated_html','result','body','response','output','data','json']) {
          const found = unwrapHtml(obj[key], depth + 1);
          if (found) return found;
        }
        return '';
      };
      const wrappedHtml = unwrapHtml(structured);
      if (wrappedHtml) return parseLiveViewHtml(wrappedHtml);
      const generated = structuredToHtml(structured);
      if (generated) return cleanDash(sanitizeHtml(generated));
    } catch { /* fall through to normal HTML parsing */ }
  }
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  const title = doc.querySelector('title')?.textContent?.trim().toLowerCase() || '';
  const bodyText = doc.body?.textContent?.replace(/\s+/g, ' ').trim().toLowerCase() || '';
  if (/^(error|internal server error|application error|bad gateway|gateway timeout)$/.test(title) ||
      /workflow execution failed|internal server error|bad gateway|gateway timeout/.test(bodyText)) return null;
  if (doc.querySelector('meta[http-equiv="refresh"]') || doc.querySelector('.waiting')) return null;
  // n8n keeps the image/video prompt, type and ratio ONLY in the Generate button's
  // data-payload. sanitizeHtml() removes every <button>, so copy the payload onto the
  // card itself (articles/data-* survive sanitising) before that happens.
  doc.querySelectorAll('.media-card').forEach(card => {
    const payload = card.querySelector('button.generate-media[data-payload], [data-payload]')?.getAttribute('data-payload');
    if (payload) card.setAttribute('data-media-payload', payload);
  });
  const s = doc.querySelector('.output-field') || doc.querySelector('.platform-stack') || doc.body;
  return s ? cleanDash(sanitizeHtml(s.innerHTML)) : '';
}


function structuredToHtml(value: unknown): string {
  const cards: string[] = [];
  const platformNames = /instagram|facebook|linkedin|twitter|x\/?twitter|youtube|website|seo|ads?|email|whatsapp|blog|video/i;
  const walk = (node: unknown, channel = 'Generated', depth = 0) => {
    if (depth > 7 || node == null) return;
    if (typeof node === 'string') {
      const text = node.trim();
      if (text && text.length > 25) cards.push(`<article class="media-card" data-channel="${escapeHtml(channel)}"><div class="media-card-head"><h4>Generated content</h4></div><div class="formatted-content"><p>${escapeHtml(text)}</p></div></article>`);
      return;
    }
    if (Array.isArray(node)) { node.forEach(item => walk(item, channel, depth + 1)); return; }
    if (typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    const nextChannel = Object.entries(obj).find(([key, val]) => platformNames.test(key) && (typeof val === 'object' || typeof val === 'string'))?.[0] || channel;
    const titleValue = firstStructuredString(obj, ['title','headline','subject','name','hook']);
    const bodyValue = firstStructuredString(obj, ['body','content','copy','caption','message','text','description','html','output','generated_content','generatedContent']);
    if (bodyValue && bodyValue.trim().length > 15) {
      const body = /<([a-z][^>]+)>/i.test(bodyValue) ? bodyValue : `<p>${escapeHtml(bodyValue)}</p>`;
      cards.push(`<article class="media-card" data-channel="${escapeHtml(nextChannel)}"><div class="media-card-head"><h4>${escapeHtml(titleValue || 'Generated content')}</h4></div><div class="formatted-content">${body}</div></article>`);
    }
    for (const [key, child] of Object.entries(obj)) {
      if (['title','headline','subject','name','hook','body','content','copy','caption','message','text','description','html','output','generated_content','generatedContent'].includes(key)) continue;
      const childChannel = platformNames.test(key) ? key : nextChannel;
      if (typeof child === 'object') walk(child, childChannel, depth + 1);
    }
  };
  walk(value);
  return cards.join('');
}

function firstStructuredString(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) if (typeof obj[key] === 'string' && String(obj[key]).trim()) return String(obj[key]).trim();
  return '';
}

function decodeMediaPayload(card: Element): Record<string, any> | null {
  const raw = card.getAttribute('data-media-payload');
  if (!raw) return null;
  try {
    const bin = atob(raw);
    let text: string;
    try {
      text = decodeURIComponent(bin.split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
    } catch {
      text = bin;
    }
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

function makePiece(card: Element, section: string, channel: string, index: number): Piece {
  const title = cleanDash(card.querySelector('.media-card-head h4')?.textContent?.trim()
    || card.querySelector('.media-card-head')?.textContent?.trim()
    || card.querySelector('[data-title], .title, .headline, h4, h5')?.textContent?.trim()
    || `${section.charAt(0).toUpperCase() + section.slice(1)} Content ${index}`);
  const format = cleanDash(card.querySelector('.type-badge')?.textContent?.replace(/^Media type:\s*/i, '').trim() || card.getAttribute('data-format') || '');
  const bodyEl = card.querySelector('.formatted-content') || card.querySelector('.content-box') || card.querySelector('[data-content], .body, .copy, .caption') || card;
  const bodyHtml = cleanDash(bodyEl.innerHTML || '');
  const bodyText = cleanDash(htmlToText(bodyHtml));
  // IMPORTANT: n8n's social preview also contains the client's actual logo as an <img>.
  // Do not treat that logo (or any arbitrary website image) as the generated post media.
  // Only explicit generated-media markers are accepted here. Generated media returned
  // by /api/media is stored separately on Piece.mediaUrl and rendered by Studio.
  const mediaImage = card.querySelector('img.generated-media, img.preview-generated-media, img[data-generated-media], .generated-media-wrap img') as HTMLImageElement | null;
  const mediaVideo = card.querySelector('video.generated-media, video.preview-generated-media, video[data-generated-media], .generated-media-wrap video, .generated-media-wrap source') as HTMLVideoElement | HTMLSourceElement | null;
  // n8n may expose the completed provider URL on the media wrapper/card rather
  // than as the <img src>. Accept only explicit media URL attributes. Never scan
  // arbitrary <img> elements because the same card intentionally contains the
  // client's logo.
  const explicitMediaNode = card.querySelector('[data-media-url], [data-generated-url], .media-result[data-url]');
  const explicitMediaUrl = String(
    card.getAttribute('data-media-url') ||
    card.getAttribute('data-generated-url') ||
    explicitMediaNode?.getAttribute('data-media-url') ||
    explicitMediaNode?.getAttribute('data-generated-url') ||
    explicitMediaNode?.getAttribute('data-url') ||
    ''
  ).trim();
  const mediaUrl = String(mediaImage?.getAttribute('src') || mediaVideo?.getAttribute('src') || explicitMediaUrl).trim();
  const payload = decodeMediaPayload(card);
  const badgeText = card.querySelector('.type-badge')?.textContent || '';
  const payloadType = String(payload?.media_type || '').toLowerCase();
  const badgeType = /video/i.test(badgeText) ? 'video' : /image/i.test(badgeText) ? 'image' : /pdf/i.test(badgeText) ? 'pdf' : '';
  const mediaType: Piece['mediaType'] = mediaImage ? 'image' : mediaVideo ? 'video' : (payloadType === 'image' || payloadType === 'video' || payloadType === 'pdf') ? payloadType as Piece['mediaType'] : badgeType ? badgeType as Piece['mediaType'] : /MEDIA_TYPE\s*[:\-]\s*IMAGE/i.test(bodyText) ? 'image' : /MEDIA_TYPE\s*[:\-]\s*VIDEO/i.test(bodyText) ? 'video' : /MEDIA_TYPE\s*[:\-]\s*PDF/i.test(bodyText) ? 'pdf' : 'text';
  const promptMatch = bodyText.match(/AI\s+(?:IMAGE|VIDEO)(?:-GENERATION)?\s+PROMPT\s*[:\-]\s*([\s\S]*?)(?=\s*(?:CONTENT_FORMAT|MEDIA_TYPE|CONTENT_ANGLE|MEDIA_DURATION_SECONDS|MEDIA_SCENE_COUNT|SCENE_TIMINGS)\s*[:\-]|$)/i);
  const ratioMatch = bodyText.match(/(?:aspect[_ -]?ratio|ratio)\s*[:\-]\s*([0-9]+:[0-9]+)/i);
  const rawId = card.getAttribute('data-card-id') || card.getAttribute('data-id');
  const id = rawId || `${section}-${channel.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${index}`;
  return {
    id, section, channel: cleanDash(channel), format, title, bodyHtml, bodyText,
    wordCount: bodyText.split(/\s+/).filter(Boolean).length,
    ...(mediaUrl ? { mediaUrl } : {}),
    mediaType,
    ...((payload?.prompt || payload?.image_prompt || payload?.video_prompt || promptMatch?.[1]) ? { mediaPrompt: String(payload?.prompt || (payloadType === 'video' ? payload?.video_prompt : payload?.image_prompt) || payload?.image_prompt || payload?.video_prompt || promptMatch?.[1] || '').trim().slice(0, 8000) } : {}),
    ...((payload?.aspect_ratio || ratioMatch?.[1]) ? { aspectRatio: String(payload?.aspect_ratio || ratioMatch?.[1]) } : {}),
    ...(Number(payload?.requested_duration || payload?.video_duration) ? { mediaDuration: Number(payload?.requested_duration || payload?.video_duration) } : {}),
    ...(Number(payload?.scene_count) ? { mediaSceneCount: Number(payload?.scene_count) } : {}),
    ...(Array.isArray(payload?.scene_timings) && payload.scene_timings.length ? { mediaSceneTimings: payload?.scene_timings } : {}),
  };
}

function channelFromBlock(block: Element, fallback: string): string {
  return cleanDash(
    block.getAttribute('data-channel') ||
    block.querySelector('[data-channel]')?.getAttribute('data-channel') ||
    // Order matters: querySelector with a combined selector returns the first match in DOCUMENT order,
    // which is the wrapper div (text "Instagram3 content pieces") rather than the <h3> ("Instagram").
    block.querySelector('.platform-title h3')?.textContent?.trim() ||
    block.querySelector('.platform-block-head h3')?.textContent?.trim() ||
    block.querySelector('.platform-name')?.textContent?.trim() ||
    block.querySelector('.channel-name')?.textContent?.trim() ||
    block.querySelector('[data-platform] h3')?.textContent?.trim() ||
    block.querySelector('.platform-title')?.firstElementChild?.textContent?.trim() ||
    block.getAttribute('data-platform') || fallback
  );
}

export function splitIntoCards(html: string, section: string, defCh: string): Piece[] {
  if (!html) return [];
  html = cleanDash(sanitizeHtml(html));
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  const cards: Piece[] = [];

  const mediaCards = wrap.querySelectorAll('.media-card');
  if (mediaCards.length) {
    const platformBlocks = wrap.querySelectorAll('.platform-block, [data-platform], .platform');
    if (platformBlocks.length) {
      platformBlocks.forEach(block => {
        const channel = channelFromBlock(block, defCh);
        block.querySelectorAll('.media-card').forEach((card, i) => cards.push(makePiece(card, section, channel, i + 1)));
      });
    } else {
      mediaCards.forEach((card, i) => cards.push(makePiece(card, section, channelFromBlock(card, defCh), i + 1)));
    }
    return dedupeCards(cards);
  }

  const genericCards = wrap.querySelectorAll('.content-card, .generated-card, .output-card, article[data-content], article.content, [data-content-card]');
  if (genericCards.length) {
    genericCards.forEach((card, i) => cards.push(makePiece(card, section, channelFromBlock(card.parentElement || card, defCh), i + 1)));
    return dedupeCards(cards);
  }

  const platformBlocks = wrap.querySelectorAll('.platform-block, [data-platform], .platform');
  if (platformBlocks.length) {
    platformBlocks.forEach(block => {
      const ch = channelFromBlock(block, defCh);
      const nested = block.querySelector('.formatted-content, .content-box, [data-content], .copy');
      const inner = nested || block;
      cards.push(...splitH(inner.innerHTML, section, ch));
    });
    return dedupeCards(cards);
  }

  const fc = wrap.querySelector('.formatted-content') || wrap.querySelector('.content-box') || wrap.querySelector('[data-content]') || wrap;
  return dedupeCards(splitH(fc.innerHTML, section, defCh));
}

function splitH(html: string, section: string, channel: string): Piece[] {
  const wrap = document.createElement('div');
  wrap.innerHTML = cleanDash(html);
  const cards: Piece[] = [];
  const headings = wrap.querySelectorAll('h1, h2, h3, h4');
  if (headings.length > 0) {
    headings.forEach((hEl, idx) => {
      const title = cleanDash(hEl.textContent?.trim() || `${section} Content ${idx + 1}`);
      let body = '';
      let next = hEl.nextElementSibling;
      while (next && !['H1','H2','H3','H4'].includes(next.tagName)) { body += next.outerHTML || ''; next = next.nextElementSibling; }
      const text = cleanDash(htmlToText(body));
      cards.push({ id: section+'-'+channel.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-'+(idx+1), section, channel:cleanDash(channel), format:'', title, bodyHtml:cleanDash(body || hEl.outerHTML), bodyText:text || title, wordCount:(text || title).split(/\s+/).filter(Boolean).length });
    });
    return cards;
  }

  const text = cleanDash(htmlToText(html));
  // If n8n returns plain text with numbered pieces, turn each numbered block into
  // its own card instead of presenting five pieces as one wall of text.
  const numbered = text.split(/\n\s*(?=\d{1,2}[.)]\s+)/).map(x => x.trim()).filter(Boolean);
  if (numbered.length > 1) {
    return numbered.map((item, idx) => {
      const clean = item.replace(/^\d{1,2}[.)]\s+/, '').trim();
      const lines = clean.split(/\n+/); const title = lines[0]?.slice(0, 100) || `${section} Content ${idx + 1}`;
      const body = lines.slice(1).join('\n').trim() || clean;
      return { id: section+'-'+channel.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-'+(idx+1), section, channel:cleanDash(channel), format:'', title:cleanDash(title), bodyHtml:'<p>'+escapeHtml(body).replace(/\n/g,'</p><p>')+'</p>', bodyText:cleanDash(body), wordCount:body.split(/\s+/).filter(Boolean).length };
    });
  }
  if(text.trim()) {
    return [{ id:section+'-'+channel.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-1', section, channel:cleanDash(channel), format:'', title:section.charAt(0).toUpperCase()+section.slice(1)+' Content', bodyHtml:cleanDash(html), bodyText:text, wordCount:text.split(/\s+/).filter(Boolean).length }];
  }
  return [];
}

function escapeHtml(value: string): string {
  return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function dedupeCards(cards: Piece[]): Piece[] {
  const seen = new Set<string>();
  return cards.filter((card, index) => {
    const key = `${card.channel}|${card.title}|${card.bodyText}`.toLowerCase().replace(/\s+/g,' ').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return Boolean(card.bodyText.trim()) || index === 0;
  });
}
