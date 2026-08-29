import { describe, it, expect } from 'vitest';
import {
  entitledSubSolutionSlugs,
  recoverSubSolutionHref,
  RECOVER_PRODUCTS_ENDPOINT,
} from './products';
import type { RecoverProductView } from '@/types/recover';

function view(active: Record<string, boolean>): RecoverProductView {
  return {
    product: 'recover',
    label: 'Clario Recover',
    sub_solutions: (['it-dr', 'cloud-dr', 'cyber-recovery'] as const).map((id) => ({
      id,
      label: id,
      value_prop: '',
      entitlement_key: `recover.${id}`,
      entitlement: { key: `recover.${id}`, active: active[id] ?? false, activated: false, reason: '' },
      capabilities: [],
    })),
  };
}

describe('recover products client helpers', () => {
  it('exposes the contract endpoint', () => {
    expect(RECOVER_PRODUCTS_ENDPOINT).toBe('/api/recover/products');
  });

  it('maps slugs to canonical workspace routes', () => {
    expect(recoverSubSolutionHref('it-dr')).toBe('/recover/it-dr');
    expect(recoverSubSolutionHref('cloud-dr')).toBe('/recover/cloud-dr');
    expect(recoverSubSolutionHref('cyber-recovery')).toBe('/recover/cyber-recovery');
  });

  it('returns only active sub-solutions in stable slug order', () => {
    const products = view({ 'cyber-recovery': true, 'it-dr': true });
    expect(entitledSubSolutionSlugs(products)).toEqual(['it-dr', 'cyber-recovery']);
  });

  it('returns [] when nothing is entitled', () => {
    expect(entitledSubSolutionSlugs(view({}))).toEqual([]);
  });

  it('returns [] for undefined products', () => {
    expect(entitledSubSolutionSlugs(undefined)).toEqual([]);
  });

  it('returns all three when all entitled', () => {
    const products = view({ 'it-dr': true, 'cloud-dr': true, 'cyber-recovery': true });
    expect(entitledSubSolutionSlugs(products)).toEqual(['it-dr', 'cloud-dr', 'cyber-recovery']);
  });
});
