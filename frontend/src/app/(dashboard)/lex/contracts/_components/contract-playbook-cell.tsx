/**
 * Feature #4 — contracts list playbook-compliance column.
 *
 * Three integrator-facing pieces, all fed by the shared portfolio join in
 * `../_lib/use-playbook-scores.ts` (one react-query fetch keyed by
 * `contract_id`):
 *
 *   1. {@link ContractPlaybookCell} — purely presentational cell rendering the
 *      compliance % as a tone-tinted chip (ok ≥ 90 / warn 70–89 / danger < 70)
 *      with Arabic-Indic percent shaping in ar mode, degrading to a neutral
 *      dashed "off-playbook" pill when the contract has no matched active
 *      playbook, and to a skeleton while the portfolio is loading.
 *
 *   2. {@link PlaybookThresholdChip} — the below-threshold quick-filter chip,
 *      styled after the page's preset chips (`aria-pressed`, rounded-full).
 *
 *   3. {@link usePlaybookDeviationsBulkAction} — a ready-made `BulkAction`
 *      ("Export deviations") that downloads the existing per-contract
 *      clause-deviation CSV export for every selected on-playbook contract.
 *      It is a READ-tier action (GET export endpoint) so it does NOT require
 *      the page's `canWrite` gate.
 *
 * Bilingual labels follow the canonical lex token-record contract
 * (`LexBilingual<T> = { en, ar }` resolved via the active locale); logical
 * spacing (me-/ms-) keeps the layout RTL-safe.
 */

'use client';

import { useMemo } from 'react';
import { FileDown, Gauge } from 'lucide-react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { formatPercent, useLexFormat } from '@/lib/lex/ksa';
import { showError, showInfo, showSuccess, showWarning } from '@/lib/toast';
import { cn } from '@/lib/utils';
import type { BulkAction } from '@/types/table';
import type { LexPlaybookPortfolioRow } from '@/types/suites';
import { resolveLexBilingual, type LexBilingual } from '../../_lib/lex-i18n';
import {
  PLAYBOOK_OK_THRESHOLD,
  exportDeviationsForContracts,
  normalizeComplianceScore,
  playbookComplianceTone,
  type PlaybookComplianceTone,
} from '../_lib/use-playbook-scores';

/* ------------------------------------------------------------------------- *
 * Bilingual labels (English + Modern Standard Arabic).
 * ------------------------------------------------------------------------- */

export interface ContractPlaybookCellLabels {
  /** Column header on the contracts table. */
  columnHeader: string;
  /** Neutral pill text when the contract has no matched active playbook. */
  offPlaybook: string;
  /** Tooltip expanding on the off-playbook state. */
  offPlaybookHint: string;
  /** Tooltip / aria label for a scored chip (e.g. "Playbook compliance 92%"). */
  scoreLabel: (score: string) => string;
  /** Tooltip suffix naming the matched playbook. */
  playbookPrefix: (name: string) => string;
  /** Quick-filter chip label (threshold pre-formatted as a percent). */
  quickFilter: (threshold: string) => string;
  /** Warning shown when the server capped the portfolio scan. */
  truncatedNotice: string;
  bulk: {
    /** Bulk action entry label. */
    exportDeviations: string;
    started: (count: number) => string;
    done: (count: number) => string;
    skipped: (count: number) => string;
    failed: (count: number) => string;
    /** Shown when no selected contract has a matched playbook. */
    nothingToExport: string;
  };
}

export const contractPlaybookCellLabels: LexBilingual<ContractPlaybookCellLabels> = {
  en: {
    columnHeader: 'Playbook',
    offPlaybook: 'Off-playbook',
    offPlaybookHint: 'No active playbook matches this contract type.',
    scoreLabel: (score) => `Playbook compliance ${score}`,
    playbookPrefix: (name) => `Playbook: ${name}`,
    quickFilter: (threshold) => `Below playbook target (< ${threshold})`,
    truncatedNotice:
      'The playbook portfolio scan was capped server-side; some contracts may be missing a score.',
    bulk: {
      exportDeviations: 'Export deviations',
      started: (count) =>
        `Exporting deviation reports for ${count} contract${count === 1 ? '' : 's'}…`,
      done: (count) =>
        `Exported ${count} deviation report${count === 1 ? '' : 's'}.`,
      skipped: (count) =>
        `${count} off-playbook contract${count === 1 ? '' : 's'} skipped.`,
      failed: (count) =>
        `${count} deviation export${count === 1 ? '' : 's'} failed.`,
      nothingToExport: 'None of the selected contracts has a matched playbook.',
    },
  },
  ar: {
    columnHeader: 'الدليل الإرشادي',
    offPlaybook: 'خارج الدليل',
    offPlaybookHint: 'لا يوجد دليل إرشادي نشط مطابق لنوع هذا العقد.',
    scoreLabel: (score) => `الامتثال للدليل الإرشادي ${score}`,
    playbookPrefix: (name) => `الدليل الإرشادي: ${name}`,
    quickFilter: (threshold) => `دون مستهدف الدليل (أقل من ${threshold})`,
    truncatedNotice:
      'تم تحديد نطاق فحص محفظة الدليل الإرشادي من جهة الخادم؛ قد تفتقد بعض العقود درجتها.',
    bulk: {
      exportDeviations: 'تصدير الانحرافات',
      started: (count) => `جارٍ تصدير تقارير الانحراف لـ ${count} عقد…`,
      done: (count) => `تم تصدير ${count} تقرير انحراف.`,
      skipped: (count) => `تم تخطي ${count} عقد خارج الدليل.`,
      failed: (count) => `فشل تصدير ${count} تقرير انحراف.`,
      nothingToExport: 'لا يوجد بين العقود المحددة عقد ذو دليل إرشادي مطابق.',
    },
  },
};

export function useContractPlaybookCellLabels(): ContractPlaybookCellLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(
    () => resolveLexBilingual(contractPlaybookCellLabels, locale),
    [locale],
  );
}

/* ------------------------------------------------------------------------- *
 * Chip chrome per tone — spelled out literally so Tailwind's JIT scanner can
 * statically detect each class (mirrors CHIP_TONE in contract-risk-cell.tsx).
 * ------------------------------------------------------------------------- */

const CHIP_TONE: Record<PlaybookComplianceTone, string> = {
  ok: 'border-success-500/30 bg-success-500/8 text-success-700 dark:text-success-300',
  warn: 'border-warning-500/30 bg-warning-500/7 text-warning-700 dark:text-warning-300',
  danger: 'border-error-500/30 bg-error-500/6 text-error-700 dark:text-error-300',
  none: 'border-border/70 bg-muted/50 text-muted-foreground',
};

/** Dot accent inside the scored chip, matching the ramp above. */
const DOT_TONE: Record<PlaybookComplianceTone, string> = {
  ok: 'bg-success-500',
  warn: 'bg-warning-500',
  danger: 'bg-error-500',
  none: 'bg-muted-foreground/50',
};

/* ------------------------------------------------------------------------- *
 * 1. ContractPlaybookCell — the column cell.
 * ------------------------------------------------------------------------- */

export interface ContractPlaybookCellProps {
  /** Raw 0–100 compliance score; null/undefined = off-playbook. */
  score?: number | null;
  /** Matched playbook name (tooltip context only). */
  playbookName?: string | null;
  /** Portfolio fetch still in flight — render a skeleton, not "off-playbook". */
  loading?: boolean;
  className?: string;
}

/**
 * Purely presentational compliance chip. No data fetching, no state — the
 * portfolio join and column wiring are owned by the list-page integrator via
 * `usePlaybookScores()`.
 */
export function ContractPlaybookCell({
  score,
  playbookName,
  loading = false,
  className,
}: ContractPlaybookCellProps) {
  const labels = useContractPlaybookCellLabels();
  const f = useLexFormat();

  if (loading) {
    return (
      <span
        className={cn(
          'inline-block h-5 w-16 animate-pulse rounded-full bg-muted',
          className,
        )}
        aria-hidden="true"
      />
    );
  }

  const normalized = normalizeComplianceScore(score);

  if (normalized === null) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full border border-dashed px-2.5 py-0.5 text-xs',
          CHIP_TONE.none,
          className,
        )}
        title={labels.offPlaybookHint}
        aria-label={labels.offPlaybookHint}
      >
        {labels.offPlaybook}
      </span>
    );
  }

  const tone = playbookComplianceTone(normalized);
  const display = formatPercent(normalized, f.locale, { fromPercent: true });
  const scoreLabel = labels.scoreLabel(display);
  const title = playbookName
    ? `${scoreLabel} · ${labels.playbookPrefix(playbookName)}`
    : scoreLabel;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5',
        CHIP_TONE[tone],
        className,
      )}
      title={title}
    >
      <span
        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT_TONE[tone])}
        aria-hidden="true"
      />
      <span className="text-sm font-semibold tabular-nums" aria-label={scoreLabel}>
        {display}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------------- *
 * 2. PlaybookThresholdChip — the below-threshold quick filter.
 * ------------------------------------------------------------------------- */

export interface PlaybookThresholdChipProps {
  /** Whether the below-threshold narrowing is active. */
  active: boolean;
  /** Toggle callback (the page owns the boolean + the data narrowing). */
  onToggle: () => void;
  /** Optional count of below-threshold contracts among the loaded rows. */
  count?: number;
  /** Score threshold (defaults to {@link PLAYBOOK_OK_THRESHOLD}). */
  threshold?: number;
  className?: string;
}

/**
 * Quick-filter chip mirroring the page's preset-chip chrome. Client-side
 * narrowing: while active the integrator swaps the table data for
 * `filterBelowPlaybookThreshold(rows, scoresById)`.
 */
export function PlaybookThresholdChip({
  active,
  onToggle,
  count,
  threshold = PLAYBOOK_OK_THRESHOLD,
  className,
}: PlaybookThresholdChipProps) {
  const labels = useContractPlaybookCellLabels();
  const f = useLexFormat();
  const thresholdDisplay = formatPercent(threshold, f.locale, { fromPercent: true });

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active
          ? 'border-brand-accent/45 bg-brand-accent/12 text-primary'
          : 'border-border bg-muted/40 text-muted-foreground hover:border-brand-accent/25 hover:text-foreground',
        className,
      )}
    >
      <Gauge
        className={cn('h-3.5 w-3.5 shrink-0', active && 'text-brand-accent')}
        aria-hidden="true"
      />
      {labels.quickFilter(thresholdDisplay)}
      {count !== undefined ? (
        <span className="ms-0.5 rounded-full bg-muted px-1.5 py-px text-[11px] tabular-nums text-foreground/80">
          {f.formatNumber(count)}
        </span>
      ) : null}
    </button>
  );
}

/* ------------------------------------------------------------------------- *
 * 3. usePlaybookDeviationsBulkAction — bulk "Export deviations".
 * ------------------------------------------------------------------------- */

/**
 * Ready-made `BulkAction` for the table's selection toolbar: downloads the
 * clause-deviation CSV (existing read-tier export endpoint) for every selected
 * contract with a matched playbook, skipping off-playbook rows and toasting a
 * bilingual summary. Read-only — safe to surface to every persona that can see
 * the list (no `canWrite` gate needed).
 */
export function usePlaybookDeviationsBulkAction(
  scoresById: ReadonlyMap<string, LexPlaybookPortfolioRow>,
): BulkAction {
  const labels = useContractPlaybookCellLabels();

  return useMemo<BulkAction>(
    () => ({
      label: labels.bulk.exportDeviations,
      icon: FileDown,
      onClick: async (selectedIds: string[]) => {
        const eligible = selectedIds.filter((id) => scoresById.has(id));
        if (eligible.length === 0) {
          showWarning(labels.bulk.nothingToExport);
          return;
        }
        showInfo(labels.bulk.started(eligible.length));
        const summary = await exportDeviationsForContracts(selectedIds, scoresById);
        if (summary.exported > 0) {
          showSuccess(labels.bulk.done(summary.exported));
        }
        if (summary.skippedOffPlaybook > 0) {
          showInfo(labels.bulk.skipped(summary.skippedOffPlaybook));
        }
        if (summary.failed > 0) {
          showError(labels.bulk.failed(summary.failed));
        }
      },
    }),
    [labels, scoresById],
  );
}
