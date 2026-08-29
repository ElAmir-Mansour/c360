'use client';

import { useId } from 'react';
import { FileKey2, Loader2 } from 'lucide-react';
import { AuditTrailTable } from '@/components/product';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  DRAttestationLedgerEntry,
  DRAttestationLedgerVerifyResult,
} from '@/types/clario-dr';
import { useDRLabels } from '../../../_lib/dr-i18n';
import { humanizeEntryType, shortHash } from './ledger-format';
import type { LedgerExplorerCopy } from './ledger-labels';

export interface LedgerTableProps {
  copy: LedgerExplorerCopy;
  /** Filtered, display-ready entries (ascending by seq for chain order). */
  entries: DRAttestationLedgerEntry[];
  verification: DRAttestationLedgerVerifyResult | null | undefined;
  selectedSeq: number | null;
  /** True while a proof fetch for `selectedSeq` is in flight. */
  proofLoading: boolean;
  onVerifyProof: (seq: number) => void;
}

/**
 * Ledger entries surface for the explorer.
 *
 * The hash-chain spine (seq, type, subject, payload hash, chain links, anchor,
 * timestamp, per-row verdict) is rendered by the design-system `AuditTrailTable`,
 * which already understands `DRAttestationLedgerEntry` + the verify result. The
 * per-entry inclusion-proof action is not part of that read-only DS component, so
 * a compact, accessible companion table maps the same entries to a "Verify proof"
 * control keyed by `seq`.
 */
export function LedgerTable({
  copy,
  entries,
  verification,
  selectedSeq,
  proofLoading,
  onVerifyProof,
}: LedgerTableProps) {
  const { auditTrailLabels } = useDRLabels();
  const headingId = useId();
  const proofHeadingId = useId();

  // AuditTrailTable expects ascending chain order; the proof companion shows the
  // newest entries first for fast operator access.
  const ascending = [...entries].sort((a, b) => a.seq - b.seq);
  const descending = [...entries].sort((a, b) => b.seq - a.seq);

  return (
    <div className="space-y-4">
      <Card aria-labelledby={headingId}>
        <CardHeader>
          <CardTitle id={headingId} className="text-base">
            {copy.tableHeading}
          </CardTitle>
          <CardDescription>{copy.tableDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <AuditTrailTable
            entries={ascending}
            verification={verification ?? undefined}
            labels={auditTrailLabels}
          />
        </CardContent>
      </Card>

      <Card aria-labelledby={proofHeadingId}>
        <CardHeader>
          <CardTitle id={proofHeadingId} className="flex items-center gap-2 text-base">
            <FileKey2 className="h-4 w-4 shrink-0" aria-hidden />
            {copy.tableProofColumn}
          </CardTitle>
          <CardDescription>{copy.proofDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          {descending.length === 0 ? (
            <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
              {copy.tableEmpty}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{auditTrailLabels.columnSeq}</TableHead>
                    <TableHead>{auditTrailLabels.columnType}</TableHead>
                    <TableHead>{auditTrailLabels.columnSubject}</TableHead>
                    <TableHead>{auditTrailLabels.columnAnchor}</TableHead>
                    <TableHead className="text-end">{copy.tableProofColumn}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {descending.map((entry) => {
                    const selected = entry.seq === selectedSeq;
                    const rowLoading = proofLoading && selected;
                    return (
                      <TableRow key={entry.id} data-state={selected ? 'selected' : undefined}>
                        <TableCell className="font-mono text-xs">{entry.seq}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="max-w-[12rem] normal-case tracking-normal">
                            <span className="truncate">{humanizeEntryType(entry.entry_type)}</span>
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[16rem] truncate font-mono text-xs">
                          {entry.subject_id}
                        </TableCell>
                        <TableCell>
                          {entry.anchored_root ? (
                            <span className="font-mono text-xs text-muted-foreground">
                              {shortHash(entry.anchored_root)}
                            </span>
                          ) : (
                            <Badge variant="warning" className="normal-case tracking-normal">
                              {auditTrailLabels.notAnchored}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-end">
                          <Button
                            type="button"
                            size="sm"
                            variant={selected ? 'secondary' : 'outline'}
                            disabled={rowLoading}
                            onClick={() => onVerifyProof(entry.seq)}
                          >
                            {rowLoading ? (
                              <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                            ) : (
                              <FileKey2 className="me-1.5 h-3.5 w-3.5" aria-hidden />
                            )}
                            {rowLoading
                              ? copy.tableProofLoading
                              : selected
                                ? copy.tableProofRefresh
                                : copy.tableProofAction}
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
