import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { ContractDraftPageContent } from './_components/contract-draft-page-content';

const { getContractMock } = vi.hoisted(() => ({
  getContractMock: vi.fn(),
}));

vi.mock('@/lib/enterprise', () => ({
  enterpriseApi: {
    lex: {
      getContract: getContractMock,
    },
  },
}));

describe('ContractDraftPageContent', () => {
  it('loads the current route id and maps the API contract identity into the editor', async () => {
    getContractMock.mockResolvedValueOnce({
      contract: {
        id: 'contract-api-id',
        title: 'API Master Services Agreement',
        contract_number: 'API-CON-118',
        status: 'internal_review',
        party_a_name: 'Watheeq Legal',
        party_b_name: 'Al Noor Trading',
        document_text: '',
      },
    });

    renderWithQuery(
      <ContractDraftPageContent
        contractId="contract-api-id"
        locale="en"
        direction="ltr"
      />,
    );

    expect(getContractMock).toHaveBeenCalledWith('contract-api-id');
    expect(
      await screen.findByRole('heading', {
        name: 'API Master Services Agreement',
        level: 1,
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Reference Number: API-CON-118')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Internal Review');
    expect(screen.getByText('Between Watheeq Legal and Al Noor Trading')).toBeInTheDocument();
  });
});
