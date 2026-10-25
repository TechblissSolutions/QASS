/** @jest-environment node */

jest.mock('@sentry/nextjs', () => ({ captureException: jest.fn(), captureMessage: jest.fn() }));

describe('live-view capability tokens', () => {
  beforeEach(() => {
    process.env.SPARROW_LIVE_VIEW_SECRET = 'test-live-view-secret-that-is-long-enough';
  });

  test('creates and verifies a token for the intended job', async () => {
    const { createLiveViewToken, verifyLiveViewToken } = await import('@/lib/server');
    const token = createLiveViewToken('job-123');
    expect(verifyLiveViewToken(token, 'job-123')).toEqual({ userId: null });
    expect(verifyLiveViewToken(token, 'job-other')).toBeNull();
  });


  test('binds authenticated tokens to the intended user', async () => {
    const { createLiveViewToken, verifyLiveViewToken } = await import('@/lib/server');
    const token = createLiveViewToken('job-123', 'user-123');
    expect(verifyLiveViewToken(token, 'job-123')).toEqual({ userId: 'user-123' });
  });

  test('rejects tampered tokens', async () => {
    const { createLiveViewToken, verifyLiveViewToken } = await import('@/lib/server');
    const token = createLiveViewToken('job-123');
    const tampered = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
    expect(verifyLiveViewToken(tampered, 'job-123')).toBeNull();
  });
});


describe('server HTML sanitizer', () => {
  test('removes executable markup and event handlers while preserving safe content', async () => {
    const { sanitizeHtml } = await import('@/lib/server');
    const dirty = '<div onclick="alert(1)"><strong>Safe</strong><script>alert(1)</script><a href="javascript:alert(1)">bad</a><a href="https://example.com" target="_blank">good</a><img src="https://example.com/a.png" onerror="alert(1)"></div>';
    const clean = sanitizeHtml(dirty);
    expect(clean).toContain('<strong>Safe</strong>');
    expect(clean).toContain('href="https://example.com"');
    expect(clean).toContain('rel="noopener noreferrer"');
    expect(clean).not.toMatch(/script|onclick|onerror|javascript:/i);
  });

  test('drops dangerous unclosed blocks instead of returning their contents', async () => {
    const { sanitizeHtml } = await import('@/lib/server');
    expect(sanitizeHtml('<script>alert(1)')).toBe('');
    expect(sanitizeHtml('<iframe src="https://evil.example">')).toBe('');
  });
});
