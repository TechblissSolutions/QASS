/** @jest-environment node */
import { NextRequest } from 'next/server';
import { brandThemeComplete, mergeTheme, verifiedCompanyLogo } from '@/lib/brand-client';
import { BRAND_LOGO_SOURCE_VERSION } from '@/lib/constants';

const mockServer = {
  apiGuard: jest.fn(async () => null),
  assertPublicHttpUrl: jest.fn(async (value: string) => value),
  appearanceCacheGet: jest.fn(() => null),
  appearanceCacheSet: jest.fn(),
  fetchPublicResource: jest.fn(),
  isPrivateHost: jest.fn(async () => false),
  readResponseLimited: jest.fn(),
};

jest.mock('@/lib/server', () => mockServer);
jest.mock('@sentry/nextjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

test('uses the real lazy-loaded header logo instead of a placeholder or favicon', async () => {
  const html = `
    <html>
      <head><title>Shipra Technologies | Official</title><link rel="icon" href="/favicon.ico"></head>
      <body><header><img class="site-logo" alt="Shipra Technologies" src="/assets/header-image.png" data-src="/assets/shipra-technologies-logo.png"></header></body>
    </html>
  `;
  mockServer.fetchPublicResource.mockResolvedValue(new Response(html, { status: 200 }));
  mockServer.readResponseLimited.mockResolvedValue(Buffer.from(html));

  const { GET } = await import('@/app/api/brand-appearance/route');
  const response = await GET(
    new NextRequest('https://sparrow.example/api/brand-appearance?url=https%3A%2F%2Fshipra.example'),
  );
  const result = await response.json();

  expect(result.logo_url).toBe('https://shipra.example/assets/shipra-technologies-logo.png');
  expect(result.logo_source_version).toBe(5);
});

test('prefers the visible header logo injected by a same-site layout script over incorrect organization metadata', async () => {
  const html = `
    <html>
      <head>
        <title>Shipra Technologies</title>
        <script type="application/ld+json">{"@type":"Organization","name":"Shipra Technologies","logo":"https://shipratech.com/assets/img/logo.png"}</script>
        <script src="assets/js/layout.js"></script>
      </head>
      <body><header class="header"></header></body>
    </html>
  `;
  const layoutScript = `
    let content = '<div class="header__area-menubar-left-logo"><a href="index.html"><img class="dark-n" src="assets/img/logo-6.png" alt></a></div>';
  `;
  mockServer.fetchPublicResource.mockImplementation(async (resource: string | URL) => {
    const content = String(resource).endsWith('/assets/js/layout.js') ? layoutScript : html;
    return new Response(content, { status: 200 });
  });
  mockServer.readResponseLimited.mockImplementation(async (response: Response) =>
    Buffer.from(await response.text()),
  );

  const { GET } = await import('@/app/api/brand-appearance/route');
  const response = await GET(
    new NextRequest('https://sparrow.example/api/brand-appearance?url=https%3A%2F%2Fshipratech.com'),
  );
  const result = await response.json();

  expect(mockServer.fetchPublicResource).toHaveBeenCalledWith(
    'https://shipratech.com/assets/js/layout.js',
    expect.objectContaining({ headers: expect.any(Object) }),
  );
  expect(result.logo_url).toBe('https://shipratech.com/assets/img/logo-6.png');
  expect(result.logo_source_version).toBe(5);
});

test('refreshes previously saved logo themes after the extraction update', () => {
  expect(brandThemeComplete({
    logo_url: 'https://shipra.example/old-logo.png',
    primary_color: '#123456',
    secondary_color: '#654321',
    background_color: '#ffffff',
    text_color: '#111111',
  })).toBe(false);
});

test('only displays a valid logo confirmed by the current extraction version', () => {
  expect(verifiedCompanyLogo({
    logo_url: 'https://shipra.example/logo.png',
    logo_source_version: BRAND_LOGO_SOURCE_VERSION,
  })).toBe('https://shipra.example/logo.png');
  expect(verifiedCompanyLogo({
    logo_url: 'https://shipra.example/old-logo.png',
    logo_source_version: BRAND_LOGO_SOURCE_VERSION - 1,
  })).toBe('');
  expect(verifiedCompanyLogo({
    logo_url: 'javascript:alert(1)',
    logo_source_version: BRAND_LOGO_SOURCE_VERSION,
  })).toBe('');
});

test('does not select an unmarked header image or generic favicon as the company logo', async () => {
  const html = `
    <html>
      <head><title>Shipra Technologies</title><link rel="icon" href="/favicon.ico"><meta property="og:image" content="/campaign.png"></head>
      <body><header><img src="/assets/summer-campaign.png" alt="Summer campaign"></header></body>
    </html>
  `;
  mockServer.fetchPublicResource.mockResolvedValue(new Response(html, { status: 200 }));
  mockServer.readResponseLimited.mockResolvedValue(Buffer.from(html));

  const { GET } = await import('@/app/api/brand-appearance/route');
  const response = await GET(
    new NextRequest('https://sparrow.example/api/brand-appearance?url=https%3A%2F%2Fshipra.example'),
  );
  const result = await response.json();

  expect(result.logo_url).toBe('');
});

test('accepts a logo-marked image linked to the company homepage', async () => {
  const html = '<html><head><title>Shipra Technologies</title></head><body><header><a href="/"><img class="logo" src="/assets/logo.svg"></a></header></body></html>';
  mockServer.fetchPublicResource.mockResolvedValue(new Response(html, { status: 200 }));
  mockServer.readResponseLimited.mockResolvedValue(Buffer.from(html));

  const { GET } = await import('@/app/api/brand-appearance/route');
  const response = await GET(
    new NextRequest('https://sparrow.example/api/brand-appearance?url=https%3A%2F%2Fshipra.example'),
  );
  const result = await response.json();

  expect(result.logo_url).toBe('https://shipra.example/assets/logo.svg');
});

test('only accepts structured logo data from an organization, not a product', async () => {
  const html = `<html><head><script type="application/ld+json">{"@graph":[{"@type":"Product","logo":"/assets/product-logo.png"},{"@type":"Organization","logo":{"@type":"ImageObject","url":"/assets/company-logo.png"}}]}</script></head><body></body></html>`;
  mockServer.fetchPublicResource.mockResolvedValue(new Response(html, { status: 200 }));
  mockServer.readResponseLimited.mockResolvedValue(Buffer.from(html));

  const { GET } = await import('@/app/api/brand-appearance/route');
  const response = await GET(
    new NextRequest('https://sparrow.example/api/brand-appearance?url=https%3A%2F%2Fshipra.example'),
  );
  const result = await response.json();

  expect(result.logo_url).toBe('https://shipra.example/assets/company-logo.png');
});

test('clears a previously saved wrong logo when the refreshed site has no confirmed logo', () => {
  expect(mergeTheme(
    { logo_url: 'https://shipra.example/customer-logo.png', primary_color: '#123456' },
    { logo_url: '', logo_source_version: 5, primary_color: '#abcdef' },
  )).toMatchObject({
    logo_url: '',
    logo_source_version: 5,
    primary_color: '#abcdef',
  });
});
