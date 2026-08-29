'use client';

import { useParams } from 'next/navigation';

import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { LexRouteGuard } from '../../../_guards/lex-route-guard';

import { ContractDraftPageContent } from './_components/contract-draft-page-content';

export default function ContractDraftPage() {
  const params = useParams<{ id: string }>();
  const { locale, direction } = useLocaleOrDefault();
  const contractId = params?.id ?? '';

  return (
    <LexRouteGuard route="/lex/contracts/[id]">
      <ContractDraftPageContent
        contractId={contractId}
        locale={locale}
        direction={direction}
      />
    </LexRouteGuard>
  );
}
