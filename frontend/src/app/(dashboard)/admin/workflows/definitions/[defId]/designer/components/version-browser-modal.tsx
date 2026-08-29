'use client';

/**
 * VersionBrowserModal — reusable browser for a workflow definition's version
 * lineage (definition_key) and the promotion FSM (dev→staging→prod).
 *
 * Data sources (engine WP-4):
 *   GET  /definitions/{id}/lineage  -> every live version sharing definition_key,
 *                                      each with stage + immutability + status.
 *   GET  /definitions/{id}/versions -> always-available fallback when the
 *                                      promotion service is not wired (501 lineage).
 *   POST /definitions/{id}/promote  -> advance the current definition one stage.
 *
 * The modal fetches its own data (lineage with a /versions fallback) so it can be
 * dropped anywhere — the designer toolbar today, the Phase C canvas tomorrow —
 * with just the defId + currentDefId. The promote action targets the CURRENT
 * definition (the one open in the designer) and advances it to the single legal
 * next stage; illegal/immutable promotions surface as a 409 toast from the hook.
 *
 * Bilingual EN/AR + RTL via inline {ar,en} copy + the active locale.
 */

import { useMemo } from 'react';
import {
  GitBranch,
  Loader2,
  Lock,
  ArrowUpCircle,
  CheckCircle2,
  Layers,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  useWorkflowDefinitionLineage,
  useWorkflowDefinitionVersionList,
  usePromoteWorkflowDefinition,
  nextPromotionStage,
  type PromotionRecord,
  type PromotionStage,
} from '../use-workflow-lifecycle';

type Loc = { ar: string; en: string };
const pick = (l: Loc, locale: string) => (locale === 'ar' ? l.ar : l.en);

const T = {
  title: { ar: 'إصدارات سير العمل', en: 'Workflow Versions' },
  subtitle: {
    ar: 'سلسلة الإصدارات وحالة الترقية (تطوير ← تجهيز ← إنتاج)',
    en: 'Version lineage & promotion (dev → staging → prod)',
  },
  loading: { ar: 'جارٍ التحميل…', en: 'Loading…' },
  empty: { ar: 'لا توجد إصدارات.', en: 'No versions found.' },
  current: { ar: 'الحالي', en: 'Current' },
  immutable: { ar: 'غير قابل للتعديل', en: 'Immutable' },
  promote: { ar: 'ترقية إلى', en: 'Promote to' },
  promoting: { ar: 'جارٍ الترقية…', en: 'Promoting…' },
  atProd: { ar: 'في الإنتاج', en: 'At production' },
  versionLabel: { ar: 'الإصدار', en: 'Version' },
};

const STAGE_LABEL: Record<PromotionStage, Loc> = {
  dev: { ar: 'تطوير', en: 'Dev' },
  staging: { ar: 'تجهيز', en: 'Staging' },
  prod: { ar: 'إنتاج', en: 'Prod' },
};

const STATUS_LABEL: Record<string, Loc> = {
  draft: { ar: 'مسودة', en: 'Draft' },
  active: { ar: 'نشط', en: 'Active' },
  archived: { ar: 'مؤرشف', en: 'Archived' },
  deprecated: { ar: 'متقادم', en: 'Deprecated' },
};

function stageVariant(
  stage: string,
): 'default' | 'secondary' | 'outline' {
  switch (stage) {
    case 'prod':
      return 'default';
    case 'staging':
      return 'secondary';
    default:
      return 'outline';
  }
}

function statusVariant(
  status: string,
): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (status) {
    case 'active':
      return 'default';
    case 'draft':
      return 'secondary';
    case 'archived':
      return 'outline';
    default:
      return 'outline';
  }
}

export interface VersionBrowserModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Definition whose lineage to browse (any version of the lineage works). */
  defId: string;
  /** The version currently open in the designer — highlighted + promote target. */
  currentDefId: string;
  /** Whether the current user may promote (RBAC: workflow:admin). */
  canPromote?: boolean;
}

export function VersionBrowserModal({
  open,
  onOpenChange,
  defId,
  currentDefId,
  canPromote = true,
}: VersionBrowserModalProps) {
  const { locale } = useLocaleOrDefault();
  const tr = (l: Loc) => pick(l, locale);

  const lineageQuery = useWorkflowDefinitionLineage(defId, open);
  // Fall back to the plain version list only if lineage is unavailable
  // (promotion service not wired => /lineage 501s => lineageQuery errors).
  const versionsQuery = useWorkflowDefinitionVersionList(
    defId,
    open && lineageQuery.isError,
  );
  const promoteMutation = usePromoteWorkflowDefinition(currentDefId);

  const rows = useMemo<PromotionRecord[]>(() => {
    // Guard on Array.isArray, not truthiness: if either endpoint returns a
    // non-array (e.g. an envelope object or an error payload) spreading it would
    // throw "not iterable" and crash the modal via the error boundary.
    if (Array.isArray(lineageQuery.data) && lineageQuery.data.length > 0) {
      return [...lineageQuery.data].sort((a, b) => b.version - a.version);
    }
    if (Array.isArray(versionsQuery.data)) {
      // Adapt the plain version list to the row shape (no stage info).
      return [...versionsQuery.data]
        .map((v) => ({
          id: v.id ?? '',
          name: v.name ?? '',
          version: v.version,
          status: v.status,
          definition_key: '',
          stage: '',
          immutable: false,
        }))
        .sort((a, b) => b.version - a.version);
    }
    return [];
  }, [lineageQuery.data, versionsQuery.data]);

  const isLoading =
    lineageQuery.isLoading || (lineageQuery.isError && versionsQuery.isLoading);

  const currentRow = rows.find((r) => r.id === currentDefId);
  const nextStage = nextPromotionStage(currentRow?.stage);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" aria-hidden />
            {tr(T.title)}
          </DialogTitle>
          <DialogDescription>{tr(T.subtitle)}</DialogDescription>
        </DialogHeader>

        {/* Promote action bar (current version) */}
        {canPromote && currentRow && currentRow.stage && (
          <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2">
            <div className="flex items-center gap-2 text-xs">
              <GitBranch className="h-4 w-4 text-muted-foreground" aria-hidden />
              <span className="text-muted-foreground">{tr(T.current)}:</span>
              <span className="font-medium tabular-nums" dir="ltr">
                v{currentRow.version}
              </span>
              <Badge variant={stageVariant(currentRow.stage)}>
                {pick(STAGE_LABEL[currentRow.stage as PromotionStage] ?? { ar: currentRow.stage, en: currentRow.stage }, locale)}
              </Badge>
            </div>
            {nextStage ? (
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={promoteMutation.isPending || currentRow.immutable}
                onClick={() => promoteMutation.mutate({ toStage: nextStage })}
              >
                {promoteMutation.isPending ? (
                  <Loader2 className="me-1 h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <ArrowUpCircle className="me-1 h-3.5 w-3.5" aria-hidden />
                )}
                {promoteMutation.isPending
                  ? tr(T.promoting)
                  : `${tr(T.promote)} ${pick(STAGE_LABEL[nextStage], locale)}`}
              </Button>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-success-600 dark:text-success-300">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                {tr(T.atProd)}
              </span>
            )}
          </div>
        )}

        {isLoading && (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {tr(T.loading)}
          </div>
        )}

        {!isLoading && rows.length === 0 && (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {tr(T.empty)}
          </p>
        )}

        {!isLoading && rows.length > 0 && (
          <ScrollArea className="flex-1 -mx-1 px-1">
            <ul className="space-y-2 py-1">
              {rows.map((row) => {
                const isCurrent = row.id === currentDefId;
                return (
                  <li
                    key={row.id || `v${row.version}`}
                    className={cn(
                      'flex items-center gap-3 rounded-md border px-3 py-2.5',
                      isCurrent
                        ? 'border-primary/60 bg-primary/5'
                        : 'bg-card',
                    )}
                  >
                    <span className="flex h-9 w-12 shrink-0 flex-col items-center justify-center rounded-md bg-muted text-center">
                      <span className="text-[9px] uppercase leading-none text-muted-foreground">
                        {tr(T.versionLabel)}
                      </span>
                      <span className="text-sm font-semibold tabular-nums leading-tight" dir="ltr">
                        {row.version}
                      </span>
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {row.name && (
                          <span className="truncate text-sm font-medium">
                            {row.name}
                          </span>
                        )}
                        {isCurrent && (
                          <Badge variant="outline" className="border-primary/50 text-primary">
                            {tr(T.current)}
                          </Badge>
                        )}
                      </div>
                      {row.promoted_by && (
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground" dir="ltr">
                          {row.promoted_by}
                          {row.promoted_at
                            ? ` · ${new Date(row.promoted_at).toLocaleString()}`
                            : ''}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      {row.stage && (
                        <Badge variant={stageVariant(row.stage)}>
                          {pick(
                            STAGE_LABEL[row.stage as PromotionStage] ?? {
                              ar: row.stage,
                              en: row.stage,
                            },
                            locale,
                          )}
                        </Badge>
                      )}
                      <Badge variant={statusVariant(row.status)}>
                        {pick(
                          STATUS_LABEL[row.status] ?? {
                            ar: row.status,
                            en: row.status,
                          },
                          locale,
                        )}
                      </Badge>
                      {row.immutable && (
                        <span
                          className="text-muted-foreground"
                          title={tr(T.immutable)}
                          aria-label={tr(T.immutable)}
                        >
                          <Lock className="h-3.5 w-3.5" aria-hidden />
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  );
}
