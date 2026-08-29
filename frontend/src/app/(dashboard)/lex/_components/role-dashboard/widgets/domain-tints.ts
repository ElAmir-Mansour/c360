export type DomainTileTint = 'blue' | 'green' | 'teal' | 'amber' | 'grey';

/**
 * Approved Step 2 tint assignments, seeded from the Legal Director gallery.
 * Keep this registry as the single source of truth; adding a tint is a design-
 * system change and is intentionally outside the workforce implementation.
 */
export const DOMAIN_TINTS = {
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
} as const satisfies Record<string, DomainTileTint>;

export const DEFAULT_DOMAIN_TINT: DomainTileTint = 'grey';

export function domainTintFor(key: string): DomainTileTint {
  return DOMAIN_TINTS[key as keyof typeof DOMAIN_TINTS] ?? DEFAULT_DOMAIN_TINT;
}
