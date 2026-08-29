'use client';

import { useParams } from 'next/navigation';

import { LexRouteGuard } from '../../../_guards/lex-route-guard';
import { ContractNegotiationContent } from './_components/contract-negotiation-content';

export default function ContractNegotiationPage() {
  const params = useParams<{ id: string }>();
  const contractId = decodeURIComponent(params?.id ?? '');

  return (
    <LexRouteGuard route="/lex/contracts/[id]">
      <ContractNegotiationContent contractId={contractId} />
    </LexRouteGuard>
  );
}
