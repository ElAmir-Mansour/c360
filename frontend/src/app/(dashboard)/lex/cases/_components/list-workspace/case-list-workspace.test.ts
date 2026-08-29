import { describe, expect, it } from 'vitest';
import type { LegalCase } from '@/lib/lex/cases';
import { resolveBulkAssignmentEntity } from './case-list-workspace';

function legalCase(id: string, entityId?: string): LegalCase {
  return {
    id,
    tenant_id: 'tenant-1',
    case_number: id,
    case_type: 'commercial',
    company_status: 'plaintiff',
    title: { en: id, ar: id },
    description: '',
    status: 'open',
    priority: 'medium',
    metadata: entityId ? { beneficiary_entity_id: entityId } : {},
    created_by: 'user-1',
    created_at: '',
    updated_at: '',
  };
}

describe('resolveBulkAssignmentEntity', () => {
  it('allows cases sharing one organisational unit', () => {
    expect(
      resolveBulkAssignmentEntity(['case-1', 'case-2'], [
        legalCase('case-1', 'entity-1'),
        legalCase('case-2', 'entity-1'),
      ]),
    ).toEqual({ entityId: 'entity-1', mixed: false });
  });

  it('rejects a mixed-entity or incomplete selection', () => {
    expect(
      resolveBulkAssignmentEntity(['case-1', 'case-2'], [
        legalCase('case-1', 'entity-1'),
        legalCase('case-2', 'entity-2'),
      ]),
    ).toEqual({ mixed: true });
    expect(resolveBulkAssignmentEntity(['missing'], [])).toEqual({ mixed: true });
  });
});
