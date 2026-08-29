"use client";

import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Building2,
  CalendarClock,
  Hash,
  MoreHorizontal,
  PencilLine,
  Plus,
  Route as RouteIcon,
  RotateCcw,
  Send,
  SlidersHorizontal,
  Trash2,
  User2,
} from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { LexRouteGuard } from "../../_guards/lex-route-guard";
import { LoadingSkeleton } from "@/components/common/loading-skeleton";
import { ErrorState } from "@/components/common/error-state";
import { SectionCard } from "@/components/suites/section-card";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { LexStatusChip, LexPriorityChip } from "@/components/lex/status-chip";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/hooks/use-auth";
import { useLocale } from "@/components/providers/locale-provider";
import { resolveLocalized } from "@/lib/i18n/localized";
import { useLexFormat } from "@/lib/lex/ksa";
import { showApiError, showSuccess } from "@/lib/toast";
import {
  lexRequestsApi,
  isContractLegalRequest,
  requestCanHaveExecutionState,
  type LegalRequest,
} from "@/lib/lex/requests";
import {
  useServiceDeskLabels,
  type ServiceDeskLabels,
} from "../_components/labels";
import { SlaPanel } from "../_components/sla-panel";
import { ApprovalPanel } from "../_components/approval-panel";
import { ExecutionPanel } from "../_components/execution-panel";
import { EditRequestDialog } from "../_components/edit-request-dialog";
import { ReclassifyDialog } from "../_components/reclassify-dialog";
import { SubmitRequestDialog } from "../_components/submit-request-dialog";
import { RequestLifecycleStepper } from "../_components/request-lifecycle-stepper";
import { RequestActivityTimeline } from "../_components/request-activity-timeline";
import { RequestFlowTab } from "../_components/request-flow-tab";
import { RouteRequestDialog } from "../_components/route-request-dialog";
import { ReviseRequestDialog } from "../_components/revise-request-dialog";
import { DeliveryRequestDialog } from "../_components/delivery-request-dialog";
import { useDetailExtraLabels } from "../_components/detail-extra-labels";
// --- Revamp wave (parallel-agent build) ---
import { RequestActionBar } from "../_components/request-action-bar";
import { SlaHeroRibbon } from "../_components/sla-hero-ribbon";
import { RequestPeopleCard } from "../_components/request-people-card";
import { RequestRelatedCard } from "../_components/request-related-card";
import { RequestActivityMini } from "../_components/request-activity-mini";
import { RequestNoteComposer } from "../_components/request-note-composer";
import { RequestToolbarNav } from "../_components/request-toolbar-nav";
import { RequestAttachmentsPanel } from "../_components/request-attachments-panel";
import {
  useServiceTypeLabel,
  usePriorityLabel,
} from "../_components/lex-enums-i18n";
import { RequestApprovalDetail } from "../_components/request-approval-detail";

type DetailTab =
  "overview" | "sla" | "approval" | "execution" | "activity" | "flow";

export default function ServiceDeskDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const { locale, direction } = useLocale();
  const f = useLexFormat();
  const labels = useServiceDeskLabels();
  const extra = useDetailExtraLabels();
  const serviceTypeLabel = useServiceTypeLabel();
  const priorityLabel = usePriorityLabel();
  const t = labels.detail;
  const id = params?.id ?? "";
  // §9/§18.4 — request operational edits map to the request edit verb.
  const canWrite =
    hasPermission("lex:request:edit") || hasPermission("lex:write");

  const [tab, setTab] = useState<DetailTab>("overview");
  const [editOpen, setEditOpen] = useState(false);
  const [reclassifyOpen, setReclassifyOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [routeOpen, setRouteOpen] = useState(false);
  const [reviseOpen, setReviseOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [attachmentsReadyForApproval, setAttachmentsReadyForApproval] =
    useState(false);
  const handleAttachmentReviewState = useCallback(
    (state: { ready: boolean }) => setAttachmentsReadyForApproval(state.ready),
    [],
  );

  const requestQuery = useQuery({
    queryKey: ["lex-legal-request", id],
    queryFn: () => lexRequestsApi.getRequest(id),
    enabled: Boolean(id),
    // A missing/forbidden request is a terminal answer — never retry 4xx (a stale
    // link to a deleted request would otherwise hammer the gateway with 404s).
    retry: (failureCount, error) => {
      const status = (error as { status?: number } | null)?.status;
      if (typeof status === "number" && status >= 400 && status < 500)
        return false;
      return failureCount < 2;
    },
  });

  const executionExpected = requestCanHaveExecutionState(
    requestQuery.data?.status,
  );

  // Execution state powers the action bar's "Confirm completeness" gate and the
  // SLA ribbon's promised-target context.
  const executionQuery = useQuery({
    queryKey: ["lex-request-execution", id],
    queryFn: () => lexRequestsApi.getExecution(id),
    enabled: Boolean(id) && executionExpected,
    retry: false,
  });

  const refresh = () => {
    void requestQuery.refetch();
    if (executionExpected) {
      void executionQuery.refetch();
    }
    void qc.invalidateQueries({ queryKey: ["lex-legal-requests"] });
  };

  const deleteMutation = useMutation({
    mutationFn: () => lexRequestsApi.deleteRequest(id),
    onSuccess: async () => {
      showSuccess(labels.confirm.deleteTitle);
      await qc.invalidateQueries({ queryKey: ["lex-legal-requests"] });
      router.push("/lex/service-desk");
    },
    onError: showApiError,
  });

  if (requestQuery.isLoading) {
    return (
      <LexRouteGuard route="/lex/service-desk/[id]">
        <div className="space-y-6" dir={direction} lang={locale}>
          <PageHeader
            title={t.loadingTitle}
            description={t.fallbackDescription}
          />
          <LoadingSkeleton variant="card" count={4} />
        </div>
      </LexRouteGuard>
    );
  }

  if (requestQuery.isError || !requestQuery.data) {
    const status = (requestQuery.error as { status?: number } | null)?.status;
    const notFound = status === 404;
    return (
      <LexRouteGuard route="/lex/service-desk/[id]">
        <div className="space-y-6" dir={direction} lang={locale}>
          <PageHeader
            title={notFound ? t.notFoundTitle : t.loadingTitle}
            description={t.fallbackDescription}
          />
          <ErrorState
            error={requestQuery.error}
            title={notFound ? t.notFoundTitle : undefined}
            message={notFound ? t.notFoundMessage : t.errorMessage}
            // A 404 is terminal — no retry; other errors (network/5xx) can retry.
            onRetry={notFound ? undefined : () => void requestQuery.refetch()}
          />
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push("/lex/service-desk")}
            >
              {t.backToList}
            </Button>
          </div>
        </div>
      </LexRouteGuard>
    );
  }

  const request = requestQuery.data;
  const title = resolveLocalized(request.title, locale) || t.loadingTitle;
  const serviceName = serviceTypeLabel(request.request_type) || t.notSet;
  const contractFlow = isContractLegalRequest(request);
  const isPendingApproval =
    request.status === "pending_requester_approval" ||
    request.status === "pending_provider_approval";

  if (isPendingApproval) {
    return (
      <LexRouteGuard route="/lex/service-desk/[id]">
        <RequestApprovalDetail
          request={request}
          serviceName={serviceName}
          onChanged={refresh}
        />
      </LexRouteGuard>
    );
  }

  // Toolbar nav (copy #, copy link, prev/next) is available to everyone; the
  // mutating actions below it are gated on write access.
  const headerActions = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <RequestToolbarNav
        requestId={request.id}
        requestNumber={request.request_number}
      />
      {canWrite ? (
        <>
          {request.status === "in_execution" ? (
            <Button
              variant="outline"
              onClick={() => setReviseOpen(true)}
              className="motion-safe:duration-fast"
            >
              <RotateCcw className="me-1.5 h-3.5 w-3.5" />
              {extra.revise.button}
            </Button>
          ) : null}
          <Button
            variant="outline"
            onClick={() => setEditOpen(true)}
            className="motion-safe:duration-fast"
          >
            <PencilLine className="me-1.5 h-3.5 w-3.5" />
            {t.edit}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label={t.reclassify}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {request.status === "draft" ? (
                <DropdownMenuItem onSelect={() => setSubmitOpen(true)}>
                  <Send className="me-2 h-3.5 w-3.5" />
                  {t.submitRequest}
                </DropdownMenuItem>
              ) : null}
              {request.status === "approved" ? (
                <DropdownMenuItem onSelect={() => setRouteOpen(true)}>
                  <RouteIcon className="me-2 h-3.5 w-3.5" />
                  {extra.route.button}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => setReclassifyOpen(true)}>
                <SlidersHorizontal className="me-2 h-3.5 w-3.5" />
                {t.reclassify}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => setDeleteOpen(true)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="me-2 h-3.5 w-3.5" />
                {t.delete}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}
    </div>
  );

  return (
    <LexRouteGuard route="/lex/service-desk/[id]">
      <div
        className="space-y-6 motion-safe:animate-fade-up"
        dir={direction}
        lang={locale}
      >
        {/* #7 Hero band — key facts + unified chips + actions */}
        <RequestHero
          request={request}
          title={title}
          serviceName={serviceName}
          labels={labels}
          actions={headerActions}
          formatDual={f.formatDual}
        />

        {/* #5 Compact, audit-grade lifecycle stepper */}
        <RequestLifecycleStepper status={request.status} requestId={id} />

        {/* #1 Status-complete "What needs me now" action bar */}
        <RequestActionBar
          request={request}
          execution={executionQuery.data}
          executionLoading={executionExpected && executionQuery.isLoading}
          executionUnavailable={executionExpected && executionQuery.isError}
          canWrite={canWrite}
          onSubmit={() => setSubmitOpen(true)}
          onRoute={() => setRouteOpen(true)}
          onRecordDelivery={() => setDeliveryOpen(true)}
          onGoToTab={(next) => setTab(next)}
          onChanged={refresh}
        />

        {/* #3 Two-column layout — tabs on the left, a persistent right rail that
            stays visible across every tab. */}
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            <Tabs value={tab} onValueChange={(v) => setTab(v as DetailTab)}>
              <TabsList>
                <TabsTrigger value="overview">
                  {extra.tabs.overview}
                </TabsTrigger>
                <TabsTrigger value="sla">{extra.tabs.sla}</TabsTrigger>
                <TabsTrigger value="approval">
                  {extra.tabs.approval}
                </TabsTrigger>
                <TabsTrigger value="execution">
                  {extra.tabs.execution}
                </TabsTrigger>
                <TabsTrigger value="flow">{extra.tabs.flow}</TabsTrigger>
                <TabsTrigger value="activity">
                  {extra.tabs.activity}
                </TabsTrigger>
              </TabsList>

              {/* #6 Overview — denser meta grid + inline add for missing fields */}
              <TabsContent value="overview" className="space-y-4">
                <SectionCard
                  title={t.overviewTitle}
                  description={t.overviewDescription}
                >
                  <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                    <MetaField
                      label={t.metaRequester}
                      value={request.requester_name}
                    />
                    <MetaField
                      label={t.metaDepartment}
                      value={request.department}
                      onAdd={canWrite ? () => setEditOpen(true) : undefined}
                      addLabel={t.edit}
                      notSet={t.notSet}
                    />
                    <MetaField label={t.metaType} value={serviceName} />
                    <MetaField
                      label={labels.list.columns.priority}
                      value={priorityLabel(request.priority)}
                    />
                    <MetaField
                      label={t.metaRequesterApproval}
                      value={request.requester_approval_required ? t.yes : t.no}
                    />
                    <MetaField
                      label={t.metaProviderApproval}
                      value={request.provider_approval_required ? t.yes : t.no}
                    />
                    <MetaField
                      label={t.metaCreated}
                      value={f.formatDual(request.created_at)}
                    />
                    <MetaField
                      label={t.metaUpdated}
                      value={f.formatRelative(request.updated_at)}
                      tabularNums
                    />
                  </dl>
                </SectionCard>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <SectionCard title={t.descriptionTitle}>
                    <p
                      className="whitespace-pre-line text-sm text-muted-foreground"
                      dir="auto"
                    >
                      {request.description || t.descriptionEmpty}
                    </p>
                  </SectionCard>
                  <SectionCard title={t.urgencyTitle}>
                    <p
                      className="whitespace-pre-line text-sm text-muted-foreground"
                      dir="auto"
                    >
                      {request.urgency_justification || t.urgencyEmpty}
                    </p>
                  </SectionCard>
                </div>
                <RequestAttachmentsPanel requestId={id} />
              </TabsContent>

              <TabsContent value="sla">
                <SlaPanel requestId={id} status={request.status} />
              </TabsContent>

              <TabsContent value="approval" className="space-y-4">
                <RequestAttachmentsPanel
                  requestId={id}
                  onReviewStateChange={handleAttachmentReviewState}
                />
                <ApprovalPanel
                  requestId={id}
                  request={request}
                  attachmentsReady={attachmentsReadyForApproval}
                  onChanged={refresh}
                />
              </TabsContent>

              <TabsContent value="execution">
                <ExecutionPanel
                  requestId={id}
                  status={request.status}
                  request={request}
                  onRecordDelivery={() => setDeliveryOpen(true)}
                  onChanged={refresh}
                />
              </TabsContent>

              <TabsContent value="flow">
                <RequestFlowTab request={request} requestId={id} />
              </TabsContent>

              <TabsContent value="activity">
                <RequestActivityTimeline
                  requestId={id}
                  status={request.status}
                  workflowInstanceId={request.workflow_instance_id}
                />
              </TabsContent>
            </Tabs>
          </div>

          {/* #2/#7/#8/#9 Persistent right rail */}
          <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
            <SlaHeroRibbon
              requestId={id}
              status={request.status}
              slaTargetSeconds={executionQuery.data?.state?.sla_target_seconds}
            />
            <RequestPeopleCard request={request} />
            <RequestRelatedCard request={request} />
            <RequestActivityMini
              requestId={id}
              onViewAll={() => setTab("activity")}
            />
            <RequestNoteComposer requestId={id} />
          </aside>
        </div>

        {/* Dialogs */}
        {canWrite ? (
          <>
            <EditRequestDialog
              open={editOpen}
              onOpenChange={setEditOpen}
              request={request}
              onSaved={refresh}
            />
            <ReclassifyDialog
              open={reclassifyOpen}
              onOpenChange={setReclassifyOpen}
              request={request}
              onSaved={refresh}
            />
            <SubmitRequestDialog
              open={submitOpen}
              onOpenChange={setSubmitOpen}
              requestId={id}
              onSaved={refresh}
            />
            {request.status === "approved" ? (
              <RouteRequestDialog
                open={routeOpen}
                onOpenChange={setRouteOpen}
                requestId={id}
                onChanged={refresh}
              />
            ) : null}
            {request.status === "in_execution" ? (
              <ReviseRequestDialog
                open={reviseOpen}
                onOpenChange={setReviseOpen}
                request={request}
                onChanged={refresh}
              />
            ) : null}
            <DeliveryRequestDialog
              open={deliveryOpen}
              onOpenChange={setDeliveryOpen}
              requestId={id}
              contractFlow={contractFlow}
              onSaved={refresh}
            />
            <ConfirmDialog
              open={deleteOpen}
              onOpenChange={setDeleteOpen}
              title={labels.confirm.deleteTitle}
              description={labels.confirm.deleteDescription(title)}
              confirmLabel={labels.confirm.deleteConfirm}
              variant="destructive"
              loading={deleteMutation.isPending}
              onConfirm={async () => {
                await deleteMutation.mutateAsync();
              }}
            />
          </>
        ) : null}
      </div>
    </LexRouteGuard>
  );
}

/* ------------------------------------------------------------------------- *
 * #7 Hero band — a full-width band carrying the request's key facts (number,
 * service, requester, created-on) plus unified status/priority chips and the
 * page actions. Flat token card surface (the shell owns the chrome now).
 * ------------------------------------------------------------------------- */

function RequestHero({
  request,
  title,
  serviceName,
  labels,
  actions,
  formatDual,
}: {
  request: LegalRequest;
  title: string;
  serviceName: string;
  labels: ServiceDeskLabels;
  actions?: ReactNode;
  formatDual: (value: string | number | Date | null | undefined) => string;
}) {
  const t = labels.detail;

  const facts: {
    key: string;
    icon: typeof Hash;
    label: string;
    value: string;
  }[] = [
    {
      key: "number",
      icon: Hash,
      label: t.metricNumber,
      value: request.request_number || t.notSet,
    },
    {
      key: "service",
      icon: Building2,
      label: t.metricService,
      value: serviceName || t.notSet,
    },
    {
      key: "requester",
      icon: User2,
      label: t.metaRequester,
      value: request.requester_name || t.notSet,
    },
    {
      key: "created",
      icon: CalendarClock,
      label: t.metaCreated,
      value: formatDual(request.created_at),
    },
  ];

  return (
    <section className="card p-6 sm:p-7">
      <div className="flex flex-col gap-5">
        <Button variant="ghost" size="sm" asChild className="-ms-2 self-start">
          <Link href="/lex/service-desk">
            <ArrowLeft
              className="me-1.5 h-3.5 w-3.5 rtl:-scale-x-100"
              aria-hidden
            />
            {t.backToList}
          </Link>
        </Button>

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <LexStatusChip
                value={request.status}
                domain="request"
                labels={labels.statusOptions}
                size="md"
              />
              <LexPriorityChip
                value={request.priority}
                labels={labels.priorityOptions}
                size="md"
              />
            </div>
            <h1
              className="text-h2 font-bold leading-tight tracking-tight text-foreground"
              dir="auto"
            >
              {title}
            </h1>
            {request.description ? (
              <p
                className="max-w-2xl text-sm leading-6 text-muted-foreground"
                dir="auto"
              >
                {request.description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>

        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {facts.map((fact) => {
            const Icon = fact.icon;
            return (
              <div
                key={fact.key}
                className="flex items-start gap-2.5 rounded-xl border border-border/60 bg-card/50 px-3 py-2.5 shadow-elevation-1"
              >
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="h-3.5 w-3.5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <dt className="text-overline font-medium uppercase tracking-wide text-muted-foreground">
                    {fact.label}
                  </dt>
                  <dd
                    className="truncate text-sm font-medium text-foreground"
                    dir="auto"
                    title={fact.value}
                  >
                    {fact.value}
                  </dd>
                </div>
              </div>
            );
          })}
        </dl>
      </div>
    </section>
  );
}

/* #6 A compact key/value field. Empty values become an inline "add" affordance
   (opens the edit dialog) when the viewer can write, otherwise a muted "not set". */
function MetaField({
  label,
  value,
  onAdd,
  addLabel,
  notSet,
  tabularNums = false,
}: {
  label: string;
  value: ReactNode;
  onAdd?: () => void;
  addLabel?: string;
  notSet?: string;
  tabularNums?: boolean;
}) {
  const isEmpty =
    value === null ||
    value === undefined ||
    (typeof value === "string" && value.trim() === "");
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-overline font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd
        className={`text-sm font-medium text-foreground${tabularNums ? " tabular-nums" : ""}`}
        dir="auto"
      >
        {isEmpty ? (
          onAdd ? (
            <button
              type="button"
              onClick={onAdd}
              className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {addLabel}
            </button>
          ) : (
            <span className="font-normal text-muted-foreground">
              {notSet ?? "—"}
            </span>
          )
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
