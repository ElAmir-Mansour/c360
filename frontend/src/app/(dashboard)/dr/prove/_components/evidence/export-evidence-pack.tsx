'use client';

import { useMemo, useState } from 'react';
import { FileDown, PackageCheck } from 'lucide-react';
import { isTerminalFailure, isTerminalSuccess } from '@/components/product';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { DRFailoverRun } from '@/lib/clario-dr';
import type {
  DRAttestationLedgerEntry,
  DRAttestationLedgerVerifyResult,
} from '@/types/clario-dr';
import { EvidencePackDialog } from './evidence-pack-dialog';
import {
  useEvidenceExportLabels,
  type EvidenceExportLabels,
} from './labels';

/**
 * ExportEvidencePack
 * ==================
 * The "one-click evidence pack" entry point on the Prove overview. The operator
 * picks a terminal (completed / attested / failed / cancelled / rolled-back)
 * recovery run, then "Export evidence pack" opens {@link EvidencePackDialog},
 * which fetches that run's steps + attestation, assembles the pack from the real
 * fetched data, and exports it as JSON or a print-ready report.
 *
 * Selecting and generating the pack is read-only (`dr:read` at the route), so no
 * `dr:write` gate is applied here. Token-driven, AA, RTL-safe (logical spacing).
 */

const TERMINAL_RUN_STATUSES = new Set([
  'COMPLETED',
  'ATTESTED',
  'FAILED',
  'CANCELLED',
  'ROLLED_BACK',
]);

export interface ExportEvidencePackProps {
  runs: DRFailoverRun[];
  ledgerEntries: DRAttestationLedgerEntry[];
  verification: DRAttestationLedgerVerifyResult | null;
  groupName?: string | null;
  /** Operator attribution stamped on the pack envelope (e.g. the signed-in email). */
  generatedBy?: string | null;
  labels?: EvidenceExportLabels;
}

export function ExportEvidencePack({
  runs,
  ledgerEntries,
  verification,
  groupName,
  generatedBy,
  labels: labelsProp,
}: ExportEvidencePackProps) {
  const resolvedLabels = useEvidenceExportLabels();
  const labels = labelsProp ?? resolvedLabels;
  const terminalRuns = useMemo(
    () =>
      runs.filter(
        (run) =>
          TERMINAL_RUN_STATUSES.has(run.status.toUpperCase()) &&
          (isTerminalSuccess(run.status) || isTerminalFailure(run.status)),
      ),
    [runs],
  );

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const effectiveRunId = selectedRunId ?? terminalRuns[0]?.id ?? null;
  const selectedRun = terminalRuns.find((run) => run.id === effectiveRunId) ?? null;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-1.5">
        <CardTitle className="flex items-center gap-2 text-base">
          <PackageCheck className="h-4 w-4 text-primary" aria-hidden />
          {labels.sectionTitle}
        </CardTitle>
        <CardDescription>{labels.sectionDescription}</CardDescription>
      </CardHeader>
      <CardContent>
        {terminalRuns.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-sm text-muted-foreground">
            <FileDown className="h-4 w-4 shrink-0" aria-hidden />
            <span className="min-w-0">{labels.noTerminalRunsHint}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <label
                htmlFor="evidence-run-select"
                className="text-caption font-medium text-muted-foreground"
              >
                {labels.runSelectLabel}
              </label>
              <Select
                value={effectiveRunId ?? undefined}
                onValueChange={(value) => setSelectedRunId(value)}
              >
                <SelectTrigger id="evidence-run-select" aria-label={labels.runSelectLabel}>
                  <SelectValue placeholder={labels.runSelectPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {terminalRuns.map((run) => (
                    <SelectItem key={run.id} value={run.id}>
                      {run.id} · {run.mode} · {run.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              onClick={() => setDialogOpen(true)}
              disabled={!selectedRun}
              className="shrink-0"
            >
              <FileDown className="me-2 h-4 w-4" aria-hidden />
              {labels.exportAction}
            </Button>
          </div>
        )}
      </CardContent>

      {selectedRun ? (
        <EvidencePackDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          run={selectedRun}
          ledgerEntries={ledgerEntries}
          verification={verification}
          groupName={groupName}
          generatedBy={generatedBy}
          labels={labels}
        />
      ) : null}
    </Card>
  );
}
