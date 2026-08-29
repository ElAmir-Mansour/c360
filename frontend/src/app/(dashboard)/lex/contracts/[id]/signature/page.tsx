'use client';

import { useParams } from 'next/navigation';

import { LexRouteGuard } from '../../../_guards/lex-route-guard';
import { ContractSignatureWorkspace } from './_components/contract-signature-workspace';

export default function ContractSignaturePage() {
  const params = useParams<{ id: string }>();
  const contractId = params?.id ?? '';

  return (
    <LexRouteGuard route="/lex/contracts/[id]">
      <ContractSignatureWorkspace contractId={contractId} />
    </LexRouteGuard>
  );
}
