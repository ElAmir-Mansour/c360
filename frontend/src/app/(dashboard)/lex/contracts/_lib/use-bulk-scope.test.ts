import { describe, expect, it, vi } from 'vitest';
import type { SelectionScope } from '@/components/shared/data-table/selection-scope';
import {
  BULK_FILTER_ALLOWED_KEYS,
  MAX_BULK_CONTRACT_TARGETS,
  planBulkScope,
  sanitizeBulkFilter,
  splitScopeQuery,
} from './use-bulk-scope';

// The pure helpers under test never touch the network; stub the list client so
// importing the hook module stays side-effect free under vitest.
vi.mock('@/lib/suite-api', () => ({
  fetchSuitePaginated: vi.fn(),
}));

describe('sanitizeBulkFilter', () => {
  it('keeps allowed scalar keys and drops empty/presentation values', () => {
    const { filter, unsupported } = sanitizeBulkFilter({
      status: 'active',
      type: '',
      department: ' Legal ',
      page: '3',
      per_page: '25',
      sort: 'updated_at',
      order: 'desc',
    });
    expect(filter).toEqual({ status: 'active', department: 'Legal' });
    expect(unsupported).toEqual([]);
  });

  it('collapses single-element arrays and flags multi-value arrays', () => {
    const { filter, unsupported } = sanitizeBulkFilter({
      status: ['active'],
      type: ['nda', 'lease'],
    });
    expect(filter).toEqual({ status: 'active' });
    expect(unsupported).toEqual(['type']);
  });

  it('flags keys the bulk endpoints reject (e.g. expiry range inputs)', () => {
    const { filter, unsupported } = sanitizeBulkFilter({
      status: 'active',
      expiry_from: '2026-01-01',
      expiry_to: '2026-12-31',
    });
    expect(filter).toEqual({ status: 'active' });
    expect(unsupported.sort()).toEqual(['expiry_from', 'expiry_to']);
  });

  it('accepts every documented membership key', () => {
    const query = Object.fromEntries(
      BULK_FILTER_ALLOWED_KEYS.map((key) => [key, 'x']),
    );
    const { filter, unsupported } = sanitizeBulkFilter(query);
    expect(Object.keys(filter).sort()).toEqual([...BULK_FILTER_ALLOWED_KEYS].sort());
    expect(unsupported).toEqual([]);
  });
});

describe('planBulkScope', () => {
  it('maps a page scope to explicit contract ids', () => {
    const scope: SelectionScope = { mode: 'page', ids: ['a', 'b'] };
    expect(planBulkScope(scope)).toEqual({
      kind: 'ids',
      contractIds: ['a', 'b'],
    });
  });

  it('maps an expressible all-matching scope to a {filter} payload', () => {
    const scope: SelectionScope = {
      mode: 'all-matching',
      filterQuery: { status: 'active', search: 'msa' },
      excludedIds: [],
    };
    expect(planBulkScope(scope)).toEqual({
      kind: 'filter',
      filter: { status: 'active', search: 'msa' },
    });
  });

  it('falls back to client-side resolution when exclusions exist', () => {
    const scope: SelectionScope = {
      mode: 'all-matching',
      filterQuery: { status: 'active' },
      excludedIds: ['x'],
    };
    expect(planBulkScope(scope)).toEqual({
      kind: 'resolve',
      filterQuery: { status: 'active' },
      excludedIds: ['x'],
    });
  });

  it('falls back to client-side resolution for unsupported filter keys', () => {
    const scope: SelectionScope = {
      mode: 'all-matching',
      filterQuery: { expiry_from: '2026-01-01' },
      excludedIds: [],
    };
    expect(planBulkScope(scope)).toMatchObject({ kind: 'resolve' });
  });
});

describe('splitScopeQuery', () => {
  it('lifts search out of the filter map and drops presentation keys', () => {
    expect(
      splitScopeQuery({
        search: 'msa',
        status: 'active',
        page: '2',
        sort: 'updated_at',
      }),
    ).toEqual({ search: 'msa', filters: { status: 'active' } });
  });

  it('omits an empty search', () => {
    expect(splitScopeQuery({ search: '', status: 'active' })).toEqual({
      search: undefined,
      filters: { status: 'active' },
    });
  });
});

describe('cap contract mirror', () => {
  it('matches service.MaxBulkContracts', () => {
    expect(MAX_BULK_CONTRACT_TARGETS).toBe(1000);
  });
});
