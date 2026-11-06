/** @jest-environment node */
import { releaseTrialClaim } from '@/lib/free-trial-server';

type ReleaseState = {
  visitor: { id: string; credits_total: number; credits_remaining: number; linkedin_used: boolean; blog_used: boolean };
  hasSuccessfulGeneration: boolean;
};

let mockState: ReleaseState;
let mockAdmin: { from: (table: string) => ReleaseQuery; rpc: jest.Mock };

class ReleaseQuery {
  private operation: 'select' | 'update' = 'select';
  private values: Record<string, unknown> = {};
  private filters: Array<[string, unknown]> = [];

  constructor(private readonly table: string) {}

  select() { return this; }
  update(values: Record<string, unknown>) { this.operation = 'update'; this.values = values; return this; }
  eq(key: string, value: unknown) { this.filters.push([key, value]); return this; }
  limit() { return this; }
  maybeSingle() { return this.execute(); }
  single() { return this.execute(); }

  private async execute() {
    if (this.table === 'free_trial_generations') {
      return {
        data: mockState.hasSuccessfulGeneration ? { id: 'success-1' } : null,
        error: null,
      };
    }

    if (this.table === 'free_trial_visitors' && this.operation === 'select') {
      return { data: mockState.visitor, error: null };
    }

    if (this.table === 'free_trial_visitors' && this.operation === 'update') {
      const matches = this.filters.every(([key, value]) => mockState.visitor[key as keyof ReleaseState['visitor']] === value);
      if (!matches) return { data: null, error: null };
      Object.assign(mockState.visitor, this.values);
      return { data: { id: mockState.visitor.id }, error: null };
    }

    return { data: null, error: null };
  }
}

jest.mock('@sentry/nextjs', () => ({
  captureException: jest.fn(),
}));

jest.mock('@/lib/supabase-admin', () => ({
  getSupabaseAdmin: () => mockAdmin,
}));

beforeEach(() => {
  mockState = {
    visitor: { id: 'visitor-1', credits_total: 100, credits_remaining: 50, linkedin_used: true, blog_used: false },
    hasSuccessfulGeneration: false,
  };
  mockAdmin = {
    from: (table: string) => new ReleaseQuery(table),
    rpc: jest.fn(async () => ({ error: new Error('RPC unavailable') })),
  };
});

test('uses an atomic visitor update if the release RPC fails', async () => {
  await releaseTrialClaim('visitor-1', 'linkedin');

  expect(mockState.visitor).toMatchObject({ linkedin_used: false, credits_remaining: 100 });
});

test('does not release a successful generation after the RPC fails', async () => {
  mockState.hasSuccessfulGeneration = true;
  await releaseTrialClaim('visitor-1', 'linkedin');

  expect(mockState.visitor).toMatchObject({ linkedin_used: true, credits_remaining: 50 });
});

test('does not double-credit if the RPC committed before returning an error', async () => {
  mockAdmin.rpc.mockImplementation(async () => {
    mockState.visitor.linkedin_used = false;
    mockState.visitor.credits_remaining = 100;
    return { error: new Error('Lost RPC acknowledgement') };
  });
  await releaseTrialClaim('visitor-1', 'linkedin');

  expect(mockState.visitor).toMatchObject({ linkedin_used: false, credits_remaining: 100 });
});
