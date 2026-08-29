'use client';

import { useParams } from 'next/navigation';
import { PlatformTenantDetail } from './_components/platform-tenant-detail';

export default function PlatformTenantDetailPage() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params?.tenantId ?? '';
  return <PlatformTenantDetail tenantId={tenantId} />;
}
