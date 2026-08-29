import { describe, expect, it } from 'vitest';
import type { Consultation } from '@/lib/lex/consultations';
import {
  buildConsultationsCsv,
  consultationResolvedAt,
  formatAverageResponse,
} from './archive-utils';
import type { ConsultationArchiveLabels } from './archive-labels';

const consultation: Consultation = {
  id: 'consultation-1',
  tenant_id: 'tenant-1',
  consultation_number: 'CONS-2026/001',
  type: 'contractual',
  title: { en: 'Agency agreement review', ar: 'مراجعة اتفاقية الوكالة' },
  status: 'archived',
  priority: 'high',
  requester_user_id: 'requester-1',
  requester_name: 'Nora Al-Zahrani',
  department: 'Procurement',
  advisor_id: 'advisor-1',
  advisor_name: 'Suleiman Al-Majid',
  question: 'Please review the agreement.',
  response: 'The liability cap should be mutual.',
  responded_at: '2026-01-02T08:00:00.000Z',
  approved_at: '2026-01-03T08:00:00.000Z',
  archived_at: '2026-01-04T08:00:00.000Z',
  tags: [],
  created_by: 'requester-1',
  created_at: '2026-01-01T08:00:00.000Z',
  updated_at: '2026-01-04T08:00:00.000Z',
};

const labels = {
  export: {
    number: 'Reference',
    title: 'Title',
    type: 'Type',
    requester: 'Requester',
    department: 'Department',
    advisor: 'Advisor',
    status: 'Status',
    priority: 'Priority',
    submitted: 'Submitted',
    resolved: 'Resolved',
  },
} satisfies Pick<ConsultationArchiveLabels, 'export'>;

describe('consultation archive utilities', () => {
  it('uses the response timestamp as the reporting resolution date', () => {
    expect(consultationResolvedAt(consultation)).toBe(
      '2026-01-02T08:00:00.000Z',
    );
  });

  it('formats real average-response minutes without inventing a sample', () => {
    expect(formatAverageResponse(192, 'en')).toEqual({
      value: '3.2',
      unit: 'hrs',
    });
    expect(formatAverageResponse(0, 'en')).toBeNull();
  });

  it('exports only actual consultation list fields', () => {
    const csv = buildConsultationsCsv([consultation], 'en', labels);

    expect(csv).toContain('Agency agreement review');
    expect(csv).toContain('Suleiman Al-Majid');
    expect(csv).toContain('2026-01-02T08:00:00.000Z');
  });
});
