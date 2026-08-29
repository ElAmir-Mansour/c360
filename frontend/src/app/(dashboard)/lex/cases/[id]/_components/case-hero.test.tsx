import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { LegalCase } from '@/lib/lex/cases';
import { CaseHero } from './case-hero';

const legalCase: LegalCase = {
  id: 'case-1',
  tenant_id: 'tenant-1',
  case_number: 'CASE-2026-045',
  case_type: 'commercial',
  company_status: 'plaintiff',
  competent_court: 'Riyadh Commercial Court',
  title: { en: 'Horizon compensation claim', ar: 'دعوى التعويض ضد هورايزون' },
  description: '',
  status: 'under_procedure',
  priority: 'high',
  created_by: 'user-1',
  created_at: '2026-07-01T00:00:00Z',
  updated_at: '2026-07-20T00:00:00Z',
};

describe('CaseHero court fact', () => {
  it('never shows the retired court number, even when the row still carries one', () => {
    renderWithQuery(
      <CaseHero
        legalCase={{ ...legalCase, court_number: 'COURT-2026-118' }}
        title="Horizon compensation claim"
      />,
    );

    expect(screen.getByText('Riyadh Commercial Court')).toBeInTheDocument();
    expect(screen.queryByText('COURT-2026-118')).not.toBeInTheDocument();
  });

  it('prefers the linked reference court over the legacy free text', () => {
    renderWithQuery(
      <CaseHero
        legalCase={{
          ...legalCase,
          court_id: 'court-1',
          court: {
            id: 'court-1',
            tenant_id: legalCase.tenant_id,
            code: 'RIYADH_COMMERCIAL',
            name: { en: 'Riyadh Commercial Court (reference)', ar: 'المحكمة التجارية بالرياض' },
            active: true,
            is_system: true,
            sort: 1,
            created_at: legalCase.created_at,
            updated_at: legalCase.updated_at,
          },
        }}
        title="Horizon compensation claim"
      />,
    );

    expect(screen.getByText('Riyadh Commercial Court (reference)')).toBeInTheDocument();
    expect(screen.queryByText('Riyadh Commercial Court')).not.toBeInTheDocument();
  });
});
