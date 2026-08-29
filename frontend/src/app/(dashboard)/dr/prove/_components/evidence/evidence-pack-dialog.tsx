'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { showSuccess, showError } from '@/lib/toast';
import {
  fetchDRFailoverAttestation,
  fetchDRFailoverSteps,
  type DRAttestation,
  type DRFailoverRun,
  type DRFailoverStep,
} from '@/lib/clario-dr';
import type {
  DRAttestationLedgerEntry,
  DRAttestationLedgerVerifyResult,
} from '@/types/clario-dr';
import {
  assembleEvidencePack,
  evidencePackFilename,
  serializeEvidencePack,
} from '../../../_lib/evidence-export';
import { EvidencePackPrintView } from './evidence-pack-print-view';
import { buildEvidencePackPrintHtml } from './evidence-pack-html';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  useEvidenceExportLabels,
  type EvidenceExportLabels,
} from './labels';

/**
 * EvidencePackDialog
 * ==================
 * Fetches the selected run's REAL execution steps (`fetchDRFailoverSteps`) and
 * sealed attestation (`fetchDRFailoverAttestation`), assembles them — together
 * with the run, the run-scoped attestation-ledger entries, the chain-verify
 * verdict, the RTO-vs-RTA evaluation and the four-gate outcome — into a single
 * evidence pack via the pure `assembleEvidencePack`, and offers two client-side
 * exports of that exact pack:
 *
 *  - a downloadable JSON file (Blob + anchor download), and
 *  - a print-optimised, branded report opened in a new window for browser
 *    print-to-PDF.
 *
 * No server export endpoint exists or is invoked. Generating/viewing the pack is
 * a read-only operation (gated by `dr:read` at the route level), so this dialog
 * needs no `dr:write`. The same assembled pack drives both the on-screen preview
 * (`EvidencePackPrintView`) and the printed document (`buildEvidencePackPrintHtml`).
 */

export interface EvidencePackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  run: DRFailoverRun;
  ledgerEntries: DRAttestationLedgerEntry[];
  verification: DRAttestationLedgerVerifyResult | null;
  groupName?: string | null;
  generatedBy?: string | null;
  labels?: EvidenceExportLabels;
}

export function EvidencePackDialog({
  open,
  onOpenChange,
  run,
  ledgerEntries,
  verification,
  groupName,
  generatedBy,
  labels: labelsProp,
}: EvidencePackDialogProps) {
  const resolvedLabels = useEvidenceExportLabels();
  const labels = labelsProp ?? resolvedLabels;
  const { locale } = useLocaleOrDefault();
  // Reuse the PIR panel's cache keys so steps/attestation are shared, not refetched.
  const stepsQuery = useQuery<DRFailoverStep[]>({
    queryKey: ['clario-dr', 'failover-run-steps', run.id],
    queryFn: () => fetchDRFailoverSteps(run.id),
    enabled: open,
  });

  const attestationQuery = useQuery<DRAttestation>({
    queryKey: ['clario-dr', 'failover-run-attestation', run.id],
    queryFn: () => fetchDRFailoverAttestation(run.id),
    enabled: open,
    // Drills / unattested runs legitimately have no sealed attestation — a miss
    // is "no attestation", not a retry-able failure.
    retry: false,
  });

  const steps = useMemo(() => stepsQuery.data ?? [], [stepsQuery.data]);

  // Assemble the pack once steps are available; attestation is optional.
  const pack = useMemo(() => {
    if (stepsQuery.isLoading) return null;
    return assembleEvidencePack({
      run,
      steps,
      attestation: attestationQuery.data ?? null,
      ledgerEntries,
      verification,
      groupName,
      generatedBy,
      generatedAt: new Date(),
    });
  }, [
    run,
    steps,
    stepsQuery.isLoading,
    attestationQuery.data,
    ledgerEntries,
    verification,
    groupName,
    generatedBy,
  ]);

  const handleDownloadJson = () => {
    if (!pack) return;
    try {
      const blob = new Blob([serializeEvidencePack(pack)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = evidencePackFilename(pack);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      showSuccess(labels.downloadSuccess(pack.meta.run_id));
    } catch {
      showError(labels.downloadError);
    }
  };

  const handlePrint = () => {
    if (!pack) return;
    const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=900,height=1000');
    if (!printWindow) {
      showError(labels.printPopupBlocked);
      return;
    }
    printWindow.document.open();
    printWindow.document.write(buildEvidencePackPrintHtml(pack, labels, locale));
    printWindow.document.close();
    printWindow.focus();
    // Defer printing until the standalone document has laid out.
    printWindow.addEventListener('load', () => {
      printWindow.print();
    });
  };

  const canExport = Boolean(pack);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl gap-0 overflow-hidden p-0">
        <DialogHeader className="space-y-1 border-b p-6">
          <DialogTitle>{labels.dialogTitle}</DialogTitle>
          <DialogDescription>{labels.dialogDescription}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh]">
          {stepsQuery.isLoading && !pack ? (
            <div className="p-6">
              <LoadingSkeleton variant="card" count={2} />
              <p className="mt-3 text-sm text-muted-foreground">{labels.assembling}</p>
            </div>
          ) : stepsQuery.error && !pack ? (
            <div className="p-6">
              <ErrorState message={labels.assembleError} onRetry={() => void stepsQuery.refetch()} />
            </div>
          ) : pack ? (
            <EvidencePackPrintView pack={pack} labels={labels} id="dr-evidence-print-target" />
          ) : null}
        </ScrollArea>

        <DialogFooter className="flex-row justify-end gap-2 border-t p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {labels.close}
          </Button>
          <Button variant="outline" onClick={handlePrint} disabled={!canExport}>
            <Printer className="me-2 h-4 w-4" aria-hidden />
            {labels.printView}
          </Button>
          <Button onClick={handleDownloadJson} disabled={!canExport}>
            <Download className="me-2 h-4 w-4" aria-hidden />
            {labels.downloadJson}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
