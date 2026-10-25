/** Removes internal generation metadata while preserving audience-facing HTML/content. */
const META_LABEL = /(?:ready[- ]to[- ]publish content|publishing details|objective|call[- ]to[- ]action|cta|hashtags?\s*:\s*(?:none|n\/a|\-)?|content objective|target audience|platform notes|internal notes)\s*:?/i;
export function cleanGeneratedHtml(input: string): string {
  let html = String(input || '');
  // Remove complete metadata sections and their following metadata-only paragraphs.
  html = html.replace(/<(h[1-6]|p|div|strong|b)[^>]*>\s*(?:Ready[- ]to[- ]Publish Content|Publishing Details)\s*:?\s*<\/\1>/gi, '');
  html = html.replace(/<(p|div|li)[^>]*>\s*(?:Objective|CTA|Call[- ]to[- ]Action|Hashtags?)\s*:\s*(?:None|N\/A|[-–—])?\s*<\/\1>/gi, '');
  html = html.replace(/<(p|div|li)[^>]*>\s*(?:Objective|CTA|Call[- ]to[- ]Action|Hashtags?|Content Objective|Target Audience|Internal Notes)\s*:[\s\S]*?<\/\1>/gi, '');
  // Remove plain-text metadata tails used by some n8n templates.
  html = html.replace(/(?:<p[^>]*>\s*)?(?:Publishing Details|Objective\s*:|CTA\s*:|Call[- ]to[- ]Action\s*:|Hashtags?\s*:\s*(?:None|N\/A)?)[\s\S]*$/i, '');
  return html.replace(/(?:<p>\s*<\/p>|<div>\s*<\/div>)/gi, '').trim();
}
export function cleanGeneratedText(input: string): string {
  let text = String(input || '').replace(/\r/g, '');
  const marker = /(?:^|\n)\s*(?:Ready[- ]to[- ]Publish Content|Publishing Details)\s*:?[ \t]*(?:\n|$)/i;
  const match = marker.exec(text);
  if (match) text = text.slice(0, match.index);
  text = text.replace(/^\s*(?:Objective|CTA|Call[- ]to[- ]Action|Hashtags?)\s*:\s*(?:None|N\/A|[-–—])?\s*$/gim, '');
  text = text.replace(/^\s*(?:Objective|CTA|Call[- ]to[- ]Action|Hashtags?|Content Objective|Target Audience|Internal Notes)\s*:\s*.*$/gim, '');
  return text.replace(/\n{3,}/g, '\n\n').trim();
}


/**
 * Produces audience-facing post copy for previews and new scheduled posts.
 * The source HTML is intentionally left untouched so the Studio editor can
 * still expose production notes and scripts when the user chooses Edit.
 */
export function cleanPublishedHtml(input: string): string {
  let html = cleanGeneratedHtml(String(input || ''));

  // Internal sections are usually emitted as a heading followed by paragraphs.
  // Drop the heading and everything after it; these sections are never caption copy.
  html = html.replace(
    /<(h[1-6]|p|div|strong|b)[^>]*>\s*(?:video\s+)?(?:production\s+directions?|production\s+notes?|scene\s+breakdown|storyboard|suggested\s+publishing\s+schedule|publishing\s+schedule|review\s+notes|internal\s+review|editorial\s+notes)\s*:?[\s\S]*$/i,
    ''
  );

  // Remove standalone scene cards and common production-direction lines while
  // preserving the surrounding public-facing caption.
  html = html.replace(/<(p|div|li)[^>]*>\s*(?:scene\s*#?\d+|shot\s*#?\d+|visuals?\s*:|camera\s+(?:direction|movement)\s*:|voice[- ]?over\s*:|on[- ]screen\s+text\s*:|b[- ]?roll\s*:|transition\s*:|music(?:\s*[/&+]\s*sound\s*effects?)?\s*:|sound\s+effects?\s*:|duration\s*:|video\s+direction\s*:|production\s+note\s*:)[\s\S]*?<\/\1>/gi, '');

  // Remove plain-text labels that sometimes arrive without block wrappers.
  html = html.replace(/(?:^|\n)\s*(?:suggested\s+publishing\s+schedule|publishing\s+schedule|review\s+notes|internal\s+review|video\s+production\s+directions?)\s*:?[^<\n]*(?:\n|$)/gi, '');
  return html.replace(/(?:<p>\s*<\/p>|<div>\s*<\/div>)/gi, '').trim();
}
