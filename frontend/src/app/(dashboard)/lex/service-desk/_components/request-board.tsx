"use client";

/**
 * #6 Legal Service Desk pipeline board — a read-only kanban over the request FSM.
 *
 * Columns are the request lifecycle statuses in pipeline order; cards summarise
 * each request and link to its detail page. The board is intentionally read-only:
 * request transitions (submit / approve / route / deliver) carry workflow +
 * confirmation semantics that a drag gesture must not silently trigger, so they
 * stay on the detail page. The two pending-approval sub-states collapse onto a
 * single "In approval" lane, and `returned` / `cancelled` are exception lanes at
 * the end so the forward flow reads inline-start → inline-end (RTL flips it).
 *
 * Drag mechanics are delegated to the shared {@link BoardView} primitive; chips
 * are the unified {@link LexStatusChip}/{@link LexPriorityChip}; dates route
 * through {@link useLexFormat} so Arabic mode renders Hijri + Arabic-Indic.
 */

import { useMemo } from "react";
import Link from "next/link";
import { Building2, Clock3, Hash, User2 } from "lucide-react";
import { BoardView, type BoardColumn } from "@/components/shared/board-view";
import { LexPriorityChip, LexStatusChip } from "@/components/lex/status-chip";
import { useLocaleOrDefault } from "@/components/providers/locale-provider";
import { resolveLocalized } from "@/lib/i18n/localized";
import { useLexFormat } from "@/lib/lex/ksa";
import { cn } from "@/lib/utils";
import type { LegalRequest, RequestStatus } from "@/lib/lex/requests";
import type { ServiceDeskLabels } from "./labels";
import { useListExtraLabels } from "./list-extra-labels";
import { useServiceTypeLabel } from "./lex-enums-i18n";

/**
 * Pipeline order of the request lifecycle. The pending-approval pair collapses
 * onto a single `pending_provider_approval` lane (any pending status routes
 * there); `returned` and `cancelled` are exception/terminal lanes at the end.
 */
const BOARD_COLUMN_ORDER: RequestStatus[] = [
  "draft",
  "submitted",
  "pending_provider_approval",
  "approved",
  "routed",
  "in_execution",
  "delivered",
  "closed",
  "returned",
  "cancelled",
];

/** Thin accent bar per column, tinted by lifecycle phase. */
const COLUMN_ACCENT: Record<RequestStatus, string> = {
  draft: "bg-muted-foreground/40",
  submitted: "bg-sky-400/70",
  pending_requester_approval: "bg-warning-300/70",
  pending_provider_approval: "bg-warning-300/70",
  approved: "bg-primary/50",
  routed: "bg-sky-400/70",
  in_execution: "bg-primary/60",
  delivered: "bg-violet-400/70",
  closed: "bg-success-300/70",
  returned: "bg-warning-300/70",
  cancelled: "bg-destructive/50",
};

/** Collapse the FSM status to its board column id. */
function statusToColumn(status: RequestStatus): RequestStatus {
  if (status === "pending_requester_approval")
    return "pending_provider_approval";
  return status;
}

export interface RequestBoardProps {
  requests: LegalRequest[];
  labels: ServiceDeskLabels;
  dir: "ltr" | "rtl";
}

export function RequestBoard({ requests, labels, dir }: RequestBoardProps) {
  const extra = useListExtraLabels();

  const columns: BoardColumn[] = useMemo(
    () =>
      BOARD_COLUMN_ORDER.map((status) => ({
        id: status,
        label: labels.statusOptions[status] ?? status,
        colorClass: COLUMN_ACCENT[status],
      })),
    [labels.statusOptions],
  );

  return (
    <BoardView<LegalRequest>
      columns={columns}
      items={requests}
      getItemId={(request) => request.id}
      getItemColumnId={(request) => statusToColumn(request.status)}
      dir={dir}
      emptyColumnLabel={extra.view.boardEmptyColumn}
      renderCard={(request) => (
        <RequestBoardCard request={request} labels={labels} />
      )}
    />
  );
}

function RequestBoardCard({
  request,
  labels,
}: {
  request: LegalRequest;
  labels: ServiceDeskLabels;
}) {
  const { locale } = useLocaleOrDefault();
  const f = useLexFormat();
  const extra = useListExtraLabels();
  const serviceTypeLabel = useServiceTypeLabel();
  const title = resolveLocalized(request.title, locale) || labels.list.untitled;
  const serviceType = request.request_type ? serviceTypeLabel(request.request_type) : undefined;

  return (
    <div className="space-y-3 p-3.5">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/lex/service-desk/${request.id}`}
          className="min-w-0 text-sm font-semibold leading-snug text-foreground underline-offset-4 hover:text-primary hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          <span className="line-clamp-2">{title}</span>
        </Link>
        <LexPriorityChip
          value={request.priority}
          labels={labels.priorityOptions}
          size="sm"
          className="shrink-0"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 font-mono text-[0.6875rem] text-muted-foreground">
          <Hash className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            {request.request_number || extra.view.noNumber}
          </span>
        </span>
        <LexStatusChip
          value={request.status}
          domain="request"
          labels={labels.statusOptions}
          size="sm"
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        {serviceType ? (
          <span className="inline-flex min-w-0 items-center gap-1">
            <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate capitalize">{serviceType}</span>
          </span>
        ) : null}
        {request.requester_name ? (
          <span className="inline-flex min-w-0 items-center gap-1">
            <User2 className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="truncate">{request.requester_name}</span>
          </span>
        ) : null}
      </div>

      <div
        className={cn(
          "flex items-center gap-1.5 border-t border-border/60 pt-2.5 text-xs text-muted-foreground",
        )}
      >
        <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>{f.formatRelative(request.updated_at)}</span>
      </div>
    </div>
  );
}
