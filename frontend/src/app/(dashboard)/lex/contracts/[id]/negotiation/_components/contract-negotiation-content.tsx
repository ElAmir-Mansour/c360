'use client';

import { useQuery } from '@tanstack/react-query';

import { ErrorState } from '@/components/common/error-state';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { Skeleton } from '@/components/ui/skeleton';
import { enterpriseApi } from '@/lib/enterprise';
import { negotiationLabels } from '../_lib/negotiation-labels';
import { NegotiationWorkspace } from './negotiation-workspace';

export function ContractNegotiationContent({ contractId }: { contractId: string }) {
  const { locale, direction } = useLocaleOrDefault();
  const labels = negotiationLabels[locale];
  const contractQuery = useQuery({
    queryKey: ['lex-contract', contractId],
    queryFn: () => enterpriseApi.lex.getContract(contractId),
    enabled: Boolean(contractId),
  });

  if (contractQuery.isLoading) {
    return (
      <div
        dir={direction}
        lang={locale}
        role="status"
        aria-busy="true"
        aria-live="polite"
        className="space-y-4 py-4"
      >
        <Skeleton variant="card" />
        <Skeleton variant="card" />
        <span className="sr-only">{labels.loadingContract}</span>
      </div>
    );
  }

  if (contractQuery.isError || !contractQuery.data) {
    return (
      <div dir={direction} lang={locale} className="py-4">
        <ErrorState
          message={labels.loadError}
          error={contractQuery.error}
          onRetry={() => void contractQuery.refetch()}
        />
      </div>
    );
  }

  const contract = contractQuery.data.contract;
  const contractRef = contract.contract_number?.trim() || contract.title;

  return (
    <NegotiationWorkspace
      contractId={contract.id}
      contractRef={contractRef}
      contractTitle={contract.title}
    />
  );
}
