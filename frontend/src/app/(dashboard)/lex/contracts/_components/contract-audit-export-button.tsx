/**
 * ContractAuditExportButton — Feature #7: header-level "Audit export" action on
 * the contracts list (`/lex/contracts`).
 *
 * Downloads the tenant's portfolio-wide, append-only contract audit feed as a
 * UTF-8-with-BOM CSV (`GET /contracts/audit?format=csv`) scoped to the CURRENT
 * list filters + search, so the export matches exactly what the user is
 * viewing. The Blob is fetched through the authenticated axios pipeline and
 * saved via the shared `downloadBlob` helper (in-memory access token — a plain
 * anchor cannot authenticate).
 *
 * Read-only surface: the endpoint sits on the same `lex:contract:view` tier as
 * the list itself, so no `canWrite` gating applies (matching the existing CSV
 * report export on this page).
 */

'use client';

import { useMemo, useState } from 'react';
import { FileClock, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { downloadBlob } from '@/lib/format';
import { showApiError, showSuccess } from '@/lib/toast';
import { useLocale } from '@/components/providers/locale-provider';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';
import {
  contractAuditCsvFilename,
  contractAuditParamsFromFilters,
  exportContractAuditCsv,
} from '../_lib/contract-audit-api';

export interface ContractAuditExportButtonProps {
  /** Live filter set from `useDataTable` — mirrored into the export query. */
  activeFilters: Record<string, string | string[]>;
  /** Current search-box value (merged as the `search` param). */
  search?: string;
  className?: string;
}

/* Button-local bilingual labels (exported for tests, following the
 * `contracts-labels.ts` pattern). */
export interface ContractAuditExportLabels {
  label: string;
  exporting: string;
  exported: string;
}

export const contractAuditExportLabels: LexBilingual<ContractAuditExportLabels> = {
  en: {
    label: 'Audit export',
    exporting: 'Exporting…',
    exported: 'Contract audit trail exported.',
  },
  ar: {
    label: 'تصدير سجل التدقيق',
    exporting: 'جارٍ التصدير…',
    exported: 'تم تصدير سجل تدقيق العقود.',
  },
};

export function ContractAuditExportButton({
  activeFilters,
  search,
  className,
}: ContractAuditExportButtonProps) {
  const { locale } = useLocale();
  const labels = useMemo(
    () => resolveLexBilingual(contractAuditExportLabels, locale),
    [locale],
  );
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const { blob, filename } = await exportContractAuditCsv(
        contractAuditParamsFromFilters(activeFilters, search),
      );
      downloadBlob(blob, filename ?? contractAuditCsvFilename());
      showSuccess(labels.exported);
    } catch (error) {
      showApiError(error);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => void handleExport()}
      disabled={exporting}
      aria-busy={exporting}
      className={className}
    >
      {exporting ? (
        <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <FileClock className="me-1.5 h-4 w-4" aria-hidden />
      )}
      {exporting ? labels.exporting : labels.label}
    </Button>
  );
}
