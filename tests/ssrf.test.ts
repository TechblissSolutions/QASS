/** @jest-environment node */

jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

describe('SSRF protection', () => {
  beforeEach(() => {
    process.env.N8N_BASE = 'https://n8n.example.com';
    process.env.N8N_ANALYSE_PATH = '/analyse';
    process.env.N8N_GENERATE_PATH = '/generate';
    process.env.N8N_LIVE_VIEW_PATH = '/live';
    process.env.N8N_MEDIA_PATH = '/media';
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.example.com';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    process.env.SPARROW_LIVE_VIEW_SECRET = 'a]tgsv-aaa-bbb-ccc-ddd-eee-ffff-ggg';
  });

  test('rejects localhost', async () => {
    const { isPrivateHost } = await import('@/lib/server');
    expect(await isPrivateHost('http://localhost/admin')).toBe(true);
  });

  test('rejects 127.0.0.1', async () => {
    const { isPrivateHost } = await import('@/lib/server');
    expect(await isPrivateHost('http://127.0.0.1:8080')).toBe(true);
  });

  test('rejects 10.x private range', async () => {
    const { isPrivateHost } = await import('@/lib/server');
    expect(await isPrivateHost('http://10.0.0.1')).toBe(true);
  });

  test('rejects 192.168.x', async () => {
    const { isPrivateHost } = await import('@/lib/server');
    expect(await isPrivateHost('http://192.168.1.1')).toBe(true);
  });

  test('rejects 169.254.x (link-local / cloud metadata)', async () => {
    const { isPrivateHost } = await import('@/lib/server');
    expect(await isPrivateHost('http://169.254.169.254/latest/meta-data/')).toBe(true);
  });

  test('rejects IPv6 loopback', async () => {
    const { isPrivateHost } = await import('@/lib/server');
    expect(await isPrivateHost('http://[::1]/')).toBe(true);
  });

  test('rejects IPv4-mapped IPv6 loopback', async () => {
    const { isPrivateHost } = await import('@/lib/server');
    expect(await isPrivateHost('http://[::ffff:127.0.0.1]/')).toBe(true);
  });

  test('rejects .local hostnames', async () => {
    const { isPrivateHost } = await import('@/lib/server');
    expect(await isPrivateHost('http://myhost.local/')).toBe(true);
  });

  test('validateUrl rejects ftp', async () => {
    const { validateUrl } = await import('@/lib/server');
    expect(() => validateUrl('ftp://files.example.com/data')).toThrow();
  });

  test('validateUrl rejects empty string', async () => {
    const { validateUrl } = await import('@/lib/server');
    expect(() => validateUrl('')).toThrow();
  });

  test('validateUrl rejects embedded credentials', async () => {
    const { validateUrl } = await import('@/lib/server');
    expect(() => validateUrl('https://user:pass@example.com')).toThrow();
  });
});
