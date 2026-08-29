"use client";

import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ErrorState } from "@/components/common/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocale } from "@/components/providers/locale-provider";
import { resolveLocalized } from "@/lib/i18n/localized";
import { lexRequestsApi } from "@/lib/lex/requests";
import { LexRouteGuard } from "../../../_guards/lex-route-guard";
import { RequestApprovalDetail } from "../../../service-desk/_components/request-approval-detail";
import { useServiceTypeLabel } from "../../../service-desk/_components/lex-enums-i18n";

const COPY = {
  en: {
    loading: "Loading approval request",
    error: "This approval request could not be loaded.",
    retry: "Try again",
  },
  ar: {
    loading: "جارٍ تحميل طلب الموافقة",
    error: "تعذّر تحميل طلب الموافقة هذا.",
    retry: "إعادة المحاولة",
  },
} as const;

export default function ApprovalRequestDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { locale } = useLocale();
  const copy = COPY[locale];
  const serviceTypeLabel = useServiceTypeLabel();
  const queryClient = useQueryClient();
  const requestQuery = useQuery({
    queryKey: ["lex-legal-request", id],
    queryFn: () => lexRequestsApi.getRequest(id),
    enabled: Boolean(id),
    retry: false,
  });

  const refresh = () => {
    void requestQuery.refetch();
    void queryClient.invalidateQueries({ queryKey: ["lex-my-approval-requests"] });
  };

  return (
    <LexRouteGuard route="/lex/approvals/requests/[id]">
      {requestQuery.isLoading ? (
        <div role="status" aria-label={copy.loading}>
          <Skeleton variant="detail" />
        </div>
      ) : requestQuery.isError || !requestQuery.data ? (
        <ErrorState
          title={copy.error}
          message={copy.error}
          onRetry={() => void requestQuery.refetch()}
        />
      ) : (
        <RequestApprovalDetail
          request={requestQuery.data}
          serviceName={
            serviceTypeLabel(requestQuery.data.request_type) ||
            resolveLocalized(requestQuery.data.title, locale)
          }
          backHref="/lex/approvals/requests"
          onChanged={refresh}
        />
      )}
    </LexRouteGuard>
  );
}
