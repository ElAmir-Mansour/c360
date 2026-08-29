'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, PowerOff, X } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLocale } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { showApiError, showSuccess } from '@/lib/toast';
import { lexAdminApi, type CaseClassification } from '@/lib/lex/admin';

// ---------------------------------------------------------------------------
// Self-contained bilingual labels (EN + AR). This component does NOT depend on
// admin-labels (owned elsewhere); it carries its own copy following the lex
// per-component i18n idiom.
// ---------------------------------------------------------------------------

type BulkAction = 'activate' | 'deactivate';

interface ToolbarStrings {
  selected: (n: number) => string;
  activate: string;
  deactivate: string;
  clear: string;
  // impact dialog
  activateTitle: string;
  deactivateTitle: string;
  activateDescription: (n: number) => string;
  deactivateDescription: (n: number) => string;
  statSelected: string;
  statDescendants: string;
  statActiveDescendants: string;
  statCases: string;
  systemSkipped: (n: number) => string;
  impactTitle: string;
  impactBody: string;
  noImpactTitle: string;
  noImpactBody: string;
  confirmPrompt: (phrase: string) => string;
  confirmPhrase: string;
  cancel: string;
  confirmActivate: string;
  confirmDeactivate: string;
  successActivate: (n: number) => string;
  successDeactivate: (n: number) => string;
  nothingToDo: string;
}

const LABELS: Record<'en' | 'ar', ToolbarStrings> = {
  en: {
    selected: (n) => `${n} selected`,
    activate: 'Activate',
    deactivate: 'Deactivate',
    clear: 'Clear',
    activateTitle: 'Activate selected classifications',
    deactivateTitle: 'Deactivate selected classifications',
    activateDescription: (n) => `Review the impact before activating ${n} selected classifications.`,
    deactivateDescription: (n) =>
      `Review the impact before deactivating ${n} selected classifications.`,
    statSelected: 'Selected',
    statDescendants: 'Descendants',
    statActiveDescendants: 'Active descendants',
    statCases: 'Cases referencing',
    systemSkipped: (n) => `${n} system classification(s) in the selection will be skipped.`,
    impactTitle: 'Impact found',
    impactBody:
      'Deactivating these classifications may affect descendant nodes and cases that reference them. The backend remains authoritative.',
    noImpactTitle: 'No loaded impact found',
    noImpactBody: 'No descendants or referencing cases were found for the selection.',
    confirmPrompt: (phrase) => `Type "${phrase}" to confirm.`,
    confirmPhrase: 'DEACTIVATE',
    cancel: 'Cancel',
    confirmActivate: 'Activate',
    confirmDeactivate: 'Deactivate',
    successActivate: (n) => `Activated ${n} classification(s).`,
    successDeactivate: (n) => `Deactivated ${n} classification(s).`,
    nothingToDo: 'No eligible classifications in the selection.',
  },
  ar: {
    selected: (n) => `${n} محدد`,
    activate: 'تفعيل',
    deactivate: 'إلغاء التفعيل',
    clear: 'مسح',
    activateTitle: 'تفعيل التصنيفات المحددة',
    deactivateTitle: 'إلغاء تفعيل التصنيفات المحددة',
    activateDescription: (n) => `راجع التأثير قبل تفعيل ${n} تصنيفًا محددًا.`,
    deactivateDescription: (n) => `راجع التأثير قبل إلغاء تفعيل ${n} تصنيفًا محددًا.`,
    statSelected: 'المحدد',
    statDescendants: 'العناصر الفرعية',
    statActiveDescendants: 'العناصر الفرعية النشطة',
    statCases: 'القضايا المرتبطة',
    systemSkipped: (n) => `سيتم تخطي ${n} تصنيف نظام ضمن التحديد.`,
    impactTitle: 'تم العثور على تأثير',
    impactBody:
      'قد يؤثر إلغاء تفعيل هذه التصنيفات على العناصر الفرعية والقضايا المرتبطة بها. يبقى الخادم هو المرجع.',
    noImpactTitle: 'لا يوجد تأثير محمَّل',
    noImpactBody: 'لم يتم العثور على عناصر فرعية أو قضايا مرتبطة بالتحديد.',
    confirmPrompt: (phrase) => `اكتب "${phrase}" للتأكيد.`,
    confirmPhrase: 'DEACTIVATE',
    cancel: 'إلغاء',
    confirmActivate: 'تفعيل',
    confirmDeactivate: 'إلغاء التفعيل',
    successActivate: (n) => `تم تفعيل ${n} تصنيف.`,
    successDeactivate: (n) => `تم إلغاء تفعيل ${n} تصنيف.`,
    nothingToDo: 'لا توجد تصنيفات مؤهلة ضمن التحديد.',
  },
};

// Collect every descendant id of a node, walking the children tree carried on
// the node objects in nodesById.
function collectDescendants(
  rootId: string,
  nodesById: Map<string, CaseClassification>,
): CaseClassification[] {
  const out: CaseClassification[] = [];
  const visit = (node: CaseClassification | undefined) => {
    for (const child of node?.children ?? []) {
      out.push(child);
      // children objects may not be present in nodesById; recurse via the
      // embedded children, falling back to the map when available.
      visit(nodesById.get(child.id) ?? child);
    }
  };
  visit(nodesById.get(rootId));
  return out;
}

export interface ClassificationBulkToolbarProps {
  selectedIds: string[];
  nodesById: Map<string, CaseClassification>;
  usage?: Record<string, number>;
  onClear: () => void;
  onDone: () => void;
}

export function ClassificationBulkToolbar({
  selectedIds,
  nodesById,
  usage,
  onClear,
  onDone,
}: ClassificationBulkToolbarProps) {
  const { locale, direction } = useLocale();
  const t = LABELS[locale === 'ar' ? 'ar' : 'en'];

  const [pendingAction, setPendingAction] = useState<BulkAction | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const selectedNodes = useMemo(
    () =>
      selectedIds
        .map((id) => nodesById.get(id))
        .filter((n): n is CaseClassification => Boolean(n)),
    [selectedIds, nodesById],
  );

  const impact = useMemo(() => {
    const selectedSet = new Set(selectedIds);
    const seen = new Set<string>();
    let descendants = 0;
    let activeDescendants = 0;
    for (const id of selectedIds) {
      for (const desc of collectDescendants(id, nodesById)) {
        // Avoid double-counting overlapping subtrees and selected roots.
        if (seen.has(desc.id) || selectedSet.has(desc.id)) continue;
        seen.add(desc.id);
        descendants += 1;
        if (desc.active) activeDescendants += 1;
      }
    }
    const cases = selectedIds.reduce((sum, id) => sum + (usage?.[id] ?? 0), 0);
    const systemCount = selectedNodes.filter((n) => n.is_system).length;
    return { descendants, activeDescendants, cases, systemCount };
  }, [selectedIds, nodesById, usage, selectedNodes]);

  if (selectedIds.length === 0) return null;

  const isDeactivate = pendingAction === 'deactivate';
  const confirmRequired = isDeactivate;
  const confirmSatisfied =
    !confirmRequired || confirmText.trim().toUpperCase() === t.confirmPhrase;

  const closeDialog = () => {
    if (submitting) return;
    setPendingAction(null);
    setConfirmText('');
  };

  const runBulk = async (action: BulkAction) => {
    if (selectedIds.length === 0) return;
    setSubmitting(true);
    try {
      const result = await lexAdminApi.bulkCaseClassifications({ action, ids: selectedIds });
      const updated = result?.updated ?? 0;
      showSuccess(
        action === 'activate' ? t.successActivate(updated) : t.successDeactivate(updated),
      );
      onDone();
      onClear();
      setPendingAction(null);
      setConfirmText('');
    } catch (error) {
      showApiError(error);
    } finally {
      setSubmitting(false);
    }
  };

  const handleActionClick = (action: BulkAction) => {
    // Activate is non-destructive but we still show the aggregate impact so the
    // operator sees scope; deactivate additionally requires type-to-confirm.
    setConfirmText('');
    setPendingAction(action);
  };

  const hasImpact = impact.descendants > 0 || impact.cases > 0;

  return (
    <>
      <div
        dir={direction}
        className="sticky bottom-4 z-20 mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 rounded-lg border bg-background px-4 py-2.5 shadow-lg"
      >
        <span className="text-sm font-medium">{t.selected(selectedIds.length)}</span>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleActionClick('activate')}
            disabled={submitting}
          >
            <CheckCircle2 className="me-1.5 h-4 w-4" aria-hidden />
            {t.activate}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleActionClick('deactivate')}
            disabled={submitting}
          >
            <PowerOff className="me-1.5 h-4 w-4" aria-hidden />
            {t.deactivate}
          </Button>
          <Button size="sm" variant="ghost" onClick={onClear} disabled={submitting}>
            <X className="me-1.5 h-4 w-4" aria-hidden />
            {t.clear}
          </Button>
        </div>
      </div>

      <AlertDialog open={pendingAction !== null} onOpenChange={(open) => (!open ? closeDialog() : null)}>
        <AlertDialogContent dir={direction}>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isDeactivate ? t.deactivateTitle : t.activateTitle}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isDeactivate
                ? t.deactivateDescription(selectedIds.length)
                : t.activateDescription(selectedIds.length)}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-4">
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">{t.statSelected}</p>
                <p className="text-lg font-semibold">{selectedIds.length}</p>
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">{t.statDescendants}</p>
                <p className="text-lg font-semibold">{impact.descendants}</p>
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">{t.statActiveDescendants}</p>
                <p className="text-lg font-semibold">{impact.activeDescendants}</p>
              </div>
              <div className="rounded-md border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">{t.statCases}</p>
                <p className="text-lg font-semibold">{impact.cases}</p>
              </div>
            </div>

            {isDeactivate ? (
              hasImpact ? (
                <Alert variant="warning">
                  <AlertTriangle className="h-4 w-4" aria-hidden />
                  <AlertTitle>{t.impactTitle}</AlertTitle>
                  <AlertDescription>{t.impactBody}</AlertDescription>
                </Alert>
              ) : (
                <Alert>
                  <AlertTitle>{t.noImpactTitle}</AlertTitle>
                  <AlertDescription>{t.noImpactBody}</AlertDescription>
                </Alert>
              )
            ) : null}

            {impact.systemCount > 0 ? (
              <p className="text-xs text-muted-foreground">{t.systemSkipped(impact.systemCount)}</p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {selectedNodes.slice(0, 8).map((node) => (
                <Badge key={node.id} variant="secondary">
                  {resolveLocalized(node.name, locale) || node.code}
                </Badge>
              ))}
              {selectedNodes.length > 8 ? (
                <Badge variant="outline">+{selectedNodes.length - 8}</Badge>
              ) : null}
            </div>

            {confirmRequired ? (
              <div className="space-y-1.5">
                <Label htmlFor="bulk-confirm">{t.confirmPrompt(t.confirmPhrase)}</Label>
                <Input
                  id="bulk-confirm"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  autoComplete="off"
                  disabled={submitting}
                />
              </div>
            ) : null}
          </div>

          <AlertDialogFooter>
            <Button variant="outline" onClick={closeDialog} disabled={submitting}>
              {t.cancel}
            </Button>
            <Button
              variant={isDeactivate ? 'destructive' : 'default'}
              onClick={() => pendingAction && runBulk(pendingAction)}
              disabled={submitting || !confirmSatisfied}
            >
              {submitting ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
              {isDeactivate ? t.confirmDeactivate : t.confirmActivate}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
