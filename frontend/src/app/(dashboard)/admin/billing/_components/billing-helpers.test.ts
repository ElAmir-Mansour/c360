import { describe, it, expect } from 'vitest';
import { quotaPercent, quotaTone, planRelation } from './billing-helpers';

describe('quotaPercent', () => {
  it('returns null when there is no limit', () => {
    expect(quotaPercent(100, 0)).toBeNull();
    expect(quotaPercent(100, undefined)).toBeNull();
    expect(quotaPercent(100, null)).toBeNull();
  });
  it('computes a clamped percentage', () => {
    expect(quotaPercent(50, 100)).toBe(50);
    expect(quotaPercent(200, 100)).toBe(100);
  });
});

describe('quotaTone', () => {
  it('maps percentage to severity tone', () => {
    expect(quotaTone(null)).toBe('muted');
    expect(quotaTone(10)).toBe('primary');
    expect(quotaTone(80)).toBe('warning');
    expect(quotaTone(95)).toBe('danger');
  });
});

describe('planRelation', () => {
  it('classifies current/upgrade/downgrade', () => {
    expect(planRelation('professional', 'professional')).toBe('current');
    expect(planRelation('starter', 'enterprise')).toBe('upgrade');
    expect(planRelation('enterprise', 'free')).toBe('downgrade');
  });
});
