import { parseForm2Html, splitIntoCards, parseLiveViewHtml } from '@/lib/parser';

describe('parser', () => {
  test('parseForm2Html reads profile fields and product options', () => {
    document.body.innerHTML = `<form>
      <input name="company_name" value="Sparrow Labs" />
      <input name="company_website" value="https://sparrow.example" />
      <textarea name="company_summary">A content company</textarea>
      <textarea name="company_details">Detailed facts</textarea>
      <textarea name="target_audience">B2B teams</textarea>
      <select name="product_or_service"><option value="Content Engine">Content Engine</option><option value="SEO">SEO</option></select>
      <textarea name="company_research">Research</textarea>
    </form>`;
    expect(parseForm2Html(document.body.innerHTML)).toEqual(expect.objectContaining({
      company_name: 'Sparrow Labs', company_website: 'https://sparrow.example', product: 'Content Engine', product_options: ['Content Engine', 'SEO'],
    }));
  });

  test('splitIntoCards separates platform blocks and headings', () => {
    const html = `<div class="platform-block"><div class="platform-title"><h3>LinkedIn</h3></div><div class="formatted-content"><h2>Post one</h2><p>Hello <strong>world</strong>.</p><h2>Post two</h2><p>Second post.</p></div></div>`;
    const cards = splitIntoCards(html, 'social', 'Social');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toEqual(expect.objectContaining({ channel: 'LinkedIn', title: 'Post one', bodyText: 'Hello world.' }));
  });

  test('parseLiveViewHtml rejects error and waiting pages', () => {
    expect(parseLiveViewHtml('<html><title>Internal Server Error</title></html>')).toBeNull();
    expect(parseLiveViewHtml('<div class="waiting">Waiting...</div>')).toBeNull();
    expect(parseLiveViewHtml('<div class="output-field"><h2>Ready</h2><p>Done</p></div>')).toContain('Ready');
    expect(parseLiveViewHtml('<div class="output-field"><h2>Error Handling</h2><p>We reduce error rates.</p></div>')).toContain('Error Handling');
  });
});

describe('n8n media payload survives sanitising', () => {
  it('reads media type/prompt/ratio from the Generate button payload', () => {
    const payload = { card_id: 'instagram-1', platform: 'Instagram', title: 'Launch', media_type: 'image', prompt: 'A bright product photo on a desk', aspect_ratio: '4:3' };
    const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    const html = '<div class="output-field"><div class="platform-stack"><article class="platform-block"><div class="platform-title"><h3>Instagram</h3></div><div class="media-stack">' +
      '<article class="media-card" data-card-id="instagram-1"><div class="media-card-head"><h4>Launch</h4><span class="type-badge">Media type: Image</span></div>' +
      '<div class="preview-tab-panel active"><div class="content-box formatted-content"><p>Hello world post text</p></div></div>' +
      '<div class="media-controls"><button type="button" class="generate-media" data-payload="' + b64 + '">Generate Media</button></div></article></div></article></div></div>';
    const parsed = parseLiveViewHtml(html);
    expect(parsed).toBeTruthy();
    const cards = splitIntoCards(parsed as string, 'social', 'Social');
    expect(cards).toHaveLength(1);
    expect(cards[0].mediaType).toBe('image');
    expect(cards[0].mediaPrompt).toBe('A bright product photo on a desk');
    expect(cards[0].aspectRatio).toBe('4:3');
    expect(cards[0].bodyText).toContain('Hello world');
  });
});
