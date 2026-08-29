"use client";


import { useParams } from "next/navigation";
import { TenantDetailContent } from "./_components/tenant-detail";

export default function TenantDetailPage() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params?.tenantId ?? "";
  return <TenantDetailContent tenantId={tenantId} />;
}
