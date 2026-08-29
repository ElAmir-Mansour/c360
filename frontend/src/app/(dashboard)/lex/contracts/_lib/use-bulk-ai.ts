'use client';

/**
 * Bulk AI actions for the ClarioLegal / Watheeq contracts list (`/lex/contracts`).
 *
 * Four selection-scoped operations exposed as DataTable `BulkAction` entries:
 *
 *   - Run compliance     -> ONE array-native call `POST /compliance/run`
 *                           with `{ contract_ids }` (enterpriseApi.lex.runCompliance).
 *   - Analyze            -> fan-out `POST /contracts/{id}/analyze` per id
 *                           (enterpriseApi.lex.analyzeContract), concurrency 3.
 *   - Extract obligations-> fan-out `POST /contracts/{id}/obligations/extract`
 *                           (enterpriseApi.lex.extractContractObligations) with the
 *                           current user as obligation owner, concurrency 3.
 *   - Auto-categorize    -> load the tenant category catalog once
 *                           (`GET /contracts/categories`), derive slugs from each
 *                           contract's `type`, then fan-out
 *                           `POST /contracts/{id}/categorize`, concurrency 3.
 *
 * Progress is reported through a single updating sonner toast (`n/total`); any
 * per-item failures are collected into a `BulkAiSummary` that the page surfaces
 * via `<BulkAiActionsDialog />` (failed ids + human-readable reasons).
 *
 * RBAC: the hook returns an EMPTY action list unless `canWrite` is true (the
 * page-level `lex:contract:add | lex:contract:edit` gate), and `runBulkAi`
 * re-checks the gate so a mutation can never fire for a read-only persona.
 *
 * Labels follow the canonical lex bilingual contract (`LexBilingual<T>` with
 * full same-shaped `en`/`ar` copies) resolved via `useLocaleOrDefault`, exactly
 * like `_lib/contracts-labels.ts`.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ListChecks, ShieldCheck, Sparkles, Tags } from 'lucide-react';

import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useAuth } from '@/hooks/use-auth';
import { apiGet, apiPost } from '@/lib/api';
import { parseApiError } from '@/lib/format';
import { enterpriseApi } from '@/lib/enterprise';
import { dismissToast, showError, showSuccess, toast } from '@/lib/toast';
import type { LexContract } from '@/types/suites';
import type { BulkAction } from '@/types/table';

import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

/* ------------------------------------------------------------------------- *
 * Types.
 * ------------------------------------------------------------------------- */

export type BulkAiKind =
  | 'compliance'
  | 'analyze'
  | 'extract_obligations'
  | 'auto_categorize';

/** One failed item in a bulk run: which contract and why. */
export interface BulkAiFailure {
  id: string;
  title: string;
  reason: string;
}

/** Outcome of a bulk run, consumed by the partial-failure summary dialog. */
export interface BulkAiSummary {
  kind: BulkAiKind;
  total: number;
  succeeded: number;
  failures: BulkAiFailure[];
}

/** Minimal shape of a tenant contract-category catalog entry (CAP-123). */
export interface BulkAiCategoryOption {
  id: string;
  name: string;
  slug: string;
}

/* ------------------------------------------------------------------------- *
 * Bilingual labels (canonical `LexBilingual<T>` bundle, en === existing English
 * conventions, ar is professional MSA; function labels keep Western digits like
 * the rest of the contracts label bundles).
 * ------------------------------------------------------------------------- */

export interface BulkAiLabels {
  actions: {
    runCompliance: string;
    analyze: string;
    extractObligations: string;
    autoCategorize: string;
  };
  running: Record<BulkAiKind, string>;
  progress: (done: number, total: number) => string;
  toast: {
    allDone: (action: string, count: number) => string;
    complianceDone: (score: number, alerts: number) => string;
    obligationsDone: (contracts: number, obligations: number) => string;
    allFailed: (action: string) => string;
    nothingSelected: string;
  };
  reasons: {
    noCategoryMatch: string;
    missingOwner: string;
  };
  dialog: {
    title: (action: string) => string;
    description: (succeeded: string, failed: string) => string;
    failedListLabel: string;
    reasonLabel: string;
    unknownContract: string;
    close: string;
  };
}

export const bulkAiLabels: LexBilingual<BulkAiLabels> = {
  en: {
    actions: {
      runCompliance: 'Run compliance',
      analyze: 'Analyze',
      extractObligations: 'Extract obligations',
      autoCategorize: 'Auto-categorize',
    },
    running: {
      compliance: 'Running compliance…',
      analyze: 'Analyzing contracts…',
      extract_obligations: 'Extracting obligations…',
      auto_categorize: 'Auto-categorizing…',
    },
    progress: (done, total) => `${done}/${total} contracts processed`,
    toast: {
      allDone: (action, count) =>
        `${action} completed for ${count} contract${count === 1 ? '' : 's'}.`,
      complianceDone: (score, alerts) =>
        `Compliance run scored ${score}% and created ${alerts} alert${alerts === 1 ? '' : 's'}.`,
      obligationsDone: (contracts, obligations) =>
        `Extracted ${obligations} obligation${obligations === 1 ? '' : 's'} across ${contracts} contract${contracts === 1 ? '' : 's'}.`,
      allFailed: (action) => `${action} failed for every selected contract.`,
      nothingSelected: 'Select at least one contract first.',
    },
    reasons: {
      noCategoryMatch: 'No matching category in the tenant catalog.',
      missingOwner: 'Current user could not be resolved as obligation owner.',
    },
    dialog: {
      title: (action) => `${action} — partial failure`,
      description: (succeeded, failed) =>
        `${succeeded} succeeded, ${failed} failed. Review the failures below and retry.`,
      failedListLabel: 'Failed contracts',
      reasonLabel: 'Reason',
      unknownContract: 'Unknown contract',
      close: 'Close',
    },
  },
  ar: {
    actions: {
      runCompliance: 'تشغيل الامتثال',
      analyze: 'تحليل',
      extractObligations: 'استخراج الالتزامات',
      autoCategorize: 'تصنيف تلقائي',
    },
    running: {
      compliance: 'جارٍ تشغيل الامتثال…',
      analyze: 'جارٍ تحليل العقود…',
      extract_obligations: 'جارٍ استخراج الالتزامات…',
      auto_categorize: 'جارٍ التصنيف التلقائي…',
    },
    progress: (done, total) => `تمت معالجة ${done}/${total} من العقود`,
    toast: {
      allDone: (action, count) => `اكتمل «${action}» لـ ${count} عقد.`,
      complianceDone: (score, alerts) =>
        `سجّل تشغيل الامتثال ${score}% وأنشأ ${alerts} تنبيهًا.`,
      obligationsDone: (contracts, obligations) =>
        `تم استخراج ${obligations} التزامًا عبر ${contracts} عقد.`,
      allFailed: (action) => `فشل «${action}» لجميع العقود المحددة.`,
      nothingSelected: 'حدّد عقدًا واحدًا على الأقل أولًا.',
    },
    reasons: {
      noCategoryMatch: 'لا توجد فئة مطابقة في كتالوج المستأجر.',
      missingOwner: 'تعذّر تحديد المستخدم الحالي كمالك للالتزامات.',
    },
    dialog: {
      title: (action) => `${action} — فشل جزئي`,
      description: (succeeded, failed) =>
        `نجح ${succeeded}، وفشل ${failed}. راجع حالات الفشل أدناه وأعد المحاولة.`,
      failedListLabel: 'العقود المتعثّرة',
      reasonLabel: 'السبب',
      unknownContract: 'عقد غير معروف',
      close: 'إغلاق',
    },
  },
};

/** Resolve the bulk-AI label bundle for the active locale. */
export function useBulkAiLabels(): BulkAiLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(bulkAiLabels, locale), [locale]);
}

/** Display name of a bulk-AI kind (used by toasts and the summary dialog). */
export function bulkAiKindLabel(labels: BulkAiLabels, kind: BulkAiKind): string {
  switch (kind) {
    case 'compliance':
      return labels.actions.runCompliance;
    case 'analyze':
      return labels.actions.analyze;
    case 'extract_obligations':
      return labels.actions.extractObligations;
    case 'auto_categorize':
      return labels.actions.autoCategorize;
  }
}

/* ------------------------------------------------------------------------- *
 * Pure helpers (exported for unit tests).
 * ------------------------------------------------------------------------- */

/** Fan-out concurrency for the per-contract AI endpoints. */
export const BULK_AI_CONCURRENCY = 3;

/**
 * Run `worker` over `items` with at most `limit` requests in flight. Each lane
 * pulls the next index only after its previous await settles, so ordering
 * inside a lane is sequential while lanes progress in parallel. Workers must
 * not throw — per-item failures are the worker's responsibility to record.
 */
export async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const laneCount = Math.max(1, Math.min(limit, items.length));
  const lanes = Array.from({ length: laneCount }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(lanes);
}

/** Lowercase + collapse spaces/hyphens to underscores for slug comparison. */
function normalizeCategoryToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/**
 * Derive the catalog category slugs that match a contract's `type` token
 * (e.g. type `nda` matches a catalog entry with slug `nda` or name "NDA";
 * `service_agreement` matches slug `service-agreement` or name
 * "Service Agreement"). Returns the RAW catalog slugs so the server-side
 * catalog validation always passes for what we send.
 */
export function deriveCategorySlugs(
  contract: Pick<LexContract, 'type'>,
  catalog: readonly BulkAiCategoryOption[],
): string[] {
  const candidate = normalizeCategoryToken(contract.type ?? '');
  if (!candidate) return [];
  const matches: string[] = [];
  for (const category of catalog) {
    if (
      normalizeCategoryToken(category.slug) === candidate ||
      normalizeCategoryToken(category.name) === candidate
    ) {
      matches.push(category.slug);
    }
  }
  return matches;
}

/* ------------------------------------------------------------------------- *
 * The hook.
 * ------------------------------------------------------------------------- */

const CATEGORIES_URL = '/api/v1/lex/contracts/categories';
const CATEGORIZE_URL = (contractId: string) =>
  `/api/v1/lex/contracts/${contractId}/categorize`;

export interface UseBulkAiOptions {
  /** Currently loaded table rows — used for titles + auto-categorize input. */
  contracts: LexContract[];
  /** The page's `lex:contract:add | lex:contract:edit` mutation gate. */
  canWrite: boolean;
  /** Called after a run that mutated at least one contract (e.g. `refetch`). */
  onCompleted?: () => void;
}

export interface UseBulkAiResult {
  /** Ready-made DataTable bulk actions (EMPTY unless `canWrite`). */
  actions: BulkAction[];
  /** Last run outcome with failures, feeding the summary dialog. */
  summary: BulkAiSummary | null;
  /** Partial-failure dialog visibility. */
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  /** True while a bulk run is in flight (runs are serialized). */
  isRunning: boolean;
  /** Imperative entry point (also what each action's onClick calls). */
  runBulkAi: (kind: BulkAiKind, ids: string[]) => Promise<void>;
}

export function useBulkAi({
  contracts,
  canWrite,
  onCompleted,
}: UseBulkAiOptions): UseBulkAiResult {
  const labels = useBulkAiLabels();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [summary, setSummary] = useState<BulkAiSummary | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const runningRef = useRef(false);

  // Latest rows without forcing the actions array to churn every fetch.
  const contractsRef = useRef(contracts);
  contractsRef.current = contracts;

  const contractTitle = useCallback(
    (id: string): string =>
      contractsRef.current.find((row) => row.id === id)?.title ??
      labels.dialog.unknownContract,
    [labels.dialog.unknownContract],
  );

  const runBulkAi = useCallback(
    async (kind: BulkAiKind, ids: string[]): Promise<void> => {
      // Defense in depth: never mutate for a read-only persona, never overlap runs.
      if (!canWrite || runningRef.current) return;
      if (ids.length === 0) {
        showError(labels.toast.nothingSelected);
        return;
      }

      runningRef.current = true;
      setIsRunning(true);

      const actionLabel = bulkAiKindLabel(labels, kind);
      const total = ids.length;
      const toastId = `lex-contracts-bulk-ai-${kind}`;
      let done = 0;
      const reportProgress = () => {
        toast.loading(labels.running[kind], {
          id: toastId,
          description: labels.progress(done, total),
        });
      };
      reportProgress();

      const failures: BulkAiFailure[] = [];
      const fail = (id: string, reason: string) => {
        failures.push({ id, title: contractTitle(id), reason });
      };

      // Optional kind-specific success description for the final toast.
      let successDescription: string | undefined;

      try {
        if (kind === 'compliance') {
          // Array-native endpoint: ONE call covering the whole selection.
          try {
            const result = await enterpriseApi.lex.runCompliance({
              contract_ids: ids,
            });
            successDescription = labels.toast.complianceDone(
              Math.round(result.score),
              result.alerts_created,
            );
          } catch (error) {
            const reason = parseApiError(error);
            ids.forEach((id) => fail(id, reason));
          }
          done = total;
          reportProgress();
        } else if (kind === 'analyze') {
          await runWithConcurrency(ids, BULK_AI_CONCURRENCY, async (id) => {
            try {
              await enterpriseApi.lex.analyzeContract(id);
            } catch (error) {
              fail(id, parseApiError(error));
            }
            done += 1;
            reportProgress();
          });
        } else if (kind === 'extract_obligations') {
          const ownerId = user?.id ?? '';
          const ownerName =
            user?.full_name ||
            [user?.first_name, user?.last_name].filter(Boolean).join(' ') ||
            user?.email ||
            '';
          if (!ownerId || !ownerName) {
            ids.forEach((id) => fail(id, labels.reasons.missingOwner));
            done = total;
            reportProgress();
          } else {
            let obligationsCreated = 0;
            await runWithConcurrency(ids, BULK_AI_CONCURRENCY, async (id) => {
              try {
                const result = await enterpriseApi.lex.extractContractObligations(id, {
                  owner_user_id: ownerId,
                  owner_name: ownerName,
                  include_contract_renewal: true,
                });
                obligationsCreated += result.created_count;
              } catch (error) {
                fail(id, parseApiError(error));
              }
              done += 1;
              reportProgress();
            });
            successDescription = labels.toast.obligationsDone(
              total - failures.length,
              obligationsCreated,
            );
          }
        } else {
          // auto_categorize: one catalog read, then per-contract writes.
          let catalog: BulkAiCategoryOption[] = [];
          let catalogError: string | null = null;
          try {
            const res = await apiGet<{ data: BulkAiCategoryOption[] }>(CATEGORIES_URL);
            catalog = res.data ?? [];
          } catch (error) {
            catalogError = parseApiError(error);
          }
          if (catalogError) {
            ids.forEach((id) => fail(id, catalogError as string));
            done = total;
            reportProgress();
          } else {
            await runWithConcurrency(ids, BULK_AI_CONCURRENCY, async (id) => {
              const row = contractsRef.current.find((entry) => entry.id === id);
              const slugs = row ? deriveCategorySlugs(row, catalog) : [];
              if (slugs.length === 0) {
                fail(id, labels.reasons.noCategoryMatch);
              } else {
                try {
                  await apiPost<{ data: unknown }>(CATEGORIZE_URL(id), {
                    category_tags: slugs,
                  });
                } catch (error) {
                  fail(id, parseApiError(error));
                }
              }
              done += 1;
              reportProgress();
            });
          }
        }
      } finally {
        dismissToast(toastId);
        runningRef.current = false;
        setIsRunning(false);
      }

      const succeeded = total - failures.length;
      if (failures.length === 0) {
        showSuccess(labels.toast.allDone(actionLabel, succeeded), successDescription);
      } else {
        if (succeeded === 0) {
          showError(labels.toast.allFailed(actionLabel));
        }
        setSummary({ kind, total, succeeded, failures });
        setDialogOpen(true);
      }

      if (succeeded > 0) {
        // Matches the `useDataTable` queryKey ('lex-contracts') AND the KPI
        // stats query (['lex-contracts', 'stats']) by prefix.
        void queryClient.invalidateQueries({ queryKey: ['lex-contracts'] });
        onCompleted?.();
      }
    },
    [canWrite, contractTitle, labels, onCompleted, queryClient, user],
  );

  const actions: BulkAction[] = useMemo(() => {
    if (!canWrite) return [];
    return [
      {
        label: labels.actions.runCompliance,
        icon: ShieldCheck,
        onClick: (ids) => runBulkAi('compliance', ids),
      },
      {
        label: labels.actions.analyze,
        icon: Sparkles,
        onClick: (ids) => runBulkAi('analyze', ids),
      },
      {
        label: labels.actions.extractObligations,
        icon: ListChecks,
        onClick: (ids) => runBulkAi('extract_obligations', ids),
      },
      {
        label: labels.actions.autoCategorize,
        icon: Tags,
        onClick: (ids) => runBulkAi('auto_categorize', ids),
      },
    ];
  }, [canWrite, labels, runBulkAi]);

  return { actions, summary, dialogOpen, setDialogOpen, isRunning, runBulkAi };
}
