'use client';

import { useParams } from 'next/navigation';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { QuoteDetail } from '../../_components/quote-detail';

export default function PricingQuoteDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  return (
    <PermissionRedirect permission="pricing:read">
      <QuoteDetail id={id} />
    </PermissionRedirect>
  );
}
