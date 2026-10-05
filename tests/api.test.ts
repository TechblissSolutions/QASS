/** @jest-environment node */
import { NextRequest } from 'next/server';

jest.mock('@sentry/nextjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

jest.mock('@/lib/supabase', () => ({
  createProject: jest.fn(async () => ({
    id: '11111111-1111-1111-1111-111111111111',
  })),

  createJob: jest.fn(async () => ({
    id: '22222222-2222-2222-2222-222222222222',
  })),

  updateJob: jest.fn(async () => null),

  getProject: jest.fn(async () => ({
    id: '11111111-1111-1111-1111-111111111111',
    url: 'https://example.com',
    profile: {},
    prefs: {},
    brand_theme: {},
  })),

  getProjectByUrl: jest.fn(async () => null),

  countProjects: jest.fn(async () => 0),

  getUserFromToken: jest.fn(async (token: string) =>
    token
      ? {
          id: 'user-123',
          email: 'deepasuri78@gmail.com',
        }
      : null
  ),

  getSupabaseClient: jest.fn(() => null),

  getJobByExternalId: jest.fn(async () => null),
}));

jest.mock('@/lib/supabase-admin', () => ({
  createProjectWithLimit: jest.fn(async () => ({
    id: '11111111-1111-1111-1111-111111111111',
  })),
}));

const SECRET =
  'abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmno';

beforeEach(() => {
  process.env.N8N_BASE = 'https://n8n.example.com';
  process.env.N8N_ANALYSE_PATH = '/analyse';
  process.env.N8N_GENERATE_PATH = '/generate';
  process.env.N8N_LIVE_VIEW_PATH = '/live';
  process.env.N8N_MEDIA_PATH = '/media';

  process.env.NEXT_PUBLIC_SUPABASE_URL =
    'https://supabase.example.com';

  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';

  process.env.SUPABASE_SERVICE_ROLE_KEY =
    'ci-service-role-key';

  process.env.SENTRY_DSN = '';

  process.env.MAINTENANCE_MODE = 'false';

  process.env.SPARROW_LIVE_VIEW_SECRET = SECRET;

  process.env.SPARROW_OWNER_EMAILS =
    'deepasuri78@gmail.com,wqurat122@gmail.com';

  process.env.SPARROW_OWNER_USER_IDS = '';

  process.env.UPSTASH_REDIS_REST_URL = '';

  process.env.UPSTASH_REDIS_REST_TOKEN = '';

  jest.restoreAllMocks();
});

test('analyse returns 400 for invalid URLs', async () => {
  const { POST } = await import('@/app/api/analyse/route');

  const req = new NextRequest(
    'http://localhost/api/analyse',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0',
      },
      body: JSON.stringify({
        url: 'localhost',
      }),
    }
  );

  const res = await POST(req);

  expect(res.status).toBe(400);
});

test('analyse requires authentication before proxying n8n', async () => {
  const { POST } = await import('@/app/api/analyse/route');

  const req = new NextRequest(
    'http://localhost/api/analyse',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Mozilla/5.0',
      },
      body: JSON.stringify({
        url: 'https://example.com',
      }),
    }
  );

  const res = await POST(req);

  expect(res.status).toBe(401);
});

test('generate returns 400 when required fields are missing', async () => {
  const { POST } = await import('@/app/api/generate/route');

  const req = new NextRequest(
    'http://localhost/api/generate',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({}),
    }
  );

  const res = await POST(req);

  expect(res.status).toBe(400);
});

test('generate accepts JSON job_id from n8n', async () => {
  const originalFetch = global.fetch;

  global.fetch = jest.fn(
    async (input: RequestInfo | URL) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;

      if (url.includes('n8n')) {
        return new Response(
          JSON.stringify({
            html: '<div>content</div>',
            job_id: 'n8n-123',
            brandTheme: {},
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          }
        );
      }

      return originalFetch(input as any);
    }
  ) as typeof fetch;

  try {
    const { POST } = await import('@/app/api/generate/route');

    const body = {
      project_id:
        '11111111-1111-1111-1111-111111111111',
      company_name: 'Sparrow',
      company_website: 'https://example.com',
      company_summary: 'Summary',
      company_details: 'Details',
      target_audience: 'Teams',
      company_research: 'Research',
      product: 'Content',
      goal: 'Awareness',
      tone: 'Professional',
      style: 'Seth Godin',
      extra: '',
      platforms: ['LinkedIn'],
    };

    const req = new NextRequest(
      'http://localhost/api/generate',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-token',
        },
        body: JSON.stringify(body),
      }
    );

    const res = await POST(req);

    expect(res.status).toBe(200);

    expect((await res.json()).job_id).toBe(
      'n8n-123'
    );
  } finally {
    global.fetch = originalFetch;
  }
});