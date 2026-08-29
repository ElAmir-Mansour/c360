"use client";

import { RelativeTime } from "@/components/shared/relative-time";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { IntegrationDeliveryRecord } from "@/types/integration";
import {
  deliveryStatusLabel,
  eventTypeLabel,
  technicalDiagnosticMessage,
  useIntegrationsT,
  visibleDiagnosticMessage,
} from "../_lib/integrations-i18n";

export function DeliveryLogTable({ items }: { items: IntegrationDeliveryRecord[] }) {
  const t = useIntegrationsT();
  if (items.length === 0) {
    return <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">{t.noDeliveryRecords}</div>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t.event}</TableHead>
          <TableHead>{t.statusHeader}</TableHead>
          <TableHead>{t.attempts}</TableHead>
          <TableHead>{t.response}</TableHead>
          <TableHead>{t.latency}</TableHead>
          <TableHead>{t.nextRetry}</TableHead>
          <TableHead>{t.createdHeader}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell>
              <div className="font-medium">{eventTypeLabel(t, item.event_type)}</div>
              <div className="text-xs text-muted-foreground">{item.event_id}</div>
              {item.last_error ? (
                <div className="mt-1 text-xs text-destructive">
                  {visibleDiagnosticMessage(t, item.last_error, t.deliveryDiagnosticMessage)}
                  {technicalDiagnosticMessage(t, item.last_error) ? (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-muted-foreground">{t.technicalDetails}</summary>
                      <p dir="ltr" className="mt-1 break-words font-mono text-[11px]">
                        {technicalDiagnosticMessage(t, item.last_error)}
                      </p>
                    </details>
                  ) : null}
                </div>
              ) : null}
            </TableCell>
            <TableCell>
              <Badge variant={badgeVariant(item.status)}>{deliveryStatusLabel(t, item.status)}</Badge>
            </TableCell>
            <TableCell>
              {item.attempts}/{item.max_attempts}
            </TableCell>
            <TableCell>{item.response_code ?? "—"}</TableCell>
            <TableCell>{item.latency_ms ? `${item.latency_ms} ms` : "—"}</TableCell>
            <TableCell>{item.next_retry_at ? <RelativeTime date={item.next_retry_at} /> : "—"}</TableCell>
            <TableCell>
              <RelativeTime date={item.created_at} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function badgeVariant(status: IntegrationDeliveryRecord["status"]): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "delivered":
      return "default";
    case "retrying":
      return "secondary";
    case "failed":
      return "destructive";
    default:
      return "outline";
  }
}
