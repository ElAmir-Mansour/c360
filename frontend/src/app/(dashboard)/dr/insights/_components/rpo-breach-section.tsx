'use client';

import { ShieldCheck } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/common/empty-state';
import { formatRecoveryDuration } from '@/components/product';
import type { RpoBreachStats } from '../_lib/insights-aggregation';
import { useInsightsLabels } from './insights-labels';

/**
 * Current RPO-breach list. This is a point-in-time replication-posture readout
 * (the backend exposes the current breach set, not a historical series), so the
 * section is labelled accordingly and never presented as a rate over time.
 *
 * Each row uses real `DRStreamSummary` fields (`stream_id`, `site_name`,
 * `rpo_seconds`, `rpo_objective_seconds`). Token-driven, RTL-safe via the
 * table's logical layout, and AA — the breach is conveyed by the value pairing
 * plus a labelled badge, not color alone.
 */
export function RpoBreachSection({ stats }: { stats: RpoBreachStats }) {
  const labels = useInsightsLabels();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{labels.rpoSectionTitle}</CardTitle>
        <CardDescription>{labels.rpoSectionDescription}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{labels.rpoPointInTimeNote}</p>

        {stats.breaches.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title={labels.rpoNoneTitle}
            description={labels.rpoNoneDescription}
            size="compact"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{labels.rpoColStream}</TableHead>
                <TableHead>{labels.rpoColSite}</TableHead>
                <TableHead className="text-end">{labels.rpoColRpo}</TableHead>
                <TableHead className="text-end">{labels.rpoColObjective}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.breaches.map((stream) => (
                <TableRow key={stream.stream_id}>
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-2">
                      <Badge variant="destructive">{labels.rpoBreachLabel}</Badge>
                      <span className="truncate">{stream.stream_id}</span>
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {stream.site_name ?? stream.site_id}
                  </TableCell>
                  <TableCell className="text-end tabular-nums">
                    {formatRecoveryDuration(stream.rpo_seconds, labels.naLabel)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums text-muted-foreground">
                    {formatRecoveryDuration(stream.rpo_objective_seconds, labels.naLabel)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
