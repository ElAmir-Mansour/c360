"use client";

import Link from "next/link";
import { CalendarClock } from "lucide-react";
import {
  SeverityIndicator,
  type Severity,
} from "@/components/shared/severity-indicator";
import { useLexFormat } from "@/lib/lex/ksa";
import type { LexContract, LexRiskLevel } from "@/types/suites";
import { contractWorkspaceHref } from "../_lib/contract-workspace-route";

const RISK_TO_SEVERITY: Record<LexRiskLevel, Severity> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
  none: "info",
};

export interface ContractBoardCardLabels {
  noParties: string;
  noValue: string;
  noExpiry: string;
  typeLabel: string;
}

export interface ContractBoardCardProps {
  contract: LexContract;
  labels: ContractBoardCardLabels;
}

/** Compact draggable card body for the contracts board view. */
export function ContractBoardCard({
  contract,
  labels,
}: ContractBoardCardProps) {
  const f = useLexFormat();
  const parties =
    [contract.party_a_name, contract.party_b_name].filter(Boolean).join("، ") ||
    labels.noParties;

  return (
    <div className="space-y-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={contractWorkspaceHref(contract)}
          className="line-clamp-2 text-sm font-medium hover:underline"
          // Prevent the drag pointer handler from swallowing the navigation.
          onPointerDown={(event) => event.stopPropagation()}
        >
          {contract.title}
        </Link>
        <SeverityIndicator
          severity={RISK_TO_SEVERITY[contract.risk_level] ?? "info"}
          size="sm"
          showLabel={false}
        />
      </div>
      <p className="truncate text-xs text-muted-foreground">
        {labels.typeLabel}
      </p>
      <p className="line-clamp-1 text-xs text-muted-foreground">{parties}</p>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium tabular-nums text-foreground">
          {contract.total_value != null
            ? f.formatCurrencyCompact(contract.total_value, {
                currency: contract.currency ?? "SAR",
              })
            : labels.noValue}
        </span>
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <CalendarClock className="h-3 w-3 shrink-0" aria-hidden />
          {contract.expiry_date ? (
            <span>{f.formatRelative(contract.expiry_date)}</span>
          ) : (
            <span>{labels.noExpiry}</span>
          )}
        </span>
      </div>
    </div>
  );
}
