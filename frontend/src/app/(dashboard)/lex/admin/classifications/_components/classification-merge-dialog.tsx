'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, GitMerge, Loader2, ShieldAlert } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  resolveLexBilingual,
  type LexBilingual,
} from '@/app/(dashboard)/lex/_lib/lex-i18n';
import { resolveLocalized } from '@/lib/i18n/localized';
import { showApiError, showSuccess } from '@/lib/toast';
import { lexAdminApi, type CaseClassification } from '@/lib/lex/admin';

// ---------------------------------------------------------------------------
// Self-contained bilingual labels (this component owns its own copy — it does
// NOT depend on admin-labels, which only covers the existing three files).
// ---------------------------------------------------------------------------

interface MergeLabels {
  title: string;
  description: string;
  targetLabel: string;
  targetPlaceholder: string;
  noTargets: string;
  impact: {
    heading: string;
    remappedTitle: string;
    remappedHint: (n: number) => string;
    descendantsTitle: string;
    descendantsHint: string;
    targetTitle: string;
    unnamed: string;
  };
  inactiveTarget: string;
  systemSourceWarning: string;
  confirmHeading: string;
  confirmPrompt: (code: string) => string;
  confirmMismatch: string;
  cancel: string;
  merge: string;
  merging: string;
  success: (n: number) => string;
}

const mergeLabels: LexBilingual<MergeLabels> = {
  en: {
    title: 'Merge classification',
    description:
      'Move every case mapped to the source classification onto a target, then deactivate the source. This cannot be undone.',
    targetLabel: 'Merge into target',
    targetPlaceholder: 'Select a target classification',
    noTargets: 'No eligible target classifications are available.',
    impact: {
      heading: 'Impact preview',
      remappedTitle: 'Cases remapped',
      remappedHint: (n) => `${n} case${n === 1 ? '' : 's'} will move from source to target.`,
      descendantsTitle: 'Source descendants',
      descendantsHint: 'Child nodes under the source (kept, but parented to a deactivated node).',
      targetTitle: 'Target',
      unnamed: 'Unnamed',
    },
    inactiveTarget: 'The selected target classification is currently inactive.',
    systemSourceWarning:
      'This is a system classification. Merging deactivates it — proceed only if you are certain.',
    confirmHeading: 'Confirm merge',
    confirmPrompt: (code) => `Type the source code ${code} to confirm.`,
    confirmMismatch: 'The entered code does not match the source code.',
    cancel: 'Cancel',
    merge: 'Merge classification',
    merging: 'Merging…',
    success: (n) => `Merge complete — ${n} case${n === 1 ? '' : 's'} remapped.`,
  },
  ar: {
    title: 'دمج التصنيف',
    description:
      'نقل كل قضية مرتبطة بالتصنيف المصدر إلى تصنيف هدف، ثم تعطيل المصدر. لا يمكن التراجع عن هذا الإجراء.',
    targetLabel: 'الدمج في الهدف',
    targetPlaceholder: 'اختر تصنيفًا هدفًا',
    noTargets: 'لا توجد تصنيفات هدف مؤهلة متاحة.',
    impact: {
      heading: 'معاينة الأثر',
      remappedTitle: 'القضايا المعاد ربطها',
      remappedHint: (n) => `سيتم نقل ${n} قضية من المصدر إلى الهدف.`,
      descendantsTitle: 'العناصر التابعة للمصدر',
      descendantsHint: 'العقد الفرعية تحت المصدر (يتم الإبقاء عليها، لكنها تتبع عقدة معطّلة).',
      targetTitle: 'الهدف',
      unnamed: 'بدون اسم',
    },
    inactiveTarget: 'التصنيف الهدف المحدد غير مفعّل حاليًا.',
    systemSourceWarning: 'هذا تصنيف نظامي. الدمج يعطّله — تابع فقط إذا كنت متأكدًا.',
    confirmHeading: 'تأكيد الدمج',
    confirmPrompt: (code) => `اكتب رمز المصدر ${code} للتأكيد.`,
    confirmMismatch: 'الرمز المُدخل لا يطابق رمز المصدر.',
    cancel: 'إلغاء',
    merge: 'دمج التصنيف',
    merging: 'جارٍ الدمج…',
    success: (n) => `اكتمل الدمج — تمت إعادة ربط ${n} قضية.`,
  },
};

function useMergeLabels(): MergeLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(mergeLabels, locale), [locale]);
}

// ---------------------------------------------------------------------------

interface ClassificationMergeDialogProps {
  source: CaseClassification | null;
  flatList: CaseClassification[];
  usage?: Record<string, number>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerged?: () => void;
}

/** A candidate is a descendant of `ancestor` when its path includes the ancestor id. */
function isDescendant(candidate: CaseClassification, ancestor: CaseClassification): boolean {
  return candidate.path.includes(ancestor.id);
}

function sortClassifications(a: CaseClassification, b: CaseClassification): number {
  return a.sort - b.sort || a.code.localeCompare(b.code);
}

export function ClassificationMergeDialog({
  source,
  flatList,
  usage,
  open,
  onOpenChange,
  onMerged,
}: ClassificationMergeDialogProps) {
  const t = useMergeLabels();
  const { locale, direction } = useLocaleOrDefault();
  const qc = useQueryClient();

  const [targetId, setTargetId] = useState('');
  const [confirmCode, setConfirmCode] = useState('');

  useEffect(() => {
    if (open) {
      setTargetId('');
      setConfirmCode('');
    }
  }, [open, source?.id]);

  // Eligible targets exclude: the source itself, the source's descendants, and
  // merging a system source into a non-system target (would orphan a system
  // node into an unmanaged branch). Mirrors the cycle/descendant exclusion in
  // the form dialog's parent selector.
  const targetOptions = useMemo(() => {
    if (!source) return [];
    return [...flatList]
      .filter((candidate) => {
        if (candidate.id === source.id) return false;
        if (isDescendant(candidate, source)) return false;
        if (source.is_system && !candidate.is_system) return false;
        return true;
      })
      .sort(sortClassifications);
  }, [flatList, source]);

  const selectedTarget = useMemo(
    () => targetOptions.find((c) => c.id === targetId),
    [targetOptions, targetId],
  );

  const remappedCount = source ? usage?.[source.id] ?? 0 : 0;
  const descendantCount = useMemo(
    () =>
      source
        ? flatList.filter((c) => c.id !== source.id && isDescendant(c, source)).length
        : 0,
    [flatList, source],
  );

  const confirmMatches = source ? confirmCode.trim().toUpperCase() === source.code.trim().toUpperCase() : false;
  const canMerge = Boolean(source && selectedTarget && confirmMatches);

  const merge = useMutation({
    mutationFn: () => {
      if (!source || !selectedTarget) {
        throw new Error('Source and target are required.');
      }
      return lexAdminApi.mergeCaseClassification(source.id, selectedTarget.id);
    },
    onSuccess: async (result) => {
      showSuccess(t.success(result.reassigned));
      await qc.invalidateQueries({ queryKey: ['lex-admin-classifications'] });
      onOpenChange(false);
      onMerged?.();
    },
    onError: showApiError,
  });

  if (!source) return null;

  const targetName = selectedTarget
    ? resolveLocalized(selectedTarget.name, locale) || selectedTarget.code
    : '';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto" dir={direction}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="h-5 w-5" aria-hidden />
            {t.title}
          </DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Source → target visual */}
          <div className="flex items-center gap-3 rounded-lg border bg-muted/20 p-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-xs text-muted-foreground">{source.code}</p>
              <p className="truncate font-medium">
                {resolveLocalized(source.name, locale) || source.code}
              </p>
            </div>
            <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden />
            <div className="min-w-0 flex-1 text-end">
              {selectedTarget ? (
                <>
                  <p className="font-mono text-xs text-muted-foreground">{selectedTarget.code}</p>
                  <p className="truncate font-medium">{targetName}</p>
                </>
              ) : (
                <p className="text-muted-foreground">—</p>
              )}
            </div>
          </div>

          {/* Target picker */}
          <div className="space-y-2">
            <Label htmlFor="merge-target">{t.targetLabel}</Label>
            {targetOptions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.noTargets}</p>
            ) : (
              <Select value={targetId} onValueChange={setTargetId}>
                <SelectTrigger id="merge-target">
                  <SelectValue placeholder={t.targetPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {targetOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {`${c.path.length ? `${'--'.repeat(Math.min(c.path.length, 4))} ` : ''}${
                        resolveLocalized(c.name, locale) || c.code
                      }`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Impact preview — 3-col stat grid */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{t.impact.heading}</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border bg-card/70 p-3">
                <p className="text-2xl font-semibold tabular-nums">{remappedCount}</p>
                <p className="mt-1 text-xs font-medium">{t.impact.remappedTitle}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t.impact.remappedHint(remappedCount)}</p>
              </div>
              <div className="rounded-lg border bg-card/70 p-3">
                <p className="text-2xl font-semibold tabular-nums">{descendantCount}</p>
                <p className="mt-1 text-xs font-medium">{t.impact.descendantsTitle}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{t.impact.descendantsHint}</p>
              </div>
              <div className="rounded-lg border bg-card/70 p-3">
                <p className="truncate font-mono text-sm font-semibold">
                  {selectedTarget?.code ?? '—'}
                </p>
                <p className="mt-1 text-xs font-medium">{t.impact.targetTitle}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {selectedTarget ? targetName : t.impact.unnamed}
                </p>
              </div>
            </div>
          </div>

          {source.is_system ? (
            <Alert variant="warning">
              <ShieldAlert className="h-4 w-4" aria-hidden />
              <AlertTitle>{t.title}</AlertTitle>
              <AlertDescription>{t.systemSourceWarning}</AlertDescription>
            </Alert>
          ) : null}

          {selectedTarget && !selectedTarget.active ? (
            <Alert variant="warning">
              <AlertTriangle className="h-4 w-4" aria-hidden />
              <AlertTitle>{t.impact.targetTitle}</AlertTitle>
              <AlertDescription>{t.inactiveTarget}</AlertDescription>
            </Alert>
          ) : null}

          {/* Type-to-confirm gate */}
          <div className="space-y-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <Label htmlFor="merge-confirm" className="text-sm font-semibold">
              {t.confirmHeading}
            </Label>
            <p className="text-xs text-muted-foreground">{t.confirmPrompt(source.code)}</p>
            <Input
              id="merge-confirm"
              value={confirmCode}
              onChange={(e) => setConfirmCode(e.target.value)}
              placeholder={source.code}
              aria-invalid={Boolean(confirmCode) && !confirmMatches}
              className={confirmCode && !confirmMatches ? 'border-destructive' : undefined}
            />
            {confirmCode && !confirmMatches ? (
              <p className="text-xs text-destructive">{t.confirmMismatch}</p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={merge.isPending}>
            {t.cancel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => merge.mutate()}
            disabled={!canMerge || merge.isPending}
          >
            {merge.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden /> : null}
            {merge.isPending ? t.merging : t.merge}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
