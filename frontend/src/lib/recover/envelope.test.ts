import { describe, it, expect } from 'vitest';
import { unwrapRecoverEnvelope } from './envelope';
import { entitledSubSolutionSlugs } from './products';
import type { RecoverProductView } from '@/types/recover';

describe('unwrapRecoverEnvelope', () => {
  it('unwraps a single-resource { data } envelope', () => {
    const raw = { data: { product: 'recover', label: 'Clario Recover', sub_solutions: [] } };
    expect(unwrapRecoverEnvelope<RecoverProductView>(raw)).toEqual(raw.data);
  });

  it('unwraps a paginated { data, meta } envelope to the data payload', () => {
    const raw = { data: [{ id: 'e1' }], meta: { page: 1, total: 1 } };
    expect(unwrapRecoverEnvelope<{ id: string }[]>(raw)).toEqual([{ id: 'e1' }]);
  });

  it('returns an already-unwrapped object unchanged (no data key)', () => {
    const payload = { product: 'recover', label: 'X', sub_solutions: [] };
    expect(unwrapRecoverEnvelope<RecoverProductView>(payload)).toBe(payload);
  });

  it('returns a bare array unchanged', () => {
    const arr = [{ id: 'e1' }];
    expect(unwrapRecoverEnvelope<{ id: string }[]>(arr)).toBe(arr);
  });

  it('does NOT unwrap an object that merely owns a data field among other keys', () => {
    const payload = { data: 'inline', label: 'real-payload' };
    expect(unwrapRecoverEnvelope<typeof payload>(payload)).toBe(payload);
  });

  it('tolerates null / undefined', () => {
    expect(unwrapRecoverEnvelope<null>(null)).toBeNull();
    expect(unwrapRecoverEnvelope<undefined>(undefined)).toBeUndefined();
  });
});

describe('entitledSubSolutionSlugs — defensive against the sidebar white-screen regression', () => {
  // Reproduces the production crash: the client fetcher returned the un-unwrapped
  // { data: {...} } envelope, so `products.sub_solutions` was undefined and
  // `.map` threw inside the sidebar useMemo, taking down the whole dashboard.
  it('returns [] when sub_solutions is missing (mis-shaped payload) instead of throwing', () => {
    const envelope = { data: { sub_solutions: [] } } as unknown as RecoverProductView;
    expect(() => entitledSubSolutionSlugs(envelope)).not.toThrow();
    expect(entitledSubSolutionSlugs(envelope)).toEqual([]);
  });

  it('returns [] for undefined', () => {
    expect(entitledSubSolutionSlugs(undefined)).toEqual([]);
  });

  it('returns only the active sub-solution slugs from a well-formed view', () => {
    const view = {
      product: 'recover',
      label: 'Clario Recover',
      sub_solutions: [
        { id: 'it-dr', entitlement: { active: true } },
        { id: 'cloud-dr', entitlement: { active: false } },
        { id: 'cyber-recovery', entitlement: { active: true } },
      ],
    } as unknown as RecoverProductView;
    expect(entitledSubSolutionSlugs(view)).toEqual(['it-dr', 'cyber-recovery']);
  });
});
