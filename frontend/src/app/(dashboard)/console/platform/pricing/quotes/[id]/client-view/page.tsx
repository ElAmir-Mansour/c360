'use client';

// Shareable CLIENT QUOTE route (Wave C #7) — a branded, print/PDF-optimized,
// ALWAYS-margin-masked proposal view of a saved quote. Gated on pricing:read
// (same as the detail page + the platform layout's admin:console gate). The view
// never requests include_internal and never reads the internal block, so it is
// margin-safe for every role.

import { useParams } from 'next/navigation';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { QuoteClientView } from '../../../_components/quote-client-view';

export default function PricingQuoteClientViewPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  return (
    <PermissionRedirect permission="pricing:read">
      <QuoteClientView id={id} />
    </PermissionRedirect>
  );
}
