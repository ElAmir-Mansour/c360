import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { LexContractDetail } from '@/types/suites';
import { ContractNegotiationContent } from './_components/contract-negotiation-content';

const { getContractMock } = vi.hoisted(() => ({
  getContractMock: vi.fn(),
}));

vi.mock('@/lib/enterprise', async () => {
  const actual = await vi.importActual<typeof import('@/lib/enterprise')>(
    '@/lib/enterprise',
  );
  return {
    ...actual,
    enterpriseApi: {
      ...actual.enterpriseApi,
      lex: {
        ...actual.enterpriseApi.lex,
        getContract: getContractMock,
      },
    },
  };
});

function contractDetail(
  contract: Partial<LexContractDetail['contract']> = {},
): LexContractDetail {
  return {
    contract: {
      id: 'contract-uuid-42',
      tenant_id: 'tenant-1',
      title: 'Strategic Technology Services Agreement',
      contract_number: 'CON-2026-042',
      type: 'service_agreement',
      description: '',
      party_a_name: 'First Party',
      party_b_name: 'Second Party',
      currency: 'SAR',
      auto_renew: false,
      renewal_notice_days: 30,
      status: 'negotiation',
      owner_user_id: 'user-1',
      owner_name: 'Amina Al-Harbi',
      risk_level: 'medium',
      analysis_status: 'completed',
      document_text: '',
      current_version: 3,
      tags: [],
      metadata: {},
      created_by: 'user-1',
      created_at: '2026-07-01T00:00:00Z',
      updated_at: '2026-07-02T00:00:00Z',
      ...contract,
    },
    clauses: [],
    latest_analysis: null,
    version_count: 3,
  };
}

describe('ContractNegotiationContent', () => {
  beforeEach(() => {
    getContractMock.mockReset();
  });

  it('loads and displays the API contract number and title without exposing its UUID', async () => {
    getContractMock.mockResolvedValue(contractDetail());

    renderWithQuery(
      <ContractNegotiationContent contractId="contract-uuid-42" />,
    );

    const identityLink = await screen.findByRole('link', {
      name: 'CON-2026-042 — Strategic Technology Services Agreement',
    });
    expect(getContractMock).toHaveBeenCalledWith('contract-uuid-42');
    expect(identityLink).toHaveAttribute(
      'href',
      '/lex/contracts/contract-uuid-42',
    );
    expect(screen.queryByText('contract-uuid-42')).not.toBeInTheDocument();
  });

  it('uses the contract title as display identity when the API has no contract number', async () => {
    getContractMock.mockResolvedValue(
      contractDetail({
        title: 'Unnumbered Vendor Agreement',
        contract_number: null,
      }),
    );

    renderWithQuery(
      <ContractNegotiationContent contractId="contract-uuid-42" />,
    );

    expect(
      await screen.findByRole('link', { name: 'Unnumbered Vendor Agreement' }),
    ).toHaveAttribute('href', '/lex/contracts/contract-uuid-42');
    expect(screen.queryByText('CON-2024-089')).not.toBeInTheDocument();
    expect(screen.queryByText('contract-uuid-42')).not.toBeInTheDocument();
  });
});
