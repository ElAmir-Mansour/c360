'use client';

import { useQuery } from '@tanstack/react-query';

import { enterpriseApi } from '@/lib/enterprise';

import {
  ContractDraftEditor,
  type DraftContractIdentity,
} from './contract-draft-editor';

type ContractDraftPageContentProps = Pick<
  React.ComponentProps<typeof ContractDraftEditor>,
  'contractId' | 'locale' | 'direction'
>;

export function ContractDraftPageContent({
  contractId,
  locale,
  direction,
}: ContractDraftPageContentProps) {
  const contractQuery = useQuery({
    queryKey: ['lex-contract', contractId],
    queryFn: () => enterpriseApi.lex.getContract(contractId),
    enabled: Boolean(contractId),
  });

  const contract = contractQuery.data?.contract;
  const identity: DraftContractIdentity | undefined = contract
    ? {
        title: contract.title,
        contractNumber: contract.contract_number,
        status: contract.status,
        partyAName: contract.party_a_name,
        partyBName: contract.party_b_name,
        draftDocumentText: contract.document_text,
      }
    : undefined;

  return (
    <ContractDraftEditor
      contractId={contractId}
      locale={locale}
      direction={direction}
      identity={identity}
      identityLoading={contractQuery.isLoading}
    />
  );
}
