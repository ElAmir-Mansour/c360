"use client";

import Link from "next/link";
import { ExternalLink, RefreshCw } from "lucide-react";
import { RelativeTime } from "@/components/shared/relative-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ExternalTicketLinkRecord } from "@/types/integration";
import {
  entityTypeLabel,
  externalStatusLabel,
  externalSystemLabel,
  syncDirectionLabel,
  technicalDiagnosticMessage,
  useIntegrationsT,
  visibleDiagnosticMessage,
} from "../_lib/integrations-i18n";

export function TicketLinksTable({
  items,
  syncingId,
  onSync,
}: {
  items: ExternalTicketLinkRecord[];
  syncingId?: string | null;
  onSync?: (id: string) => void;
}) {
  const t = useIntegrationsT();
  if (items.length === 0) {
    return <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">{t.noTicketLinks}</div>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t.externalTicket}</TableHead>
          <TableHead>{t.entity}</TableHead>
          <TableHead>{t.statusHeader}</TableHead>
          <TableHead>{t.direction}</TableHead>
          <TableHead>{t.lastSynced}</TableHead>
          <TableHead className="text-end">{t.actions}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell>
              <div className="font-medium">{item.external_key}</div>
              <div className="text-xs text-muted-foreground">{externalSystemLabel(t, item.external_system)}</div>
            </TableCell>
            <TableCell>
              <div className="font-medium">{entityTypeLabel(t, item.entity_type)}</div>
              <div className="text-xs text-muted-foreground">{item.entity_id}</div>
            </TableCell>
            <TableCell>
              <Badge variant="outline">{externalStatusLabel(t, item.external_status)}</Badge>
              {item.sync_error ? (
                <div className="mt-1 text-xs text-destructive">
                  {visibleDiagnosticMessage(t, item.sync_error, t.ticketSyncDiagnosticMessage)}
                  {technicalDiagnosticMessage(t, item.sync_error) ? (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-muted-foreground">{t.technicalDetails}</summary>
                      <p dir="ltr" className="mt-1 break-words font-mono text-[11px]">
                        {technicalDiagnosticMessage(t, item.sync_error)}
                      </p>
                    </details>
                  ) : null}
                </div>
              ) : null}
            </TableCell>
            <TableCell>{syncDirectionLabel(t, item.sync_direction)}</TableCell>
            <TableCell>{item.last_synced_at ? <RelativeTime date={item.last_synced_at} /> : t.never}</TableCell>
            <TableCell className="text-end">
              <div className="flex justify-end gap-2">
                <Button asChild variant="outline" size="sm">
                  <Link href={`/admin/integrations/ticket-links/${item.id}`}>{t.details}</Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <a href={item.external_url} target="_blank" rel="noreferrer">
                    <ExternalLink className="me-2 h-4 w-4" />
                    {t.open}
                  </a>
                </Button>
                {onSync ? (
                  <Button variant="outline" size="sm" onClick={() => onSync(item.id)} disabled={syncingId === item.id}>
                    <RefreshCw className={`me-2 h-4 w-4 ${syncingId === item.id ? "animate-spin" : ""}`} />
                    {t.sync}
                  </Button>
                ) : null}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
