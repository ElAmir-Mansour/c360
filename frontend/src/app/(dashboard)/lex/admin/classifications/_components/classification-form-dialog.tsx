'use client';

import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormProvider, useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, History, Loader2, RotateCcw } from 'lucide-react';
import { z } from 'zod';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LexCreationGuidance } from '@/components/lex/creation-guidance';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormField } from '@/components/shared/forms/form-field';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { showApiError, showSuccess } from '@/lib/toast';
import { lexAdminApi, type CaseClassification } from '@/lib/lex/admin';
import { resolveLexBilingual, type LexBilingual } from '../../../_lib/lex-i18n';
import { buildRecordTimeline, readSnapshots, writeSnapshot } from '../../_lib/admin-feature-utils';
import {
  useAdminCommonLabels,
  useClassificationLabels,
  type ClassificationLabels,
} from '../../_lib/admin-labels';
import {
  appearanceMetadata,
  readAppearance,
  restorePayloadFromSnapshot,
  type ClassificationAppearance,
} from '../../_lib/classification-helpers';
import { ClassificationAppearancePicker } from './classification-appearance-picker';

function buildSchema(errors: ClassificationLabels['form']['errors']) {
  return z
    .object({
      code: z.string().trim().min(1, errors.codeRequired),
      parent_id: z.string().trim(),
      name_ar: z.string().trim(),
      name_en: z.string().trim(),
      sort: z.coerce.number().int().min(0),
      active: z.boolean(),
    })
    .refine((v) => v.name_ar.length > 0 || v.name_en.length > 0, {
      message: errors.nameRequired,
      path: ['name_en'],
    });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;
type ClassificationSnapshot = CaseClassification & { snapshot_at?: string; snapshot_reason?: string };

/**
 * Restore-flow strings live with this component (per the component-i18n rule):
 * admin-labels is owned elsewhere and does not carry the snapshot device-bound
 * notice or the restore-confirmation copy that this dialog needs.
 */
interface RestoreLabels {
  snapshotNotice: string;
  confirmTitle: string;
  confirmDescription: (code: string) => string;
  confirmDeviceNote: string;
  confirmAction: string;
  restored: string;
}

const restoreLabels: LexBilingual<RestoreLabels> = {
  en: {
    snapshotNotice: 'Snapshots are stored locally on this device only — they are not shared across browsers or users.',
    confirmTitle: 'Restore this snapshot?',
    confirmDescription: (code) =>
      `This will overwrite the live "${code}" classification with the values from the selected local snapshot.`,
    confirmDeviceNote: 'The snapshot is device-bound; restoring submits its code, names, parent, sort order, and status as a regular update.',
    confirmAction: 'Restore',
    restored: 'Classification restored from local snapshot.',
  },
  ar: {
    snapshotNotice: 'تُحفظ النسخ محليًا على هذا الجهاز فقط — ولا تتم مشاركتها بين المتصفحات أو المستخدمين.',
    confirmTitle: 'استعادة هذه النسخة؟',
    confirmDescription: (code) =>
      `سيؤدي ذلك إلى استبدال التصنيف المباشر "${code}" بالقيم من النسخة المحلية المحددة.`,
    confirmDeviceNote: 'النسخة مرتبطة بالجهاز؛ وتؤدي الاستعادة إلى إرسال رمزها وأسمائها وأبها وترتيبها وحالتها كتحديث عادي.',
    confirmAction: 'استعادة',
    restored: 'تمت استعادة التصنيف من نسخة محلية.',
  },
};

interface Props {
  classification?: CaseClassification | null;
  /** When set (and no classification), pre-selects this parent for an add-child. */
  defaultParentId?: string | null;
  flatList: CaseClassification[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (c: CaseClassification) => void;
}

const NONE = '__none__';
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

function defaults(classification?: CaseClassification | null, defaultParentId?: string | null): FormValues {
  return {
    code: classification?.code ?? '',
    parent_id: classification?.parent_id ?? defaultParentId ?? '',
    name_ar: classification?.name?.ar ?? '',
    name_en: classification?.name?.en ?? '',
    sort: classification?.sort ?? 0,
    active: classification?.active ?? true,
  };
}

function isDescendant(candidate: CaseClassification, parent: CaseClassification): boolean {
  return candidate.path.includes(parent.id);
}

function sortClassifications(a: CaseClassification, b: CaseClassification): number {
  return a.sort - b.sort || a.code.localeCompare(b.code);
}

function formatDate(value: string | undefined, locale: string, unknownLabel: string): string {
  if (!value) return unknownLabel;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export function ClassificationFormDialog({
  classification,
  defaultParentId,
  flatList,
  open,
  onOpenChange,
  onSaved,
}: Props) {
  const isEdit = Boolean(classification);
  const qc = useQueryClient();
  const { locale } = useLocaleOrDefault();
  const t = useClassificationLabels();
  const common = useAdminCommonLabels();
  const restoreT = useMemo(() => resolveLexBilingual(restoreLabels, locale), [locale]);
  const [pendingSnapshot, setPendingSnapshot] = useState<ClassificationSnapshot | null>(null);
  const schema = useMemo(() => buildSchema(t.form.errors), [t.form.errors]);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults(classification, defaultParentId),
  });
  const [appearance, setAppearance] = useState<ClassificationAppearance>(() =>
    classification ? readAppearance(classification) : {},
  );

  useEffect(() => {
    if (open) {
      form.reset(defaults(classification, defaultParentId));
      setAppearance(classification ? readAppearance(classification) : {});
    }
  }, [classification, defaultParentId, form, open]);

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const nextParentId = v.parent_id ? v.parent_id : null;
      const payload: {
        name: { ar: string; en: string };
        parent_id?: string | null;
        sort: number;
        active: boolean;
        metadata?: Record<string, unknown>;
      } = {
        name: { ar: v.name_ar, en: v.name_en },
        sort: v.sort,
        active: v.active,
      };

      const nextMetadata = appearanceMetadata(classification?.metadata ?? {}, appearance);
      if (Object.keys(nextMetadata).length > 0 || (classification && Object.keys(classification.metadata ?? {}).length > 0)) {
        payload.metadata = nextMetadata;
      }

      if (isEdit && classification) {
        if ((classification.parent_id ?? null) !== nextParentId) {
          payload.parent_id = nextParentId ?? ZERO_UUID;
        }
        try {
          writeSnapshot('case-classifications', classification.id, {
            ...classification,
            snapshot_at: new Date().toISOString(),
            snapshot_reason: 'before_update',
          });
        } catch {
          // Snapshot history is a local convenience and should not block saving.
        }
        return lexAdminApi.updateCaseClassification(classification.id, payload);
      }

      return lexAdminApi.createCaseClassification({ code: v.code, parent_id: nextParentId, ...payload });
    },
    onSuccess: async (saved) => {
      showSuccess(isEdit ? common.toast.updated : common.toast.created);
      await qc.invalidateQueries({ queryKey: ['lex-admin-classifications'] });
      onOpenChange(false);
      onSaved?.(saved);
    },
    onError: showApiError,
  });

  const restore = useMutation({
    mutationFn: (snapshot: ClassificationSnapshot) => {
      if (!classification) throw new Error('No classification to restore.');
      // Tag the change as a restore. The update payload has no change_reason
      // field, so we record the intent in the local snapshot ledger (mirroring
      // the before_update snapshot written on a normal save).
      try {
        writeSnapshot('case-classifications', classification.id, {
          ...classification,
          snapshot_at: new Date().toISOString(),
          snapshot_reason: 'restored',
        });
      } catch {
        // Snapshot history is a local convenience and should not block restoring.
      }
      return lexAdminApi.updateCaseClassification(
        classification.id,
        restorePayloadFromSnapshot({ ...snapshot }),
      );
    },
    onSuccess: async (saved) => {
      showSuccess(restoreT.restored);
      await qc.invalidateQueries({ queryKey: ['lex-admin-classifications'] });
      setPendingSnapshot(null);
      onOpenChange(false);
      onSaved?.(saved);
    },
    onError: showApiError,
  });

  const parentValue = form.watch('parent_id');
  const sortValue = Number(form.watch('sort'));
  const codeValue = form.watch('code').trim().toUpperCase();
  const descendantCount = classification
    ? flatList.filter((candidate) => candidate.id !== classification.id && isDescendant(candidate, classification)).length
    : 0;
  const duplicateCode = !isEdit && codeValue
    ? flatList.some((candidate) => candidate.code.trim().toUpperCase() === codeValue)
    : false;
  const parentChanged = isEdit && classification ? (classification.parent_id ?? '') !== parentValue : false;
  const selectedParent = parentValue ? flatList.find((candidate) => candidate.id === parentValue) : undefined;
  const sortConflicts = Number.isFinite(sortValue)
    ? flatList.filter(
        (candidate) =>
          candidate.id !== classification?.id &&
          (candidate.parent_id ?? '') === (parentValue || '') &&
          candidate.sort === sortValue,
      )
    : [];
  const parentOptions = useMemo(
    () =>
      [...flatList]
        .filter((candidate) => {
          if (candidate.id === classification?.id) return false;
          if (classification && isDescendant(candidate, classification)) return false;
          return candidate.active || candidate.id === classification?.parent_id;
        })
        .sort(sortClassifications),
    [classification, flatList],
  );
  const timeline = useMemo(() => (classification ? buildRecordTimeline(classification) : []), [classification]);
  const snapshots = useMemo(
    () =>
      open && classification
        ? readSnapshots<ClassificationSnapshot>('case-classifications', classification.id)
        : [],
    [classification, open],
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? t.form.editTitle : t.form.createTitle}</DialogTitle>
          <DialogDescription>{t.pageDescription}</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="space-y-5" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
            {!isEdit ? <LexCreationGuidance workflow="classification" /> : null}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="code" label={t.form.code} required>
                <Input id="code" {...form.register('code')} placeholder={t.form.codePlaceholder} disabled={isEdit} />
              </FormField>
              <FormField name="sort" label={t.form.sort}>
                <Input id="sort" type="number" min={0} {...form.register('sort')} />
              </FormField>
              <FormField name="name_en" label={common.nameEn}>
                <Input id="name_en" {...form.register('name_en')} />
              </FormField>
              <FormField name="name_ar" label={common.nameAr}>
                <Input id="name_ar" dir="rtl" {...form.register('name_ar')} />
              </FormField>
              <FormField name="parent_id" label={t.form.parent} className="md:col-span-2">
                <Select
                  value={parentValue ? parentValue : NONE}
                  onValueChange={(v) => form.setValue('parent_id', v === NONE ? '' : v, { shouldDirty: true })}
                  disabled={classification?.is_system}
                >
                  <SelectTrigger id="parent_id">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t.form.parentNone}</SelectItem>
                    {parentOptions.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {`${c.path.length ? `${'--'.repeat(Math.min(c.path.length, 4))} ` : ''}${
                            resolveLocalized(c.name, locale) || c.code
                          }${!c.active ? ` (${common.inactive})` : ''}`}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </FormField>
            </div>

            {classification?.is_system ? (
              <Alert>
                <AlertTitle>{t.form.systemParentLockedTitle}</AlertTitle>
                <AlertDescription>{t.form.systemParentLocked}</AlertDescription>
              </Alert>
            ) : null}

            {duplicateCode ? (
              <Alert variant="warning">
                <AlertTriangle className="h-4 w-4" aria-hidden />
                <AlertTitle>{t.form.duplicateCodeTitle}</AlertTitle>
                <AlertDescription>{t.form.duplicateCode}</AlertDescription>
              </Alert>
            ) : null}

            {sortConflicts.length > 0 ? (
              <Alert variant="warning">
                <AlertTriangle className="h-4 w-4" aria-hidden />
                <AlertTitle>{t.form.sortConflictTitle}</AlertTitle>
                <AlertDescription>
                  {t.form.sortConflict(sortValue, sortConflicts.map((item) => item.code).join(', '))}
                </AlertDescription>
              </Alert>
            ) : null}

            {parentChanged ? (
              <Alert variant="warning">
                <AlertTriangle className="h-4 w-4" aria-hidden />
                <AlertTitle>{t.form.moveImpactTitle}</AlertTitle>
                <AlertDescription>
                  {t.form.moveImpact(descendantCount)}
                  {selectedParent && !selectedParent.active ? ` ${t.form.moveImpactInactiveParent}` : ''}
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-2">
              <Label>{t.form.appearance}</Label>
              <ClassificationAppearancePicker
                value={appearance}
                onChange={setAppearance}
                disabled={classification?.is_system}
              />
            </div>

            <div className="flex items-center gap-2">
              <Switch id="active" checked={form.watch('active')} onCheckedChange={(c) => form.setValue('active', c)} />
              <Label htmlFor="active">{t.form.active}</Label>
            </div>

            {isEdit && classification ? (
              <div className="rounded-lg border bg-muted/20 p-3">
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4 text-muted-foreground" aria-hidden />
                  <h3 className="text-sm font-semibold">{t.form.timelineTitle}</h3>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    {timeline.length ? (
                      timeline.map((event) => (
                        <div key={event.id} className="rounded-md border bg-card/70 p-2">
                          <p className="text-sm font-medium">{event.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatDate(event.at, locale, t.form.unknownDate)}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">{t.form.noTimeline}</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">{restoreT.snapshotNotice}</p>
                    {snapshots.length ? (
                      snapshots.slice(0, 3).map((snapshot, index) => (
                        <div key={`${snapshot.id}-${snapshot.snapshot_at ?? index}`} className="rounded-md border bg-card/70 p-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{snapshot.code}</Badge>
                            <span className="text-xs text-muted-foreground">
                              {formatDate(snapshot.snapshot_at ?? snapshot.updated_at, locale, t.form.unknownDate)}
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="ms-auto h-7 px-2"
                              disabled={restore.isPending}
                              onClick={() => setPendingSnapshot(snapshot)}
                            >
                              {restore.isPending && restore.variables === snapshot ? (
                                <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                              ) : (
                                <RotateCcw className="me-1.5 h-3.5 w-3.5" aria-hidden />
                              )}
                              {t.form.restore}
                            </Button>
                          </div>
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            {resolveLocalized(snapshot.name, locale) || snapshot.code}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">{t.form.noSnapshots}</p>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {common.cancel}
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                {isEdit ? common.save : common.create}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>

      <ConfirmDialog
        open={pendingSnapshot != null}
        onOpenChange={(o) => {
          if (!o) setPendingSnapshot(null);
        }}
        title={restoreT.confirmTitle}
        description={
          pendingSnapshot
            ? `${restoreT.confirmDescription(pendingSnapshot.code)} ${restoreT.confirmDeviceNote}`
            : restoreT.confirmDeviceNote
        }
        confirmLabel={restoreT.confirmAction}
        cancelLabel={common.cancel}
        loading={restore.isPending}
        onConfirm={async () => {
          if (pendingSnapshot) {
            await restore.mutateAsync(pendingSnapshot);
          }
        }}
      />
    </>
  );
}
