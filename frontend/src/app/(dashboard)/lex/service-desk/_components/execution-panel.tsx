"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Circle,
  ClipboardCheck,
  Plus,
  RotateCcw,
  Trash2,
  Truck,
} from "lucide-react";
import { SectionCard } from "@/components/suites/section-card";
import { StatusBadge } from "@/components/shared/status-badge";
import { DetailStatCard } from "@/components/shared/detail-stat-card";
import { EmptyState } from "@/components/common/empty-state";
import { ErrorState } from "@/components/common/error-state";
import { LoadingSkeleton } from "@/components/common/loading-skeleton";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { useLocale } from "@/components/providers/locale-provider";
import { resolveLocalized } from "@/lib/i18n/localized";
import { formatDateTime } from "@/lib/format";
import { showApiError, showSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  lexRequestsApi,
  isContractLegalRequest,
  requestCanHaveExecutionState,
  type DeliveryConfirmation,
  type LegalRequest,
  type RequirementItem,
  type RequestStatus,
} from "@/lib/lex/requests";
import { useServiceDeskLabels } from "./labels";
import { useExecutionExtraLabels } from "./execution-extra-labels";
import { RequirementSatisfyControls } from "./requirement-satisfy-controls";
import {
  buildDeliveryStatusConfig,
  buildExecutionStatusConfig,
} from "./status-config";
import { AddRequirementDialog } from "./add-requirement-dialog";
import { CompletenessDialog } from "./completeness-dialog";
import { ReturnIncompleteDialog } from "./return-incomplete-dialog";
import { DeliveryRespondDialog } from "./delivery-respond-dialog";
import {
  canAchieveDeliveryConfirmation,
  canRespondToDeliveryConfirmation,
  deliveryConfirmationRequestNote,
} from "./delivery-confirmation-eligibility";

interface ExecutionPanelProps {
  requestId: string;
  status: RequestStatus;
  request: Pick<
    LegalRequest,
    "request_type" | "subject_type" | "requester_user_id"
  >;
  onRecordDelivery: () => void;
  onChanged: () => void;
}

/**
 * useNow returns a `Date.now()` value that re-ticks on an interval (default 60s)
 * so the delivery auto-close countdown stays live without any extra deps. It is
 * dependency-free and self-clears on unmount.
 */
function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function ExecutionPanel({
  requestId,
  status,
  request,
  onRecordDelivery,
  onChanged,
}: ExecutionPanelProps) {
  const labels = useServiceDeskLabels();
  const t = labels.execution;
  const extra = useExecutionExtraLabels();
  const now = useNow();
  const { locale } = useLocale();
  const qc = useQueryClient();
  const { user, hasPermission } = useAuth();
  const canEditRequest =
    hasPermission("lex:request:edit") || hasPermission("lex:write");
  const canManageExecution = hasPermission("lex:write");
  const isRequestOwner = Boolean(
    user?.id && user.id === request.requester_user_id,
  );
  const canFulfillRequirements =
    canManageExecution || (canEditRequest && isRequestOwner);
  const canEditContract = hasPermission("lex:contract:edit");
  const contractFlow = isContractLegalRequest(request);
  const executionExpected = requestCanHaveExecutionState(status);

  const execStatusConfig = useMemo(
    () => buildExecutionStatusConfig(labels),
    [labels],
  );
  const deliveryStatusConfig = useMemo(
    () => buildDeliveryStatusConfig(labels),
    [labels],
  );

  const [addOpen, setAddOpen] = useState(false);
  const [completenessOpen, setCompletenessOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [respondTarget, setRespondTarget] =
    useState<DeliveryConfirmation | null>(null);
  const [removeTarget, setRemoveTarget] = useState<RequirementItem | null>(
    null,
  );

  const execQuery = useQuery({
    queryKey: ["lex-request-execution", requestId],
    queryFn: () => lexRequestsApi.getExecution(requestId),
    enabled: Boolean(requestId) && executionExpected,
    retry: false,
  });

  const refresh = async () => {
    await qc.invalidateQueries({
      queryKey: ["lex-request-execution", requestId],
    });
    await qc.invalidateQueries({ queryKey: ["lex-sla-clock", requestId] });
    onChanged();
  };

  const removeMutation = useMutation({
    mutationFn: (itemId: string) =>
      lexRequestsApi.deleteRequirement(requestId, itemId),
    onSuccess: async () => {
      showSuccess(t.toast.requirementRemoved);
      setRemoveTarget(null);
      await refresh();
    },
    onError: showApiError,
  });

  const achieveMutation = useMutation({
    mutationFn: (confirmationId: string) =>
      lexRequestsApi.achieveDeliveryConfirmation(requestId, confirmationId),
    onSuccess: async () => {
      showSuccess(t.toast.contractAchieved);
      await refresh();
    },
    onError: showApiError,
  });

  if (executionExpected && execQuery.isLoading) {
    return (
      <SectionCard title={t.title} description={t.description}>
        <LoadingSkeleton variant="list-item" count={3} />
      </SectionCard>
    );
  }

  if (executionExpected && execQuery.isError) {
    return (
      <SectionCard title={t.title} description={t.description}>
        <ErrorState
          error={execQuery.error}
          onRetry={() => void execQuery.refetch()}
        />
      </SectionCard>
    );
  }

  const view = execQuery.data;
  const state = view?.state ?? null;
  const requirements = view?.requirements ?? [];
  const reviewRounds = view?.review_rounds ?? [];
  const deliveries = view?.delivery_confirmations ?? [];

  if (!state) {
    return (
      <SectionCard title={t.title} description={t.description}>
        <EmptyState icon={ClipboardCheck} title={t.none} description="" />
      </SectionCard>
    );
  }

  const allRequiredSatisfied = requirements
    .filter((item) => item.required)
    .every((item) => item.satisfied);
  const roundsLeft = Math.max(
    state.max_review_rounds - state.review_round_count,
    0,
  );
  const hasOpenDelivery = deliveries.some(
    (delivery) =>
      delivery.status === "requested" || delivery.status === "achieved",
  );
  const canRecordDelivery =
    Boolean(state.clock_started_at) &&
    !hasOpenDelivery &&
    state.status !== "delivered" &&
    state.status !== "closed" &&
    state.status !== "auto_closed";

  // Feature #11: live auto-close countdown computed client-side from
  // (auto_close_at - now). Amber under 24h, red once overdue/expired.
  const describeCountdown = (autoCloseAt: string) => {
    const remainingMs = new Date(autoCloseAt).getTime() - now;
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
      return {
        label: extra.countdown.expired,
        tone: "text-error-500 dark:text-error-300",
      };
    }
    const totalMinutes = Math.floor(remainingMs / 60_000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    const tone =
      remainingMs < 24 * 60 * 60 * 1000
        ? "text-warning-700 dark:text-warning-300"
        : "text-muted-foreground";
    return {
      label: extra.countdown.autoClosesIn(
        extra.countdown.duration(days, hours, minutes),
      ),
      tone,
    };
  };

  return (
    <SectionCard
      title={t.title}
      description={t.description}
      actions={
        canManageExecution ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => setCompletenessOpen(true)}
              disabled={
                !allRequiredSatisfied ||
                state.status !== "awaiting_completeness"
              }
            >
              <CheckCircle2 className="me-1.5 h-3.5 w-3.5" />
              {t.confirmCompleteness}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setReturnOpen(true)}
              disabled={allRequiredSatisfied}
              title={allRequiredSatisfied ? t.returnIncompleteHint : undefined}
            >
              <RotateCcw className="me-1.5 h-3.5 w-3.5" />
              {t.returnIncomplete}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onRecordDelivery}
              disabled={!canRecordDelivery}
            >
              <Truck className="me-1.5 h-3.5 w-3.5" />
              {contractFlow ? t.requestContractHandover : t.requestDelivery}
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="space-y-6">
        {/* Status + completeness metrics */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <DetailStatCard
            label={t.statusLabel}
            value={
              <StatusBadge
                status={state.status}
                config={execStatusConfig}
                size="sm"
              />
            }
            tone="slate"
            href="#execution-requirements"
          />
          <DetailStatCard
            label={t.completenessLabel}
            value={
              state.completeness_confirmed_at ? (
                <span className="text-success-600 dark:text-success-300">
                  {t.completenessConfirmed}
                </span>
              ) : (
                <span className="text-warning-700 dark:text-warning-300">
                  {t.completenessPending}
                </span>
              )
            }
            tone={state.completeness_confirmed_at ? "emerald" : "gold"}
            href="#execution-requirements"
          />
        </div>

        {/* Requirements checklist */}
        <div id="execution-requirements" className="scroll-mt-24">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">{t.requirementsTitle}</p>
              <p className="text-xs text-muted-foreground">
                {t.requirementsDescription}
              </p>
            </div>
            {canManageExecution ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAddOpen(true)}
              >
                <Plus className="me-1.5 h-3.5 w-3.5" />
                {t.addRequirement}
              </Button>
            ) : null}
          </div>
          {requirements.length === 0 ? (
            <EmptyState
              icon={ClipboardCheck}
              title={t.requirementsEmpty}
              description=""
            />
          ) : (
            <div className="space-y-2">
              {requirements.map((item) => (
                <div
                  key={item.id}
                  className="relative flex flex-wrap items-center justify-between gap-3 overflow-hidden rounded-lg border px-4 py-3 ps-5"
                >
                  <span
                    className={cn(
                      "absolute inset-y-0 start-0 w-1",
                      item.satisfied
                        ? "bg-success-300/70"
                        : "bg-warning-300/70",
                    )}
                    aria-hidden
                  />
                  <div className="flex min-w-0 items-center gap-2">
                    {item.satisfied ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-success-500" />
                    ) : (
                      <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate font-medium">
                        {resolveLocalized(item.label, locale)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.kind === "attachment"
                          ? t.kindAttachment
                          : t.kindData}
                        {" · "}
                        {item.required
                          ? t.requirementRequired
                          : t.requirementOptional}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={item.satisfied ? "default" : "secondary"}>
                      {item.satisfied
                        ? t.requirementSatisfied
                        : t.requirementPending}
                    </Badge>
                    {canFulfillRequirements ? (
                      <>
                        <RequirementSatisfyControls
                          requestId={requestId}
                          item={item}
                          execLabels={t}
                          mode={canManageExecution ? "manage" : "fulfill"}
                          onChanged={refresh}
                        />
                        {canManageExecution ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setRemoveTarget(item)}
                            disabled={removeMutation.isPending}
                            aria-label={t.removeRequirement}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Review rounds */}
        <div>
          <div className="mb-2">
            <p className="text-sm font-medium">
              {t.reviewRoundsTitle}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                ({t.reviewRoundLeft(roundsLeft)})
              </span>
            </p>
            <p className="text-xs text-muted-foreground">
              {t.reviewRoundsDescription}
            </p>
          </div>
          {reviewRounds.length === 0 ? (
            <EmptyState
              icon={RotateCcw}
              title={t.reviewRoundsEmpty}
              description=""
            />
          ) : (
            <div className="space-y-2">
              {reviewRounds.map((round) => (
                <div
                  key={round.id}
                  className="relative overflow-hidden rounded-lg border px-4 py-3 ps-5"
                >
                  <span
                    className="absolute inset-y-0 start-0 w-1 bg-warning-300/70"
                    aria-hidden
                  />
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{t.roundNo(round.round_no)}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {round.reason || "—"} ·{" "}
                        {formatDateTime(round.opened_at)}
                      </p>
                    </div>
                    <Badge variant="outline">
                      {round.outcome
                        ? t.roundOutcome[round.outcome]
                        : t.roundOpen}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Delivery confirmation */}
        <div>
          <p className="text-sm font-medium">{t.deliveryTitle}</p>
          <p className="mb-2 text-xs text-muted-foreground">
            {contractFlow
              ? t.contractDeliveryDescription
              : t.deliveryDescription}
          </p>
          {deliveries.length === 0 ? (
            <EmptyState icon={Truck} title={t.deliveryEmpty} description="" />
          ) : (
            <div className="space-y-2">
              {deliveries.map((delivery) => {
                const pending = delivery.status === "requested";
                const countdown =
                  pending && delivery.auto_close_at
                    ? describeCountdown(delivery.auto_close_at)
                    : null;
                const deliveryNote = deliveryConfirmationRequestNote(delivery);
                return (
                  <div
                    key={delivery.id}
                    className="relative flex flex-wrap items-start justify-between gap-3 overflow-hidden rounded-lg border px-4 py-3 ps-5"
                  >
                    <span
                      className="absolute inset-y-0 start-0 w-1 bg-teal-400/70"
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                      <StatusBadge
                        status={delivery.status}
                        config={deliveryStatusConfig}
                        size="sm"
                      />
                      {countdown ? (
                        <p
                          className={cn(
                            "mt-1 text-xs font-medium",
                            countdown.tone,
                          )}
                        >
                          {countdown.label}
                        </p>
                      ) : delivery.auto_close_at ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t.deliveryAutoClose}:{" "}
                          {formatDateTime(delivery.auto_close_at)}
                          {delivery.responded_at
                            ? ` · ${formatDateTime(delivery.responded_at)}`
                            : ""}
                        </p>
                      ) : pending && contractFlow ? (
                        <p className="mt-1 text-xs font-medium text-warning-700 dark:text-warning-300">
                          {t.awaitingAssociateAchievement}
                        </p>
                      ) : delivery.status === "achieved" && contractFlow ? (
                        <p className="mt-1 text-xs font-medium text-info-700 dark:text-info-300">
                          {t.associateAchievedAwaitingRequester}
                        </p>
                      ) : null}
                      {deliveryNote ? (
                        <div className="mt-2 min-w-0 rounded-lg bg-muted/60 px-3 py-2">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                            {t.deliveryNote}
                          </p>
                          <p
                            className="mt-0.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground"
                            dir="auto"
                          >
                            {deliveryNote}
                          </p>
                        </div>
                      ) : null}
                      {delivery.response_note ? (
                        <p
                          className="mt-2 whitespace-pre-wrap break-words text-xs"
                          dir="auto"
                        >
                          {delivery.response_note}
                        </p>
                      ) : null}
                      {delivery.late_justification ? (
                        <div className="mt-2 rounded-lg border border-warning-300 bg-warning-50/60 px-3 py-2 dark:bg-warning-700/10">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-warning-800 dark:text-warning-200">
                            Late SLA justification
                          </p>
                          <p className="mt-0.5 whitespace-pre-wrap break-words text-sm" dir="auto">
                            {delivery.late_justification}
                          </p>
                        </div>
                      ) : null}
                    </div>
                    {canRespondToDeliveryConfirmation(
                      delivery,
                      user?.id,
                      canEditRequest,
                      contractFlow,
                    ) ? (
                      <Button
                        size="sm"
                        onClick={() => setRespondTarget(delivery)}
                        className="w-full sm:w-auto"
                      >
                        {contractFlow ? t.addFinalNotes : t.deliveryRespond}
                      </Button>
                    ) : null}
                    {canAchieveDeliveryConfirmation(
                      delivery,
                      user?.id,
                      request.requester_user_id,
                      canEditContract,
                    ) ? (
                      <Button
                        size="sm"
                        onClick={() => achieveMutation.mutate(delivery.id)}
                        disabled={achieveMutation.isPending}
                        className="w-full sm:w-auto"
                      >
                        {achieveMutation.isPending ? (
                          <span className="me-1.5 h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-e-transparent" />
                        ) : (
                          <CheckCircle2 className="me-1.5 h-3.5 w-3.5" />
                        )}
                        {t.achieveContract}
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Dialogs */}
      {canManageExecution ? (
        <>
          <AddRequirementDialog
            open={addOpen}
            onOpenChange={setAddOpen}
            requestId={requestId}
            onSaved={() => void refresh()}
          />
          <CompletenessDialog
            open={completenessOpen}
            onOpenChange={setCompletenessOpen}
            requestId={requestId}
            onSaved={() => void refresh()}
          />
          <ReturnIncompleteDialog
            open={returnOpen}
            onOpenChange={setReturnOpen}
            requestId={requestId}
            requirements={requirements}
            onSaved={() => void refresh()}
          />
          <ConfirmDialog
            open={Boolean(removeTarget)}
            onOpenChange={(open) => {
              if (!open) setRemoveTarget(null);
            }}
            title={t.confirmRemove.title}
            description={t.confirmRemove.description}
            confirmLabel={t.confirmRemove.confirm}
            variant="destructive"
            loading={removeMutation.isPending}
            onConfirm={async () => {
              if (removeTarget)
                await removeMutation.mutateAsync(removeTarget.id);
            }}
          />
        </>
      ) : null}
      {canEditRequest ? (
        <DeliveryRespondDialog
          open={Boolean(respondTarget)}
          onOpenChange={(open) => {
            if (!open) setRespondTarget(null);
          }}
          requestId={requestId}
          confirmation={respondTarget}
          contractFlow={contractFlow}
          onSaved={() => void refresh()}
        />
      ) : null}
    </SectionCard>
  );
}
