"use client";

/**
 * Locale-resolved StatusConfig builders for the Legal Service Desk. Each builder
 * takes the resolved {@link ServiceDeskLabels} so the StatusBadge renders the
 * bilingual label keyed by the raw backend token (CAP-172). Colours/icons are
 * decorative semantics only.
 */

import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  FileEdit,
  PauseCircle,
  RotateCcw,
  Send,
  ShieldCheck,
  Truck,
  XCircle,
} from "lucide-react";
import type { StatusConfig } from "@/lib/status-configs";
import type { ServiceDeskLabels } from "./labels";

export function buildRequestStatusConfig(
  labels: ServiceDeskLabels,
): StatusConfig {
  const s = labels.statusOptions;
  return {
    draft: { label: s.draft, color: "gray", icon: FileEdit },
    submitted: { label: s.submitted, color: "blue", icon: Send },
    pending_requester_approval: {
      label: s.pending_requester_approval,
      color: "yellow",
      icon: Clock,
    },
    pending_provider_approval: {
      label: s.pending_provider_approval,
      color: "yellow",
      icon: Clock,
    },
    approved: { label: s.approved, color: "green", icon: ShieldCheck },
    routed: { label: s.routed, color: "purple", icon: Send },
    in_execution: { label: s.in_execution, color: "blue", icon: Clock },
    delivered: { label: s.delivered, color: "teal", icon: Truck },
    closed: { label: s.closed, color: "green", icon: CheckCircle2 },
    returned: { label: s.returned, color: "orange", icon: RotateCcw },
    cancelled: { label: s.cancelled, color: "gray", icon: Ban },
  };
}

export function buildPriorityConfig(labels: ServiceDeskLabels): StatusConfig {
  return {
    normal: {
      label: labels.priorityOptions.normal,
      color: "gray",
      icon: CheckCircle2,
    },
    urgent: {
      label: labels.priorityOptions.urgent,
      color: "red",
      icon: AlertTriangle,
    },
  };
}

export function buildExecutionStatusConfig(
  labels: ServiceDeskLabels,
): StatusConfig {
  const s = labels.execution.statusOptions;
  return {
    awaiting_completeness: {
      label: s.awaiting_completeness,
      color: "yellow",
      icon: PauseCircle,
    },
    in_progress: { label: s.in_progress, color: "blue", icon: Clock },
    delivered: { label: s.delivered, color: "teal", icon: Truck },
    returned: { label: s.returned, color: "orange", icon: RotateCcw },
    auto_closed: { label: s.auto_closed, color: "gray", icon: Ban },
    closed: { label: s.closed, color: "green", icon: CheckCircle2 },
  };
}

export function buildDeliveryStatusConfig(
  labels: ServiceDeskLabels,
): StatusConfig {
  const s = labels.execution.deliveryStatus;
  return {
    requested: { label: s.requested, color: "yellow", icon: Clock },
    confirmed: { label: s.confirmed, color: "green", icon: CheckCircle2 },
    achieved: { label: s.achieved, color: "blue", icon: CheckCircle2 },
    denied: { label: s.denied, color: "red", icon: XCircle },
    expired: { label: s.expired, color: "gray", icon: Ban },
  };
}

export function buildSlaOutcomeConfig(labels: ServiceDeskLabels): StatusConfig {
  const s = labels.sla.outcomeOptions;
  return {
    pending: { label: s.pending, color: "yellow", icon: Clock },
    on_time: { label: s.on_time, color: "green", icon: CheckCircle2 },
    breached: { label: s.breached, color: "red", icon: AlertTriangle },
  };
}
