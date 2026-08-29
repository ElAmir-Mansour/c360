"use client";

/**
 * #15 "What needs you now" — the status-complete Legal Service Desk request-detail
 * action bar.
 *
 * The previous inline bar (in `[id]/page.tsx`) mapped only draft→submit,
 * approved→route, in_execution→completeness and delivered→delivery; EVERY
 * approval/review status fell through to a dead muted "this request advances
 * through its workflow" line — even when a real pending "Approve request" task
 * sat two tabs away. This component covers all eleven {@link RequestStatus}
 * tokens and, for the pending-approval states, surfaces the decision inline
 * (approve/reject on the request approve verb) so an approver never has to hunt
 * for the Approval tab.
 *
 * Self-contained: it owns the approval-task query + decision mutation and a
 * private presentational `ActionBar` (same chrome as the page's original bar).
 * Write-driven actions (submit/route/completeness/delivery) are delegated to the
 * parent via callbacks so the parent keeps ownership of its dialogs; approval is
 * gated on the DISTINCT `lex:request:approve` verb (not `canWrite`).
 */

import type { ReactNode } from "react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  Route as RouteIcon,
  Send,
  Truck,
  XCircle,
} from "lucide-react";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { showApiError, showSuccess } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  lexRequestsApi,
  requestCanHaveApprovalTasks,
  type ApprovalTask,
  type ExecutionStateView,
  type LegalRequest,
} from "@/lib/lex/requests";
import { useDetailExtraLabels } from "./detail-extra-labels";
import { useRequestActionBarLabels } from "./request-action-bar-labels";
import { useApprovalTaskLabel } from "./lex-enums-i18n";
import { actionableRequestApprovalTasks } from "./request-approval-task-eligibility";

export interface RequestActionBarProps {
  request: LegalRequest;
  /** Execution read model (parent already fetches `getExecution`). */
  execution: ExecutionStateView | undefined;
  /** Whether the parent execution query is still resolving. */
  executionLoading?: boolean;
  /** Whether the parent execution query failed for an execution-capable request. */
  executionUnavailable?: boolean;
  /** `hasPermission('lex:request:edit')` — gates the write-driven actions. */
  canWrite: boolean;
  /** Open the submit dialog (draft → submitted). */
  onSubmit: () => void;
  /** Open the route dialog (approved → routed). */
  onRoute: () => void;
  /** Open the record-delivery dialog once execution completeness is confirmed. */
  onRecordDelivery: () => void;
  /** Switch the detail tabs to the given panel. */
  onGoToTab: (tab: "approval" | "execution") => void;
  /** Refetch the request/execution after an inline approve/reject. */
  onChanged: () => void;
}

export function RequestActionBar({
  request,
  execution,
  executionLoading = false,
  executionUnavailable = false,
  canWrite,
  onSubmit,
  onRoute,
  onRecordDelivery,
  onGoToTab,
  onChanged,
}: RequestActionBarProps) {
  const ab = useDetailExtraLabels().actionBar;
  const l = useRequestActionBarLabels();
  const approvalTaskLabel = useApprovalTaskLabel();
  const { hasPermission } = useAuth();
  const qc = useQueryClient();

  // §9/§18.4 — approval gates strictly on the request approve verb (NOT the
  // coarse write verb), so a non-approver never sees approve/reject controls.
  const canApprove = hasPermission("lex:request:approve");

  const isPendingApproval =
    request.status === "pending_requester_approval" ||
    request.status === "pending_provider_approval";
  const hasWorkflow = requestCanHaveApprovalTasks(request.workflow_instance_id);

  const [notes, setNotes] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);

  // Shares the query key with ApprovalPanel so the two surfaces stay in sync.
  const tasksQuery = useQuery({
    queryKey: ["lex-approval-tasks", request.id],
    queryFn: () => lexRequestsApi.listApprovalTasks(request.id),
    enabled: isPendingApproval && Boolean(request.id) && hasWorkflow,
    retry: false,
  });

  const actionableTasks = actionableRequestApprovalTasks(tasksQuery.data ?? []);
  const pendingTask: ApprovalTask | undefined = actionableTasks[0];

  const decideMutation = useMutation({
    mutationFn: (vars: {
      task: ApprovalTask;
      decision: "approve" | "reject";
    }) =>
      lexRequestsApi.decideApprovalTask(
        request.id,
        vars.task.instance_id,
        vars.task.id,
        {
          decision: vars.decision,
          notes: notes.trim() || undefined,
        },
      ),
    onSuccess: async () => {
      showSuccess(l.decisionSuccess);
      setNotes("");
      setRejectOpen(false);
      await qc.invalidateQueries({
        queryKey: ["lex-approval-tasks", request.id],
      });
      onChanged();
    },
    onError: showApiError,
  });

  const readOnlyBar = (
    <ActionBar heading={ab.heading} muted text={ab.readOnly} />
  );

  const renderApproval = (): ReactNode => {
    if (!canApprove) {
      // Awaiting someone else's decision — offer a jump to the approval tab.
      return (
        <ActionBar
          heading={ab.heading}
          text={l.awaitingOthersHint}
          action={
            <Button variant="outline" onClick={() => onGoToTab("approval")}>
              {l.openApproval}
              <ArrowRight className="ms-1.5 h-4 w-4 rtl:rotate-180" />
            </Button>
          }
        />
      );
    }

    if (tasksQuery.isLoading) {
      return (
        <ActionBar
          heading={ab.heading}
          text={l.loadingTasks}
          action={
            <Loader2
              className="h-4 w-4 animate-spin text-muted-foreground"
              aria-hidden
            />
          }
        />
      );
    }

    if (!pendingTask) {
      // Workflow present but no open task assignable here (or task load failed) —
      // degrade to the approval tab rather than a dead end.
      return (
        <ActionBar
          heading={ab.heading}
          text={l.awaitingOthersHint}
          action={
            <Button variant="outline" onClick={() => onGoToTab("approval")}>
              {l.openApproval}
              <ArrowRight className="ms-1.5 h-4 w-4 rtl:rotate-180" />
            </Button>
          }
        />
      );
    }

    return (
      <ActionBar
        heading={ab.heading}
        text={l.pendingApprovalHint}
        action={
          <Badge variant="secondary">
            {l.openTaskCount(actionableTasks.length)}
          </Badge>
        }
      >
        <div className="space-y-3">
          {pendingTask.name ? (
            <p className="text-sm font-medium text-foreground" dir="auto">
              {approvalTaskLabel(pendingTask.name)}
            </p>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="request-action-bar-notes">
              {l.decisionNotesLabel}
            </Label>
            <Textarea
              id="request-action-bar-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={l.decisionNotesPlaceholder}
              rows={2}
              disabled={decideMutation.isPending}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() =>
                decideMutation.mutate({
                  task: pendingTask,
                  decision: "approve",
                })
              }
              disabled={decideMutation.isPending}
            >
              {decideMutation.isPending ? (
                <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <CheckCircle2 className="me-1.5 h-4 w-4" aria-hidden />
              )}
              {decideMutation.isPending ? l.deciding : l.approve}
            </Button>
            <Button
              variant="destructive"
              onClick={() => setRejectOpen(true)}
              disabled={decideMutation.isPending}
            >
              <XCircle className="me-1.5 h-4 w-4" aria-hidden />
              {l.reject}
            </Button>
          </div>
        </div>
      </ActionBar>
    );
  };

  const renderBody = (): ReactNode => {
    switch (request.status) {
      case "draft":
        if (!canWrite) return readOnlyBar;
        return (
          <ActionBar
            heading={ab.heading}
            text={ab.submitHint}
            action={
              <Button onClick={onSubmit}>
                <Send className="me-1.5 h-4 w-4" aria-hidden />
                {ab.submit}
              </Button>
            }
          />
        );

      case "submitted":
        // Holding state — approval has not spawned yet; nothing to act on.
        return <ActionBar heading={ab.heading} muted text={l.submittedHint} />;

      case "pending_requester_approval":
      case "pending_provider_approval":
        return renderApproval();

      case "approved":
        if (!canWrite) return readOnlyBar;
        return (
          <ActionBar
            heading={ab.heading}
            text={ab.routeHint}
            action={
              <Button onClick={onRoute}>
                <RouteIcon className="me-1.5 h-4 w-4" aria-hidden />
                {ab.route}
              </Button>
            }
          />
        );

      case "routed":
      case "in_execution":
        if (!canWrite) return readOnlyBar;
        if (executionLoading || executionUnavailable || !execution) {
          return (
            <ActionBar
              heading={ab.heading}
              text={
                executionUnavailable
                  ? l.executionUnavailable
                  : l.loadingExecution
              }
              action={
                <Button
                  variant="outline"
                  onClick={() => onGoToTab("execution")}
                >
                  {l.openExecution}
                  <ArrowRight
                    className="ms-1.5 h-4 w-4 rtl:rotate-180"
                    aria-hidden
                  />
                </Button>
              }
            />
          );
        }
        const executionAction = resolveExecutionPrimaryAction(execution);
        if (executionAction.kind === "manage_delivery") {
          return (
            <ActionBar
              heading={ab.heading}
              text={ab.deliveryHint}
              action={
                <Button onClick={() => onGoToTab("execution")}>
                  <Truck className="me-1.5 h-4 w-4" aria-hidden />
                  {ab.delivery}
                  <ArrowRight
                    className="ms-1.5 h-4 w-4 rtl:rotate-180"
                    aria-hidden
                  />
                </Button>
              }
            />
          );
        }
        if (executionAction.kind === "record_delivery") {
          return (
            <ActionBar
              heading={ab.heading}
              text={ab.recordDeliveryHint}
              action={
                <Button onClick={onRecordDelivery}>
                  <Truck className="me-1.5 h-4 w-4" aria-hidden />
                  {ab.recordDelivery}
                </Button>
              }
            />
          );
        }
        if (executionAction.kind === "confirm_completeness") {
          return (
            <ActionBar
              heading={ab.heading}
              text={ab.confirmCompletenessHint}
              action={
                <Button onClick={() => onGoToTab("execution")}>
                  <CheckCircle2 className="me-1.5 h-4 w-4" aria-hidden />
                  {ab.confirmCompleteness}
                  <ArrowRight
                    className="ms-1.5 h-4 w-4 rtl:rotate-180"
                    aria-hidden
                  />
                </Button>
              }
            />
          );
        }
        return (
          <ActionBar
            heading={ab.heading}
            text={l.outstandingItems(executionAction.outstandingCount)}
            action={
              <Button variant="outline" onClick={() => onGoToTab("execution")}>
                {l.openExecution}
                <ArrowRight
                  className="ms-1.5 h-4 w-4 rtl:rotate-180"
                  aria-hidden
                />
              </Button>
            }
          />
        );

      case "delivered":
        if (!canWrite) return readOnlyBar;
        return (
          <ActionBar
            heading={ab.heading}
            text={ab.deliveryHint}
            action={
              <Button onClick={() => onGoToTab("execution")}>
                <Truck className="me-1.5 h-4 w-4" aria-hidden />
                {ab.delivery}
                <ArrowRight
                  className="ms-1.5 h-4 w-4 rtl:rotate-180"
                  aria-hidden
                />
              </Button>
            }
          />
        );

      case "closed":
        return <ActionBar heading={ab.heading} muted text={l.closedHint} />;
      case "returned": {
        // A returned-incomplete request is NOT terminal for the OWNER: the
        // reviewer flagged outstanding requirement(s) the requester must satisfy
        // on the Execution tab, then resubmit. Previously this dead-ended on a
        // muted "no longer in the active lifecycle" hint, so the requester never
        // reached the requirement. Non-writers keep the muted terminal hint.
        if (!canWrite) {
          return <ActionBar heading={ab.heading} muted text={l.returnedHint} />;
        }
        if (executionLoading || executionUnavailable || !execution) {
          return (
            <ActionBar
              heading={ab.heading}
              text={
                executionUnavailable
                  ? l.executionUnavailable
                  : l.loadingExecution
              }
              action={
                <Button
                  variant="outline"
                  onClick={() => onGoToTab("execution")}
                >
                  {l.openExecution}
                  <ArrowRight
                    className="ms-1.5 h-4 w-4 rtl:rotate-180"
                    aria-hidden
                  />
                </Button>
              }
            />
          );
        }
        const returnedOutstanding =
          resolveExecutionPrimaryAction(execution).outstandingCount;
        if (returnedOutstanding === 0) {
          return <ActionBar heading={ab.heading} muted text={l.returnedHint} />;
        }
        return (
          <ActionBar
            heading={ab.heading}
            text={l.outstandingItems(returnedOutstanding)}
            action={
              <Button onClick={() => onGoToTab("execution")}>
                {l.openExecution}
                <ArrowRight
                  className="ms-1.5 h-4 w-4 rtl:rotate-180"
                  aria-hidden
                />
              </Button>
            }
          />
        );
      }
      case "cancelled":
        return <ActionBar heading={ab.heading} muted text={l.cancelledHint} />;

      default:
        return <ActionBar heading={ab.heading} muted text={ab.noneHint} />;
    }
  };

  return (
    <>
      {renderBody()}
      {isPendingApproval && canApprove ? (
        <ConfirmDialog
          open={rejectOpen}
          onOpenChange={(open) => {
            if (!open) setRejectOpen(false);
          }}
          title={l.rejectConfirm.title}
          description={l.rejectConfirm.description}
          confirmLabel={l.rejectConfirm.confirm}
          variant="destructive"
          loading={decideMutation.isPending}
          onConfirm={async () => {
            if (pendingTask) {
              await decideMutation.mutateAsync({
                task: pendingTask,
                decision: "reject",
              });
            }
          }}
        />
      ) : null}
    </>
  );
}

export function resolveExecutionPrimaryAction(execution: ExecutionStateView): {
  kind:
    | "confirm_completeness"
    | "record_delivery"
    | "manage_delivery"
    | "outstanding";
  outstandingCount: number;
} {
  const outstandingCount = execution.requirements.filter(
    (requirement) => requirement.required && !requirement.satisfied,
  ).length;
  const state = execution.state;
  const hasOpenDelivery = execution.delivery_confirmations.some(
    (delivery) =>
      delivery.status === "requested" || delivery.status === "achieved",
  );

  if (
    hasOpenDelivery ||
    state?.status === "delivered" ||
    Boolean(state?.delivered_at)
  ) {
    return { kind: "manage_delivery", outstandingCount };
  }
  if (
    state?.status === "in_progress" ||
    Boolean(state?.completeness_confirmed_at) ||
    Boolean(state?.clock_started_at)
  ) {
    return { kind: "record_delivery", outstandingCount };
  }
  if (outstandingCount === 0) {
    return { kind: "confirm_completeness", outstandingCount };
  }
  return { kind: "outstanding", outstandingCount };
}

/* ------------------------------------------------------------------------- *
 * Private presentational bar — same chrome as the page's original inline
 * `ActionBar`: a rounded-2xl band with an overline heading + one line of text
 * on the start and action(s) on the end, plus an optional full-width body slot
 * (used by the inline approval editor). Actionable = primary-tinted;
 * `muted` = neutral surface.
 * ------------------------------------------------------------------------- */

function ActionBar({
  heading,
  text,
  action,
  muted = false,
  children,
}: {
  heading: string;
  text: string;
  action?: ReactNode;
  muted?: boolean;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-3",
        muted ? "bg-muted/40" : "border-primary/25 bg-primary/[0.06]",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">
            {heading}
          </p>
          <p
            className={cn(
              "text-sm",
              muted ? "text-muted-foreground" : "font-medium text-foreground",
            )}
            dir="auto"
          >
            {text}
          </p>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}
