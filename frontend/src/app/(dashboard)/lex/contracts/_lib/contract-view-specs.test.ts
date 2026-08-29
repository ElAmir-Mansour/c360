import { describe, expect, it } from 'vitest';
import {
  CONTRACTS_ALL_VIEW,
  CONTRACTS_DEFAULT_SORT,
  CONTRACT_MONEY_VIEWS,
  contractViewHref,
  isContractViewActive,
} from '@/app/(dashboard)/lex/contracts/_lib/contract-view-specs';

const DEFAULT_SORT = {
  column: CONTRACTS_DEFAULT_SORT.column,
  direction: CONTRACTS_DEFAULT_SORT.direction,
};

describe('isContractViewActive', () => {
  it('matches a filter-only view under the default ordering', () => {
    const view = { filters: { status: 'active' } };
    expect(isContractViewActive(view, { status: 'active' }, DEFAULT_SORT)).toBe(true);
    // Omitted sort is treated as the register default.
    expect(isContractViewActive(view, { status: 'active' }, undefined)).toBe(true);
  });

  it('rejects superset and partially-overlapping filter states', () => {
    const view = { filters: { status: 'active' } };
    expect(
      isContractViewActive(view, { status: 'active', risk_level: 'high' }, DEFAULT_SORT),
    ).toBe(false);
    expect(isContractViewActive(view, { status: 'draft' }, DEFAULT_SORT)).toBe(false);
    expect(isContractViewActive(view, {}, DEFAULT_SORT)).toBe(false);
  });

  it('never matches an array-valued (multi-select) filter against a scalar spec', () => {
    expect(
      isContractViewActive(
        { filters: { status: 'active' } },
        { status: ['active', 'draft'] },
        DEFAULT_SORT,
      ),
    ).toBe(false);
  });

  it('treats ordering as part of a view identity', () => {
    const { pendingSignature } = CONTRACT_MONEY_VIEWS;
    const filters = { status: 'pending_signature' };

    // The money tile only reads as selected under its own by-value ordering…
    expect(
      isContractViewActive(pendingSignature, filters, {
        column: 'total_value',
        direction: 'desc',
      }),
    ).toBe(true);
    expect(isContractViewActive(pendingSignature, filters, DEFAULT_SORT)).toBe(false);

    // …and the count tile covering the SAME rows stays independently selectable.
    const countTile = { filters };
    expect(isContractViewActive(countTile, filters, DEFAULT_SORT)).toBe(true);
    expect(
      isContractViewActive(countTile, filters, {
        column: 'total_value',
        direction: 'desc',
      }),
    ).toBe(false);
  });

  it('matches the unfiltered register only when nothing is applied', () => {
    expect(isContractViewActive(CONTRACTS_ALL_VIEW, {}, DEFAULT_SORT)).toBe(true);
    expect(isContractViewActive(CONTRACTS_ALL_VIEW, { status: 'active' }, DEFAULT_SORT)).toBe(
      false,
    );
    // A leftover by-value sort means a money tile — not "all" — is showing.
    expect(
      isContractViewActive(CONTRACTS_ALL_VIEW, {}, { column: 'total_value', direction: 'desc' }),
    ).toBe(false);
  });
});

describe('contractViewHref', () => {
  it('serializes filters plus the view ordering', () => {
    expect(contractViewHref(CONTRACT_MONEY_VIEWS.expiring30)).toBe(
      '/lex/contracts?status=active&expiring_in_days=30&sort=expiry_date&order=asc',
    );
  });

  it('falls back to the register default ordering', () => {
    expect(contractViewHref({ filters: { status: 'active' } })).toBe(
      `/lex/contracts?status=active&sort=${CONTRACTS_DEFAULT_SORT.column}&order=${CONTRACTS_DEFAULT_SORT.direction}`,
    );
  });
});
