import { describe, expect, it } from 'vitest';
import type { Consultation } from '@/lib/lex/consultations';
import type { LexContractRecord, UserDirectoryEntry } from '@/types/suites';
import {
  isEligibleAssignee,
  toAssignmentBacklogItems,
} from './unassigned-work-card';

function directoryUser(
  status: string,
  permissions: string[] = [],
): UserDirectoryEntry {
  return {
    id: 'user-1',
    first_name: 'Team',
    last_name: 'Member',
    email: 'team.member@example.test',
    status,
    roles: permissions.length
      ? [{ id: 'role-1', name: 'Legal role', permissions }]
      : [],
  };
}

describe('toAssignmentBacklogItems', () => {
  it('combines contracts and approved-request consultations in newest-first order', () => {
    const contract = {
      id: 'contract-1',
      title: 'Cloud Services Agreement',
      contract_number: 'CON-001',
      owner_name: 'Contracts Manager',
      created_at: '2026-07-20T09:00:00Z',
      metadata: { legal_request_id: 'request-contract-1' },
    } as unknown as LexContractRecord;
    const consultation = {
      id: 'consultation-1',
      consultation_number: 'CNS-001',
      title: { en: 'Regulatory advice', ar: 'استشارة تنظيمية' },
      requester_name: 'Legal Manager',
      created_at: '2026-07-21T09:00:00Z',
    } as Consultation;

    const items = toAssignmentBacklogItems({
      contracts: [contract],
      consultations: [consultation],
      locale: 'en',
    });

    expect(items.map((item) => item.kind)).toEqual(['consultation', 'contract']);
    expect(items[0]).toMatchObject({
      reference: 'CNS-001',
      title: 'Regulatory advice',
      href: '/lex/consultations/consultation-1',
    });
    expect(items[1]).toMatchObject({
      reference: 'CON-001',
      href: '/lex/contracts/contract-1',
      approvedRequest: true,
    });
  });

  it('keeps the picker usable when directory list responses omit role expansion', () => {
    expect(
      isEligibleAssignee(directoryUser('active'), 'lex:consultation:edit'),
    ).toBe(true);
    expect(
      isEligibleAssignee(
        directoryUser('active', ['lex:consultation:edit']),
        'lex:consultation:edit',
      ),
    ).toBe(true);
    expect(
      isEligibleAssignee(
        directoryUser('active', ['lex:case:edit']),
        'lex:consultation:edit',
      ),
    ).toBe(false);
    expect(
      isEligibleAssignee(directoryUser('suspended'), 'lex:consultation:edit'),
    ).toBe(false);
  });
});
