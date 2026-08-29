'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { ErrorState } from '@/components/common/error-state';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { RelativeTime } from '@/components/shared/relative-time';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { type LexBilingual, resolveLexBilingual } from '@/app/(dashboard)/lex/_lib/lex-i18n';
import {
  type CaseClassification,
  type CaseClassificationAuditEntry,
  lexAdminApi,
} from '@/lib/lex/admin';

/* --------------------------------------------------------------------------- *
 * Self-contained bilingual labels (this component owns its strings; it does NOT
 * read the shared admin-labels module, which is owned elsewhere).
 * --------------------------------------------------------------------------- */

interface AuditDialogLabels {
  readonly title: string;
  readonly description: string;
  readonly close: string;
  readonly loadError: string;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly systemActor: string;
  /** Raw backend action token -> localized label. */
  readonly actionLabels: Record<string, string>;
  /** Raw backend classification-field token -> localized label (diff rows). */
  readonly fieldLabels: Record<string, string>;
  /** Heading for the changed-fields diff block. */
  readonly changes: string;
  /** Shown when an entry records no field-level changes. */
  readonly noChanges: string;
  /** Empty-value placeholder inside a diff. */
  readonly emptyValue: string;
}

const auditDialogLabels: LexBilingual<AuditDialogLabels> = {
  en: {
    title: 'Classification history',
    description: 'Audit trail of changes to this case classification.',
    close: 'Close',
    loadError: 'Could not load the audit history. Please try again.',
    emptyTitle: 'No history yet',
    emptyDescription: 'Changes to this classification will appear here.',
    systemActor: 'System',
    actionLabels: {
      created: 'Created',
      updated: 'Updated',
      deleted: 'Deleted',
      activated: 'Activated',
      deactivated: 'Deactivated',
      reordered: 'Reordered',
      merged: 'Merged',
      moved: 'Moved',
    },
    fieldLabels: {
      parent_id: 'Parent',
      code: 'Code',
      name: 'Name',
      path: 'Path',
      is_system: 'System-defined',
      active: 'Active',
      sort: 'Sort order',
      metadata: 'Metadata',
      tenant_id: 'Tenant',
      created_by: 'Created by',
      created_at: 'Created at',
      updated_at: 'Updated at',
      deleted_at: 'Deleted at',
    },
    changes: 'Changes',
    noChanges: 'No field-level changes recorded.',
    emptyValue: '—',
  },
  ar: {
    title: 'سجل التصنيف',
    description: 'سجل تدقيق التغييرات على تصنيف القضية هذا.',
    close: 'إغلاق',
    loadError: 'تعذر تحميل سجل التدقيق. يرجى المحاولة مرة أخرى.',
    emptyTitle: 'لا يوجد سجل بعد',
    emptyDescription: 'ستظهر التغييرات على هذا التصنيف هنا.',
    systemActor: 'النظام',
    actionLabels: {
      created: 'تم الإنشاء',
      updated: 'تم التحديث',
      deleted: 'تم الحذف',
      activated: 'تم التفعيل',
      deactivated: 'تم التعطيل',
      reordered: 'تمت إعادة الترتيب',
      merged: 'تم الدمج',
      moved: 'تم النقل',
    },
    fieldLabels: {
      parent_id: 'التصنيف الأصل',
      code: 'الرمز',
      name: 'الاسم',
      path: 'المسار',
      is_system: 'مُعرَّف بالنظام',
      active: 'نشط',
      sort: 'ترتيب الفرز',
      metadata: 'البيانات الوصفية',
      tenant_id: 'المستأجر',
      created_by: 'أنشأه',
      created_at: 'تاريخ الإنشاء',
      updated_at: 'تاريخ التحديث',
      deleted_at: 'تاريخ الحذف',
    },
    changes: 'التغييرات',
    noChanges: 'لا توجد تغييرات على مستوى الحقول مسجلة.',
    emptyValue: '—',
  },
};

function formatToken(value: string): string {
  return value.replace(/_/g, ' ');
}

/* --------------------------------------------------------------------------- *
 * Diff helpers — `before`/`after` are opaque snapshots (unknown). We surface a
 * compact list of changed top-level fields without leaning on `any`.
 * --------------------------------------------------------------------------- */

interface FieldChange {
  readonly field: string;
  readonly before: string;
  readonly after: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringifyValue(value: unknown, emptyValue: string): string {
  if (value === null || value === undefined || value === '') {
    return emptyValue;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function computeChanges(
  before: unknown,
  after: unknown,
  emptyValue: string,
): FieldChange[] {
  const beforeObj = isRecord(before) ? before : {};
  const afterObj = isRecord(after) ? after : {};
  const keys = Array.from(
    new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]),
  ).sort();

  const changes: FieldChange[] = [];
  for (const key of keys) {
    const prev = beforeObj[key];
    const next = afterObj[key];
    if (shallowEqual(prev, next)) {
      continue;
    }
    changes.push({
      field: key,
      before: stringifyValue(prev, emptyValue),
      after: stringifyValue(next, emptyValue),
    });
  }
  return changes;
}

export function ClassificationAuditDialog({
  node,
  open,
  onOpenChange,
}: {
  node: CaseClassification | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { locale, direction } = useLocaleOrDefault();
  const labels = useMemo(
    () => resolveLexBilingual(auditDialogLabels, locale),
    [locale],
  );

  const nodeId = node?.id ?? '';
  const nodeName = node ? resolveLocalized(node.name, locale) : '';

  const auditQuery = useQuery({
    queryKey: ['lex-case-classification-audit', nodeId],
    queryFn: () => lexAdminApi.listCaseClassificationAudit(nodeId),
    enabled: open && nodeId !== '',
  });

  const entries: CaseClassificationAuditEntry[] = auditQuery.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        dir={direction}
        className="max-h-[85vh] max-w-2xl overflow-y-auto"
      >
        <DialogHeader className="text-start">
          <DialogTitle>{labels.title}</DialogTitle>
          <DialogDescription>
            {nodeName || labels.description}
          </DialogDescription>
        </DialogHeader>

        {auditQuery.isLoading ? (
          <LoadingSkeleton variant="list-item" count={4} />
        ) : auditQuery.isError ? (
          <ErrorState
            message={labels.loadError}
            onRetry={() => void auditQuery.refetch()}
          />
        ) : entries.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-8 text-center">
            <ScrollText
              className="mx-auto h-6 w-6 text-muted-foreground"
              aria-hidden
            />
            <p className="mt-2 text-sm font-medium">{labels.emptyTitle}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {labels.emptyDescription}
            </p>
          </div>
        ) : (
          <ol className="space-y-3">
            {entries.map((entry) => {
              const changes = computeChanges(
                entry.before,
                entry.after,
                labels.emptyValue,
              );
              const actor =
                entry.actor_name?.trim() ||
                entry.actor_id?.trim() ||
                labels.systemActor;
              return (
                <li
                  key={entry.id}
                  className="space-y-2 rounded-lg border px-4 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary">
                        {labels.actionLabels[entry.action] ??
                          formatToken(entry.action)}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {actor}
                      </span>
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      <RelativeTime date={entry.created_at} />
                    </span>
                  </div>

                  {changes.length > 0 ? (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">
                        {labels.changes}
                      </p>
                      <ul className="space-y-1">
                        {changes.map((change) => (
                          <li
                            key={change.field}
                            className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs"
                          >
                            <span className="font-mono font-medium">
                              {labels.fieldLabels[change.field] ??
                                formatToken(change.field)}
                            </span>
                            <span className="text-muted-foreground line-through">
                              {change.before}
                            </span>
                            <span aria-hidden className="text-muted-foreground">
                              →
                            </span>
                            <span className="font-medium">{change.after}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {labels.noChanges}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            {labels.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
