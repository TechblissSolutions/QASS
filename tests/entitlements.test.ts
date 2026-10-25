/** @jest-environment node */

import { entitlementsFor, isOwnerEmail, isOwnerUserId } from '@/lib/entitlements';

describe('entitlementsFor', () => {
  test('free plan has 1 company, no regeneration', () => {
    const e = entitlementsFor('free');
    expect(e.maxCompanies).toBe(1);
    expect(e.canRegenerate).toBe(false);
    expect(e.canUseAllFeatures).toBe(false);
  });

  test('pro plan has 5 companies with regeneration', () => {
    const e = entitlementsFor('pro');
    expect(e.maxCompanies).toBe(5);
    expect(e.canRegenerate).toBe(true);
    expect(e.canUseAllFeatures).toBe(true);
  });

  test('owner plan has unlimited companies', () => {
    const e = entitlementsFor('owner');
    expect(e.maxCompanies).toBeNull();
    expect(e.canRegenerate).toBe(true);
    expect(e.canUseAllFeatures).toBe(true);
  });
});

describe('owner detection', () => {
  beforeEach(() => {
    process.env.SPARROW_OWNER_EMAILS = 'admin@test.com, boss@co.io';
    process.env.SPARROW_OWNER_USER_IDS = 'uid-1,uid-2';
  });

  test('matches owner emails case-insensitively', () => {
    expect(isOwnerEmail('Admin@Test.com')).toBe(true);
    expect(isOwnerEmail('boss@co.io')).toBe(true);
    expect(isOwnerEmail('nobody@test.com')).toBe(false);
  });

  test('matches owner user IDs', () => {
    expect(isOwnerUserId('uid-1')).toBe(true);
    expect(isOwnerUserId('uid-999')).toBe(false);
  });

  test('handles null/undefined', () => {
    expect(isOwnerEmail(null)).toBe(false);
    expect(isOwnerEmail(undefined)).toBe(false);
    expect(isOwnerUserId(null)).toBe(false);
  });
});
