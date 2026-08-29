/**
 * Small page-chrome helpers for the Watheeq compliance surface that are NOT part
 * of the pre-existing `_lib/compliance-labels.ts` contract:
 *
 *   - `useComplianceChromeLabels()` — a bilingual eyebrow (rendered above the
 *     PageHeader title, matching the sibling Lex list pages that show an
 *     uppercase suite/domain eyebrow) plus the copy for the partial-load notice.
 *   - `<CompliancePartialError>` — an inline, retry-able notice shown when ONE of
 *     the compliance queries (dashboard or alert rules) fails while the rest of
 *     the page still renders. The full-page `<ErrorState>` only fires when BOTH
 *     fail, so this closes the "silent partial failure" gap without a rebuild.
 *
 * Both follow the canonical lex bilingual contract (`../../_lib/lex-i18n.ts`):
 * the `en` side is authoritative, the `ar` side is professional MSA.
 */

'use client';

import { useMemo } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

export interface ComplianceChromeLabels {
  /** Uppercase eyebrow above the "Compliance" page title. */
  eyebrow: string;
  partialError: {
    /** Shown when the dashboard/rules load partially failed. */
    message: string;
    retry: string;
  };
}

const complianceChromeLabels: LexBilingual<ComplianceChromeLabels> = {
  en: {
    eyebrow: 'Regulatory Compliance',
    partialError: {
      message: 'Some compliance data could not be loaded. Figures may be incomplete.',
      retry: 'Retry',
    },
  },
  ar: {
    eyebrow: 'الامتثال التنظيمي',
    partialError: {
      message: 'تعذّر تحميل بعض بيانات الامتثال. قد تكون الأرقام غير مكتملة.',
      retry: 'إعادة المحاولة',
    },
  },
};

export function useComplianceChromeLabels(): ComplianceChromeLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(complianceChromeLabels, locale), [locale]);
}

export interface CompliancePartialErrorProps {
  onRetry: () => void;
  labels: ComplianceChromeLabels['partialError'];
  className?: string;
}

/**
 * Inline warning banner for a partial data-load failure. Logical spacing +
 * `dir="auto"` keep it correct under both LTR and RTL.
 */
export function CompliancePartialError({ onRetry, labels, className }: CompliancePartialErrorProps) {
  return (
    <div
      role="status"
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3',
        'border-warning-300/60 bg-warning-50 text-body-sm text-warning-800',
        'dark:border-warning-700/50 dark:bg-warning-900/15 dark:text-warning-200',
        className,
      )}
    >
      <span className="inline-flex min-w-0 items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        <span dir="auto" className="min-w-0">
          {labels.message}
        </span>
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="shrink-0"
      >
        <RefreshCw className="me-1.5 h-3.5 w-3.5" aria-hidden />
        {labels.retry}
      </Button>
    </div>
  );
}
