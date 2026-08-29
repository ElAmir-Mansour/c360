"use client";


import { useParams } from "next/navigation";
import { LogDetail } from "./_components/log-detail";

export default function AuditLogDetailPage() {
  const params = useParams<{ logId: string }>();
  const logId = params?.logId ?? "";

  return <LogDetail logId={logId} />;
}
