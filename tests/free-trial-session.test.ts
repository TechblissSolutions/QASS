/** @jest-environment node */
import { NextRequest } from 'next/server';

type TrialType = 'linkedin' | 'blog';
type Generation = { id: string; visitor_id: string; generation_type: TrialType; status: string; created_at: string; generated_content?: string };
type SessionState = {
  visitor: { id: string; credits_total: number; credits_remaining: number; linkedin_used: boolean; blog_used: boolean; updated_at: string };
  generations: Generation[];
};

let mockState: SessionState;
let mockAdmin: { from: (table: string) => SessionQuery };
let mockGetVisitor: jest.Mock;
let mockRelease: jest.Mock;

class SessionQuery {
  private operation: 'select' | 'update' = 'select';
  private values: Record<string, unknown> = {};
  private filters: Array<[string, unknown]> = [];
  private before: Array<[string, string]> = [];

  constructor(private readonly table: string) {}

  select() { return this; }
  update(values: Record<string, unknown>) { this.operation = 'update'; this.values = values; return this; }
  eq(key: string, value: unknown) { this.filters.push([key, value]); return this; }
  lt(key: string, value: string) { this.before.push([key, value]); return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { return this.execute(true); }
  single() { return this.execute(true); }
  then(resolve: (value: { data: unknown; error: null }) => unknown, reject: (error: unknown) => unknown) {
    return this.execute(false).then(resolve, reject);
  }

  private matches(row: Record<string, unknown>) {
    return this.filters.every(([key, value]) => row[key] === value)
      && this.before.every(([key, value]) => String(row[key] || '') < value);
  }

  private async execute(single: boolean): Promise<{ data: unknown; error: null }> {
    if (this.table === 'free_trial_visitors') return { data: mockState.visitor, error: null };
    if (this.table === 'marketing_leads') return { data: single ? null : [], error: null };

    if (this.table === 'free_trial_generations' && this.operation === 'update') {
      const generation = mockState.generations.find((item) => this.matches(item as unknown as Record<string, unknown>));
      if (!generation) return { data: null, error: null };
      Object.assign(generation, this.values);
      return { data: { id: generation.id }, error: null };
    }

    const rows = mockState.generations.filter((item) => this.matches(item as unknown as Record<string, unknown>));
    return { data: single ? rows[0] || null : rows, error: null };
  }
}

jest.mock('@sentry/nextjs', () => ({
  captureException: jest.fn(),
}));

jest.mock('@/lib/server', () => {
  const actual = jest.requireActual('@/lib/server');
  return { ...actual, apiGuard: jest.fn(async () => null) };
});

jest.mock('@/lib/free-trial-server', () => ({
  getTrialIdentity: () => ({ token: 'b'.repeat(43), visitorHash: 'fixed-visitor-hash', needsCookie: false }),
  getOrCreateTrialVisitor: (...args: unknown[]) => mockGetVisitor(...args),
  releaseTrialClaim: (...args: unknown[]) => mockRelease(...args),
  setTrialCookie: (response: unknown) => response,
  trialWasUsed: (visitor: SessionState['visitor']) => visitor.linkedin_used || visitor.blog_used || visitor.credits_remaining <= 0,
}));

jest.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => mockAdmin,
}));

beforeEach(() => {
  mockState = {
    visitor: {
      id: 'visitor-1',
      credits_total: 100,
      credits_remaining: 50,
      linkedin_used: true,
      blog_used: false,
      updated_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    },
    generations: [{
      id: 'pending-1',
      visitor_id: 'visitor-1',
      generation_type: 'linkedin',
      status: 'pending',
      created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    }],
  };
  mockAdmin = { from: (table: string) => new SessionQuery(table) };
  mockGetVisitor = jest.fn(async () => ({ admin: mockAdmin, visitor: { ...mockState.visitor } }));
  mockRelease = jest.fn(async (_visitorId: string, type: TrialType) => {
    const usedKey = `${type}_used` as 'linkedin_used' | 'blog_used';
    mockState.visitor[usedKey] = false;
    mockState.visitor.credits_remaining = Math.min(mockState.visitor.credits_total, mockState.visitor.credits_remaining + 50);
  });
});

test('recovers a stale pending generation and restores its flag and credits', async () => {
  const { GET } = await import('@/app/api/free-trial/session/route');
  const response = await GET(new NextRequest('http://localhost/api/free-trial/session'));
  const body = await response.json() as { success?: boolean; linkedin_used?: boolean; credits_remaining?: number };

  expect(response.status).toBe(200);
  expect(body).toMatchObject({ success: true, linkedin_used: false, credits_remaining: 100 });
  expect(mockState.generations[0].status).toBe('failed');
  expect(mockRelease).toHaveBeenCalledWith('visitor-1', 'linkedin');
});
