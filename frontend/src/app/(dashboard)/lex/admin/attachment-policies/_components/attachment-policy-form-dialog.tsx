'use client';

import { CSS } from '@dnd-kit/utilities';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormProvider, useFieldArray, useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDown,
  ArrowUp,
  FileText,
  GripVertical,
  History,
  Image,
  Loader2,
  Plus,
  RotateCcw,
  Sheet,
  Trash2,
} from 'lucide-react';
import { z } from 'zod';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { FormField } from '@/components/shared/forms/form-field';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import type { AppLocale } from '@/lib/i18n';
import { resolveLocalized } from '@/lib/i18n/localized';
import { showApiError, showSuccess } from '@/lib/toast';
import { lexAdminApi, type AttachmentPolicy } from '@/lib/lex/admin';
import { cn } from '@/lib/utils';
import {
  MIME_PRESETS,
  buildRecordTimeline,
  formatBytes,
  parseFileSize,
  readSnapshots,
  writeSnapshot,
} from '../../_lib/admin-feature-utils';
import {
  useAdminCommonLabels,
  useAttachmentLabels,
  type AttachmentLabels,
} from '../../_lib/admin-labels';

const FILE_SIZE_PATTERN = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i;
const ATTACHMENT_POLICY_SNAPSHOT_NAMESPACE = 'lex-admin-attachment-policies';

interface AttachmentPolicySnapshot {
  saved_at: string;
  label: string;
  record: AttachmentPolicy;
}

const SLOT_LIBRARY = [
  {
    key: 'main_document',
    label_en: 'Main document',
    label_ar: '',
    required: true,
    allowed_content_types: MIME_PRESETS.documents.join(', '),
    icon: FileText,
  },
  {
    key: 'supporting_doc',
    label_en: 'Supporting document',
    label_ar: '',
    required: false,
    allowed_content_types: MIME_PRESETS.documents.join(', '),
    icon: FileText,
  },
  {
    key: 'spreadsheet',
    label_en: 'Spreadsheet',
    label_ar: '',
    required: false,
    allowed_content_types: MIME_PRESETS.spreadsheets.join(', '),
    icon: Sheet,
  },
  {
    key: 'evidence_image',
    label_en: 'Evidence image',
    label_ar: '',
    required: false,
    allowed_content_types: MIME_PRESETS.images.join(', '),
    icon: Image,
  },
] as const;

function parseSizeControl(value: string): number {
  const trimmed = value.trim();
  return trimmed ? parseFileSize(trimmed) : 0;
}

function buildSchema(errors: AttachmentLabels['form']['errors']) {
  return z
    .object({
      request_type: z.string().trim(),
      service_code: z.string().trim(),
      name_ar: z.string().trim(),
      name_en: z.string().trim(),
      description_ar: z.string().trim(),
      description_en: z.string().trim(),
      min_attachment_count: z.coerce.number().int().min(0),
      max_attachment_count: z.coerce.number().int().min(0),
      max_file_size: z.string().trim(),
      allowed_content_types: z.string().trim(),
      active: z.boolean(),
      slots: z.array(
        z.object({
          key: z.string().trim().min(1, errors.slotKeyRequired),
          label_ar: z.string().trim(),
          label_en: z.string().trim(),
          required: z.boolean(),
          allowed_content_types: z.string().trim(),
        }),
      ),
    })
    .refine((v) => v.name_ar.length > 0 || v.name_en.length > 0, {
      message: errors.nameRequired,
      path: ['name_en'],
    })
    .refine((v) => v.request_type.length > 0 || v.service_code.length > 0, {
      message: errors.scopeRequired,
      path: ['request_type'],
    })
    .refine((v) => v.max_attachment_count === 0 || v.min_attachment_count <= v.max_attachment_count, {
      message: 'Min attachments cannot exceed max attachments. Use max 0 for unbounded.',
      path: ['max_attachment_count'],
    })
    .refine((v) => v.min_attachment_count >= v.slots.filter((slot) => slot.required).length, {
      message: 'Min attachments must cover every required slot.',
      path: ['min_attachment_count'],
    })
    .refine(
      (v) => v.max_attachment_count === 0 || v.slots.filter((slot) => slot.required).length <= v.max_attachment_count,
      {
        message: 'Required slots cannot exceed max attachments.',
        path: ['max_attachment_count'],
      },
    )
    .refine((v) => v.max_file_size.length === 0 || FILE_SIZE_PATTERN.test(v.max_file_size), {
      message: 'Use a size like 10 MB, 512 KB, or leave blank for no cap.',
      path: ['max_file_size'],
    })
    .refine((v) => v.max_file_size.length === 0 || parseSizeControl(v.max_file_size) > 0, {
      message: 'Use a size greater than 0 or leave blank for no cap.',
      path: ['max_file_size'],
    });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

interface Props {
  policy?: AttachmentPolicy | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (policy: AttachmentPolicy) => void;
}

function defaults(policy?: AttachmentPolicy | null): FormValues {
  return {
    request_type: policy?.request_type ?? '',
    service_code: policy?.service_code ?? '',
    name_ar: policy?.name?.ar ?? '',
    name_en: policy?.name?.en ?? '',
    description_ar: policy?.description?.ar ?? '',
    description_en: policy?.description?.en ?? '',
    min_attachment_count: policy?.min_attachment_count ?? 0,
    max_attachment_count: policy?.max_attachment_count ?? 0,
    max_file_size: policy?.max_file_size_bytes ? formatBytes(policy.max_file_size_bytes) : '',
    allowed_content_types: (policy?.allowed_content_types ?? []).join(', '),
    active: policy?.active ?? true,
    slots: [...(policy?.slots ?? [])]
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .map((s) => ({
        key: s.key,
        label_ar: s.label?.ar ?? '',
        label_en: s.label?.en ?? '',
        required: s.required,
        allowed_content_types: (s.allowed_content_types ?? []).join(', '),
      })),
  };
}

function splitTypes(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatTimelineDate(value?: string): string {
  if (!value) return 'Not set';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function isAttachmentPolicySnapshot(value: unknown): value is AttachmentPolicySnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Partial<AttachmentPolicySnapshot>;
  return typeof snapshot.saved_at === 'string' && Boolean(snapshot.record?.id);
}

function makeAttachmentPolicySnapshot(record: AttachmentPolicy, locale: AppLocale): AttachmentPolicySnapshot {
  return {
    saved_at: new Date().toISOString(),
    label:
      resolveLocalized(record.name, locale) ||
      record.service_code ||
      record.request_type ||
      record.id.slice(0, 8),
    record,
  };
}

function readAttachmentPolicySnapshots(id: string): AttachmentPolicySnapshot[] {
  return readSnapshots<AttachmentPolicySnapshot>(ATTACHMENT_POLICY_SNAPSHOT_NAMESPACE, id).filter(
    isAttachmentPolicySnapshot,
  );
}

function SortableSlot({
  children,
  id,
}: {
  children: (attributes: ReturnType<typeof useSortable>['attributes'], listeners: ReturnType<typeof useSortable>['listeners']) => ReactNode;
  id: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'relative z-10 opacity-80')}
    >
      {children(attributes, listeners)}
    </div>
  );
}

export function AttachmentPolicyFormDialog({ policy, open, onOpenChange, onSaved }: Props) {
  const isEdit = Boolean(policy);
  const qc = useQueryClient();
  const t = useAttachmentLabels();
  const common = useAdminCommonLabels();
  const { locale } = useLocaleOrDefault();
  const schema = useMemo(() => buildSchema(t.form.errors), [t.form.errors]);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults(policy) });
  const slots = useFieldArray({ control: form.control, name: 'slots' });
  const [snapshots, setSnapshots] = useState<AttachmentPolicySnapshot[]>([]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    if (open) form.reset(defaults(policy));
  }, [policy, form, open]);

  useEffect(() => {
    if (open && isEdit && policy?.id) {
      setSnapshots(readAttachmentPolicySnapshots(policy.id));
    } else {
      setSnapshots([]);
    }
  }, [isEdit, open, policy?.id]);

  const slotValues = form.watch('slots');
  const requiredSlotCount = slotValues.filter((slot) => slot.required).length;
  const minCount = form.watch('min_attachment_count');
  const maxCount = form.watch('max_attachment_count');
  const maxSizeBytes = parseSizeControl(form.watch('max_file_size'));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = slots.fields.findIndex((field) => field.id === active.id);
    const newIndex = slots.fields.findIndex((field) => field.id === over.id);
    if (oldIndex >= 0 && newIndex >= 0) slots.move(oldIndex, newIndex);
  };

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const allowed = splitTypes(v.allowed_content_types);
      const payload = {
        request_type: v.request_type,
        service_code: v.service_code,
        name: { ar: v.name_ar, en: v.name_en },
        description: { ar: v.description_ar, en: v.description_en },
        min_attachment_count: v.min_attachment_count,
        max_attachment_count: v.max_attachment_count,
        max_file_size_bytes: parseSizeControl(v.max_file_size),
        allowed_content_types: allowed,
        active: v.active,
        slots: v.slots.map((s, i) => ({
          key: s.key,
          label: { ar: s.label_ar, en: s.label_en },
          required: s.required,
          sort_order: i,
          allowed_content_types: splitTypes(s.allowed_content_types),
        })),
      };
      return isEdit && policy
        ? lexAdminApi.updateAttachmentPolicy(policy.id, payload)
        : lexAdminApi.createAttachmentPolicy(payload);
    },
    onSuccess: async (saved) => {
      if (isEdit && policy) {
        writeSnapshot<AttachmentPolicySnapshot>(
          ATTACHMENT_POLICY_SNAPSHOT_NAMESPACE,
          policy.id,
          makeAttachmentPolicySnapshot(policy, locale),
        );
        setSnapshots(readAttachmentPolicySnapshots(policy.id));
      }
      showSuccess(isEdit ? common.toast.updated : common.toast.created);
      await qc.invalidateQueries({ queryKey: ['lex-admin-attachment-policies'] });
      onOpenChange(false);
      onSaved?.(saved);
    },
    onError: showApiError,
  });
  const timeline = useMemo(() => (isEdit && policy ? buildRecordTimeline(policy) : []), [isEdit, policy]);

  const restoreSnapshot = (snapshot: AttachmentPolicySnapshot) => {
    form.reset(defaults(snapshot.record));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? t.form.editTitle : t.form.createTitle}</DialogTitle>
          <DialogDescription>{t.form.appliesHint}</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="space-y-5" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
            {!isEdit ? <LexCreationGuidance workflow="policy" /> : null}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="request_type" label={t.form.requestType}>
                <Input id="request_type" {...form.register('request_type')} placeholder={t.form.requestTypePlaceholder} />
              </FormField>
              <FormField name="service_code" label={t.form.serviceCode}>
                <Input id="service_code" {...form.register('service_code')} placeholder={t.form.serviceCodePlaceholder} />
              </FormField>
              <FormField name="name_en" label={common.nameEn}>
                <Input id="name_en" {...form.register('name_en')} />
              </FormField>
              <FormField name="name_ar" label={common.nameAr}>
                <Input id="name_ar" dir="rtl" {...form.register('name_ar')} />
              </FormField>
              <FormField name="description_en" label={common.descriptionEn}>
                <Input id="description_en" {...form.register('description_en')} />
              </FormField>
              <FormField name="description_ar" label={common.descriptionAr}>
                <Input id="description_ar" dir="rtl" {...form.register('description_ar')} />
              </FormField>
              <FormField name="min_attachment_count" label={t.form.minCount}>
                <Input id="min_attachment_count" type="number" min={0} {...form.register('min_attachment_count')} />
              </FormField>
              <FormField name="max_attachment_count" label={t.form.maxCount}>
                <Input id="max_attachment_count" type="number" min={0} {...form.register('max_attachment_count')} />
              </FormField>
              <FormField name="max_file_size" label={t.form.maxFileSize}>
                <Input id="max_file_size" {...form.register('max_file_size')} placeholder={t.form.maxFileSizePlaceholder} />
              </FormField>
              <FormField name="allowed_content_types" label={t.form.allowedTypes}>
                <Input
                  id="allowed_content_types"
                  {...form.register('allowed_content_types')}
                  placeholder={t.form.allowedTypesPlaceholder}
                />
              </FormField>
            </div>

            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t.form.consistency.title}</span>
                <span className="text-muted-foreground">
                  {t.form.consistency.summary(
                    requiredSlotCount,
                    minCount || 0,
                    maxCount ? String(maxCount) : t.form.consistency.unbounded,
                  )}
                </span>
                {maxSizeBytes > 0 ? (
                  <span className="text-muted-foreground">
                    {t.form.consistency.maxFileSize(formatBytes(maxSizeBytes))}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch id="active" checked={form.watch('active')} onCheckedChange={(c) => form.setValue('active', c)} />
              <Label htmlFor="active">{t.form.active}</Label>
            </div>

            <div className="space-y-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">{t.form.slotsTitle}</p>
                  <p className="text-xs text-muted-foreground">{t.form.slotsHint}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => slots.append({ key: '', label_ar: '', label_en: '', required: false, allowed_content_types: '' })}
                >
                  <Plus className="me-1.5 h-3.5 w-3.5" />
                  {t.form.addSlot}
                </Button>
              </div>

              <div className="flex flex-wrap gap-2">
                {SLOT_LIBRARY.map((preset) => {
                  const Icon = preset.icon;
                  return (
                    <Button
                      key={preset.key}
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() =>
                        slots.append({
                          key: preset.key,
                          label_ar: preset.label_ar,
                          label_en: preset.label_en,
                          required: preset.required,
                          allowed_content_types: preset.allowed_content_types,
                        })
                      }
                    >
                      <Icon className="me-1.5 h-3.5 w-3.5" />
                      {preset.label_en}
                    </Button>
                  );
                })}
              </div>

              <div className="flex flex-wrap gap-2">
                {Object.entries(MIME_PRESETS).map(([key, values]) => (
                  <Button
                    key={key}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => form.setValue('allowed_content_types', values.join(', '), { shouldValidate: true })}
                  >
                    {key}
                  </Button>
                ))}
              </div>

              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={slots.fields.map((field) => field.id)} strategy={verticalListSortingStrategy}>
                  <div className="space-y-3">
                    {slots.fields.map((field, index) => (
                      <SortableSlot key={field.id} id={field.id}>
                        {(attributes, listeners) => (
                          <div className="space-y-3 rounded-md border bg-muted/30 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0 cursor-grab"
                                aria-label={t.form.slotReorder}
                                {...attributes}
                                {...listeners}
                              >
                                <GripVertical className="h-4 w-4" />
                              </Button>
                              <div className="ms-auto flex items-center gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  aria-label={t.form.slotMoveUp}
                                  disabled={index === 0}
                                  onClick={() => slots.move(index, index - 1)}
                                >
                                  <ArrowUp className="h-4 w-4" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  aria-label={t.form.slotMoveDown}
                                  disabled={index === slots.fields.length - 1}
                                  onClick={() => slots.move(index, index + 1)}
                                >
                                  <ArrowDown className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                              <FormField name={`slots.${index}.key`} label={t.form.slotKey} required>
                                <Input {...form.register(`slots.${index}.key`)} placeholder={t.form.slotKeyPlaceholder} />
                              </FormField>
                              <FormField name={`slots.${index}.label_en`} label={t.form.slotLabelEn}>
                                <Input {...form.register(`slots.${index}.label_en`)} />
                              </FormField>
                              <FormField name={`slots.${index}.label_ar`} label={t.form.slotLabelAr}>
                                <Input dir="rtl" {...form.register(`slots.${index}.label_ar`)} />
                              </FormField>
                            </div>
                            <FormField name={`slots.${index}.allowed_content_types`} label={t.form.slotMimeTypes}>
                              <Input
                                {...form.register(`slots.${index}.allowed_content_types`)}
                                placeholder={t.form.slotMimePlaceholder}
                              />
                            </FormField>
                            <div className="flex flex-wrap gap-2">
                              {Object.entries(MIME_PRESETS).map(([key, values]) => (
                                <Button
                                  key={key}
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    form.setValue(`slots.${index}.allowed_content_types`, values.join(', '), {
                                      shouldValidate: true,
                                    })
                                  }
                                >
                                  {key}
                                </Button>
                              ))}
                            </div>
                            <div className="flex items-center justify-between">
                              <label className="flex items-center gap-2 text-sm">
                                <Checkbox
                                  checked={form.watch(`slots.${index}.required`)}
                                  onCheckedChange={(c) => form.setValue(`slots.${index}.required`, c === true, { shouldValidate: true })}
                                />
                                {t.form.slotRequired}
                              </label>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => slots.remove(index)}
                              >
                                <Trash2 className="me-1.5 h-3.5 w-3.5 text-destructive" />
                                {common.remove}
                              </Button>
                            </div>
                          </div>
                        )}
                      </SortableSlot>
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>

            {isEdit && policy ? (
              <div className="grid gap-4 rounded-lg border p-4 md:grid-cols-2">
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <History className="h-4 w-4 text-primary" />
                    <p className="text-sm font-medium">{common.recordPanel.timeline}</p>
                  </div>
                  {timeline.length > 0 ? (
                    <div className="space-y-2">
                      {timeline.map((event) => (
                        <div key={event.id} className="rounded-md border bg-muted/20 px-3 py-2">
                          <p className="text-sm font-medium">{event.label}</p>
                          <p className="text-xs text-muted-foreground">{formatTimelineDate(event.at)}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">{common.recordPanel.noServerTimestamps}</p>
                  )}
                </div>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <RotateCcw className="h-4 w-4 text-primary" />
                    <p className="text-sm font-medium">{common.recordPanel.localVersions}</p>
                  </div>
                  {snapshots.length > 0 ? (
                    <div className="space-y-2">
                      {snapshots.map((snapshot) => (
                        <div
                          key={`${snapshot.saved_at}:${snapshot.record.id}`}
                          className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{snapshot.label}</p>
                            <p className="text-xs text-muted-foreground">{formatTimelineDate(snapshot.saved_at)}</p>
                          </div>
                          <Button type="button" variant="outline" size="sm" onClick={() => restoreSnapshot(snapshot)}>
                            <RotateCcw className="me-1.5 h-3.5 w-3.5" />
                            {common.recordPanel.restore}
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">{common.recordPanel.noLocalVersions}</p>
                  )}
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
  );
}
