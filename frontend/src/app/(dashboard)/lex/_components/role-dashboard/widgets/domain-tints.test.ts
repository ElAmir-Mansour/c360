import { describe, expect, it } from 'vitest';

import { DOMAIN_TINTS, domainTintFor } from './domain-tints';

describe('DOMAIN_TINTS', () => {
  it('contains exactly the five approved tint values and preserves gallery assignments', () => {
    expect(new Set(Object.values(DOMAIN_TINTS))).toEqual(
      new Set(['blue', 'green', 'teal', 'amber', 'grey']),
    );
    expect(DOMAIN_TINTS).toEqual({
      litigation_cases: 'teal',
      service_desk: 'blue',
      matters: 'amber',
      consultations: 'green',
      investigations: 'blue',
      settlements: 'teal',
      contracts: 'teal',
      obligations: 'amber',
      documents: 'blue',
      clause_library: 'teal',
      playbooks: 'green',
      regulations: 'amber',
      signatures: 'green',
      workflow_policies: 'blue',
      compliance: 'green',
      drafting: 'amber',
      reports: 'blue',
      admin: 'grey',
    });
    expect(domainTintFor('future_domain')).toBe('grey');
  });
});
