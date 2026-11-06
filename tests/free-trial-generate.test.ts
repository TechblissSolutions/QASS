/** @jest-environment node */
import { createServer, Server } from 'node:http';
import { NextRequest } from 'next/server';

type TrialType = 'linkedin' | 'blog';
type Generation = { id: string; visitor_id: string; generation_type: TrialType; status: string; [key: string]: unknown };
type TrialState = {
  visitor: { id: string; credits_total: number; credits_remaining: number; linkedin_used: boolean; blog_used: boolean };
  generations: Generation[];
  failSave: boolean;
  failInsert: boolean;
  failCleanup: boolean;
};

let mockState: TrialState;
let mockAdmin: { from: (table: string) => MockQuery };
let mockMode = 'success';
let mockClaimConflict = false;
let mockRequestHeaders: Headers | null = null;
let mockRequestBody: Record<string, unknown> | null = null;
let mockGetVisitor: jest.Mock;
let mockRelease: jest.Mock;

class MockQuery {
  private operation: 'select' | 'update' | 'insert' = 'select';
  private values: Record<string, unknown> = {};
  private filters: Array<[string, unknown]> = [];
  private minimums: Array<[string, number]> = [];

  constructor(private readonly table: string) {}

  select() { return this; }
  update(values: Record<string, unknown>) { this.operation = 'update'; this.values = values; return this; }
  insert(values: Record<string, unknown>) { this.operation = 'insert'; this.values = values; return this; }
  eq(key: string, value: unknown) { this.filters.push([key, value]); return this; }
  gte(key: string, value: number) { this.minimums.push([key, value]); return this; }
  maybeSingle() { return this.execute(); }
  single() { return this.execute(); }

  private matches(row: Record<string, unknown>) {
    return this.filters.every(([key, value]) => row[key] === value)
      && this.minimums.every(([key, value]) => Number(row[key]) >= value);
  }

  private async execute(): Promise<{ data: Record<string, unknown> | null; error: Error | null }> {
    if (this.table === 'free_trial_visitors' && this.operation === 'update') {
      if (!this.matches(mockState.visitor as unknown as Record<string, unknown>)) return { data: null, error: null };
      Object.assign(mockState.visitor, this.values);
      return { data: { id: mockState.visitor.id }, error: null };
    }

    if (this.table === 'free_trial_generations' && this.operation === 'insert') {
      if (mockState.failInsert) return { data: null, error: new Error('Mock generation insert failed.') };
      const generation: Generation = {
        id: `generation-${mockState.generations.length + 1}`,
        visitor_id: mockState.visitor.id,
        generation_type: this.values.generation_type as TrialType,
        status: String(this.values.status),
      };
      mockState.generations.push(generation);
      return { data: generation, error: null };
    }

    if (this.table === 'free_trial_generations' && this.operation === 'update') {
      if (this.values.status === 'failed' && mockState.failCleanup) {
        return { data: null, error: new Error('Mock failure-state update failed.') };
      }
      const generation = mockState.generations.find((item) => this.matches(item));
      if (!generation) return { data: null, error: null };
      if (this.values.status === 'success' && mockState.failSave) {
        return { data: null, error: new Error('Mock generation save failed.') };
      }
      Object.assign(generation, this.values);
      return { data: { id: generation.id }, error: null };
    }

    return { data: null, error: null };
  }
}

jest.mock('@sentry/nextjs', () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

jest.mock('@/lib/server', () => {
  const actual = jest.requireActual('@/lib/server');
  return { ...actual, apiGuard: jest.fn(async () => null) };
});

jest.mock('@/lib/free-trial-server', () => ({
  getTrialIdentity: () => ({ token: 'a'.repeat(43), visitorHash: 'fixed-visitor-hash', needsCookie: false }),
  getOrCreateTrialVisitor: (...args: unknown[]) => mockGetVisitor(...args),
  releaseTrialClaim: (...args: unknown[]) => mockRelease(...args),
  setTrialCookie: (response: unknown) => response,
  trialTypeWasUsed: (visitor: TrialState['visitor'], type: TrialType) => visitor.credits_remaining < 50 || visitor[`${type}_used`],
}));

jest.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => mockAdmin,
}));

const linkedInDraft = [
  '# LinkedIn',
  '## Content 1 — Text Post',
  '### Ready-to-Publish Content',
  'A useful LinkedIn post with a clear point for its audience.',
  '### Publishing Details',
  'CONTENT_FORMAT: Text Post',
  'MEDIA_TYPE: TEXT',
].join('\n');
const completeBlog = [
  '# A guide to better customer onboarding',
  '',
  '## Why onboarding matters',
  'A useful article body.',
  '',
  '## Conclusion',
  '',
  'Start with one clear step today and improve the onboarding process with your team.',
].join('\n');

let server: Server;
let baseUrl = '';
let routePost: (type?: TrialType) => Promise<Response>;

beforeAll(async () => {
  server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      mockRequestHeaders = new Headers(request.headers as Record<string, string>);
      try { mockRequestBody = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { mockRequestBody = null; }
      const send = () => {
        if (mockMode === 'success') {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({
            success: true,
            generation_type: mockRequestBody?.generation_type,
            content: mockRequestBody?.generation_type === 'blog' ? completeBlog : linkedInDraft,
            publishing_details: 'Text Post',
            review_notes: 'None',
            usage: { prompt_tokens: 300, completion_tokens: 80, total_tokens: 380 },
          }));
        } else if (mockMode === 'success-false') {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ success: false, error: 'Mock generation failed.' }));
        } else if (mockMode === 'empty') {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ success: true, content: '   ' }));
        } else if (mockMode === 'truncated-blog') {
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end(JSON.stringify({ success: true, generation_type: 'blog', content: '# Broken article\n\n## Ending\n\nThe response stops mid-sentence' }));
        } else if (mockMode === 'not-json') {
          response.writeHead(200, { 'content-type': 'text/plain' });
          response.end('not json');
        } else if (mockMode === '404' || mockMode === '403') {
          response.writeHead(Number(mockMode), { 'content-type': 'text/html' });
          response.end('<html>upstream unavailable</html>');
        } else if (mockMode === 'slow') {
          setTimeout(() => {
            response.writeHead(200, { 'content-type': 'application/json' });
            response.end(JSON.stringify({ success: true, content: linkedInDraft }));
          }, 180);
        }
      };
      send();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Unable to start the local trial webhook mock.');
  baseUrl = `http://127.0.0.1:${address.port}`;

  process.env.N8N_BASE = baseUrl;
  process.env.N8N_FREE_TRIAL_PATH = '/trial';
  process.env.N8N_FREE_TRIAL_AUTH_HEADER = 'X-Sparrow-Trial-Key';
  process.env.N8N_FREE_TRIAL_AUTH_VALUE = 'local-test-key';
  process.env.N8N_FREE_TRIAL_TIMEOUT_MS = '60';
  const { POST } = await import('@/app/api/free-trial/generate/route');
  routePost = (type = 'linkedin') => POST(new NextRequest('http://localhost/api/free-trial/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      generation_type: type,
      topic: 'Customer onboarding',
      target_audience: 'SaaS founders',
      content_goal: 'Engagement',
      brand_tone: 'Friendly',
      writing_style: 'Seth Godin',
      company_summary: 'A scheduling tool for growing teams.',
    }),
  }));
});

beforeEach(() => {
  mockState = {
    visitor: { id: 'visitor-1', credits_total: 100, credits_remaining: 100, linkedin_used: false, blog_used: false },
    generations: [],
    failSave: false,
    failInsert: false,
    failCleanup: false,
  };
  mockMode = 'success';
  mockClaimConflict = false;
  mockRequestHeaders = null;
  mockRequestBody = null;
  mockAdmin = { from: (table: string) => new MockQuery(table) };
  mockGetVisitor = jest.fn(async () => {
    const visitor = { ...mockState.visitor };
    if (mockClaimConflict) {
      mockState.visitor.linkedin_used = true;
      mockState.visitor.credits_remaining = 50;
    }
    return { admin: mockAdmin, visitor };
  });
  mockRelease = jest.fn(async (_visitorId: string, type: TrialType) => {
    const usedKey = `${type}_used` as 'linkedin_used' | 'blog_used';
    if (mockState.visitor[usedKey] && !mockState.generations.some((generation) => generation.generation_type === type && generation.status === 'success')) {
      mockState.visitor[usedKey] = false;
      mockState.visitor.credits_remaining = Math.min(mockState.visitor.credits_total, mockState.visitor.credits_remaining + 50);
    }
  });
  process.env.N8N_FREE_TRIAL_AUTH_VALUE = 'local-test-key';
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function responseJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

function expectReleased(type: TrialType) {
  expect(mockState.visitor[`${type}_used` as 'linkedin_used' | 'blog_used']).toBe(false);
  expect(mockState.visitor.credits_remaining).toBe(100);
  expect(mockState.generations).toHaveLength(1);
  expect(mockState.generations[0].status).toBe('failed');
}

test('saves publishable copy, optional fields, and the auth header on success', async () => {
  const response = await routePost();
  const body = await responseJson(response);

  expect(response.status).toBe(200);
  expect(body.content).toBe('A useful LinkedIn post with a clear point for its audience.');
  expect(body.publishing_details).toBe('Text Post');
  expect(body.review_notes).toBe('None');
  expect(body.content).not.toMatch(/CONTENT_FORMAT|MEDIA_TYPE/);
  expect(mockRequestHeaders?.get('x-sparrow-trial-key')).toBe('local-test-key');
  expect(mockRequestBody).not.toHaveProperty('content_config');
  expect(mockRequestBody?.company_name).toBe('');
  expect(mockState.visitor).toMatchObject({ linkedin_used: true, credits_remaining: 50 });
  expect(mockState.generations[0]).toMatchObject({ status: 'success', credits_used: 50 });
});

test('accepts a complete Blog draft and consumes only its trial credit', async () => {
  const response = await routePost('blog');
  const body = await responseJson(response);

  expect(response.status).toBe(200);
  expect(body.content).toBe(completeBlog);
  expect(mockState.visitor).toMatchObject({ blog_used: true, linkedin_used: false, credits_remaining: 50 });
  expect(mockState.generations[0]).toMatchObject({ generation_type: 'blog', status: 'success', credits_used: 50 });
});

test.each(['success-false', 'empty', 'not-json', '404', '403', 'slow', 'truncated-blog'] as const)(
  'releases the trial after the %s upstream failure',
  async (mode) => {
    mockMode = mode;
    const response = await routePost(mode === 'truncated-blog' ? 'blog' : 'linkedin');
    const body = await responseJson(response);

    expect(response.status).toBe(502);
    expect(body.error).toEqual(expect.any(String));
    expectReleased(mode === 'truncated-blog' ? 'blog' : 'linkedin');
  },
  10_000,
);

test('releases the claim when saving a successful draft to Supabase fails', async () => {
  mockState.failSave = true;
  const response = await routePost();
  const body = await responseJson(response);

  expect(response.status).toBe(502);
  expect(body.error).toMatch(/save failed/i);
  expectReleased('linkedin');
});

test('releases the claim when the pending generation row cannot be inserted', async () => {
  mockState.failInsert = true;
  const response = await routePost();
  const body = await responseJson(response);

  expect(response.status).toBe(502);
  expect(body.error).toMatch(/generation insert failed/i);
  expect(mockState.generations).toHaveLength(0);
  expect(mockState.visitor).toMatchObject({ linkedin_used: false, credits_remaining: 100 });
});

test('returns the type-used code without another reservation', async () => {
  mockState.visitor.linkedin_used = true;
  mockState.visitor.credits_remaining = 50;
  const response = await routePost();
  const body = await responseJson(response);

  expect(response.status).toBe(409);
  expect(body.code).toBe('TRIAL_TYPE_USED');
  expect(mockState.generations).toHaveLength(0);
});

test('returns a reservation-conflict code when the atomic claim loses a race', async () => {
  mockClaimConflict = true;
  const response = await routePost();
  const body = await responseJson(response);

  expect(response.status).toBe(409);
  expect(body.code).toBe('TRIAL_RESERVATION_CONFLICT');
  expect(mockState.visitor).toMatchObject({ linkedin_used: true, credits_remaining: 50 });
  expect(mockState.generations).toHaveLength(0);
});

test('returns a reserved code when failure cleanup cannot be confirmed', async () => {
  mockMode = 'success-false';
  mockState.failCleanup = true;
  const response = await routePost();
  const body = await responseJson(response);

  expect(response.status).toBe(409);
  expect(body.code).toBe('TRIAL_GENERATION_RESERVED');
  expect(mockState.visitor).toMatchObject({ linkedin_used: true, credits_remaining: 50 });
  expect(mockState.generations[0].status).toBe('pending');
});

test('checks webhook auth configuration before creating or reserving a visitor', async () => {
  delete process.env.N8N_FREE_TRIAL_AUTH_VALUE;
  const response = await routePost();
  const body = await responseJson(response);

  expect(response.status).toBe(503);
  expect(body.error).toMatch(/authentication is not configured/i);
  expect(mockGetVisitor).not.toHaveBeenCalled();
  expect(mockState.generations).toHaveLength(0);
  expect(mockState.visitor).toMatchObject({ linkedin_used: false, blog_used: false, credits_remaining: 100 });
});
