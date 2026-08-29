'use client';

import { useEffect, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormProvider, useForm } from 'react-hook-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormField } from '@/components/shared/forms/form-field';
import { AsyncRecordPicker } from '@/components/shared/forms/async-record-picker';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { showApiError, showSuccess } from '@/lib/toast';
import {
  ORG_ENTITY_TYPES,
  lexAdminApi,
  type OrgEntity,
  type OrgEntityType,
} from '@/lib/lex/admin';
import { useAdminCommonLabels, useOrgLabels, type OrgLabels } from '../../_lib/admin-labels';
import OrgMetadataEditor from './org-metadata/org-metadata-editor';
import { fetchPlatformOrgUnits, platformUnitName } from '../_lib/platform-sync-api';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function buildSchema(errors: OrgLabels['form']['errors']) {
  return z
    .object({
      code: z.string().trim().min(1, errors.codeRequired),
      entity_type: z.enum(ORG_ENTITY_TYPES as unknown as [OrgEntityType, ...OrgEntityType[]]),
      parent_id: z.string().trim(),
      platform_org_unit_id: z.string().trim(),
      name_ar: z.string().trim(),
      name_en: z.string().trim(),
      active: z.boolean(),
    })
    .refine((v) => v.name_ar.length > 0 || v.name_en.length > 0, {
      message: errors.nameRequired,
      path: ['name_en'],
    })
    .refine((v) => v.platform_org_unit_id.length === 0 || UUID_PATTERN.test(v.platform_org_unit_id), {
      message: errors.platformUnitInvalid,
      path: ['platform_org_unit_id'],
    });
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>;

interface Props {
  entity?: OrgEntity | null;
  parents?: OrgEntity[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (entity: OrgEntity) => void;
}

function defaults(entity?: OrgEntity | null): FormValues {
  return {
    code: entity?.code ?? '',
    entity_type: entity?.entity_type ?? 'department',
    parent_id: entity?.parent_id ?? '',
    platform_org_unit_id: entity?.platform_org_unit_id ?? '',
    name_ar: entity?.name?.ar ?? '',
    name_en: entity?.name?.en ?? '',
    active: entity?.active ?? true,
  };
}

const NONE = '__none__';

export function OrgEntityFormDialog({ entity, parents = [], open, onOpenChange, onSaved }: Props) {
  const isEdit = Boolean(entity);
  const qc = useQueryClient();
  const { locale } = useLocaleOrDefault();
  const t = useOrgLabels();
  const common = useAdminCommonLabels();
  const schema = useMemo(() => buildSchema(t.form.errors), [t.form.errors]);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: defaults(entity) });
  const [metadata, setMetadata] = useState<Record<string, unknown>>(entity?.metadata ?? {});

  useEffect(() => {
    if (open) {
      form.reset(defaults(entity));
      setMetadata(entity?.metadata ?? {});
    }
  }, [entity, form, open]);

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const payload = {
        entity_type: v.entity_type,
        name: { ar: v.name_ar, en: v.name_en },
        parent_id: v.parent_id ? v.parent_id : null,
        platform_org_unit_id: v.platform_org_unit_id ? v.platform_org_unit_id : null,
        active: v.active,
        metadata,
      };
      return isEdit && entity
        ? lexAdminApi.updateOrgEntity(entity.id, payload)
        : lexAdminApi.createOrgEntity({ code: v.code, ...payload });
    },
    onSuccess: async (saved) => {
      showSuccess(isEdit ? common.toast.updated : common.toast.created);
      await qc.invalidateQueries({ queryKey: ['lex-admin-org-entities'] });
      onOpenChange(false);
      onSaved?.(saved);
    },
    onError: showApiError,
  });

  const entityType = form.watch('entity_type');
  const parentValue = form.watch('parent_id');
  const platformUnitValue = form.watch('platform_org_unit_id');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? t.form.editTitle : t.form.createTitle}</DialogTitle>
          <DialogDescription>{t.pageDescription}</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="space-y-5" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
            {!isEdit ? <LexCreationGuidance workflow="organization" /> : null}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="code" label={t.form.code} required>
                <Input id="code" {...form.register('code')} placeholder={t.form.codePlaceholder} disabled={isEdit} />
              </FormField>
              <FormField name="entity_type" label={t.form.entityType} required>
                <Select
                  value={entityType}
                  onValueChange={(v) =>
                    form.setValue('entity_type', v as OrgEntityType, { shouldValidate: true })
                  }
                >
                  <SelectTrigger id="entity_type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ORG_ENTITY_TYPES.map((et) => (
                      <SelectItem key={et} value={et}>
                        {t.entityTypes[et]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField name="name_en" label={common.nameEn}>
                <Input id="name_en" {...form.register('name_en')} />
              </FormField>
              <FormField name="name_ar" label={common.nameAr}>
                <Input id="name_ar" dir="rtl" {...form.register('name_ar')} />
              </FormField>
              <FormField name="parent_id" label={t.form.parent}>
                <Select
                  value={parentValue ? parentValue : NONE}
                  onValueChange={(v) => form.setValue('parent_id', v === NONE ? '' : v)}
                >
                  <SelectTrigger id="parent_id">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>{t.form.parentNone}</SelectItem>
                    {parents
                      .filter((p) => p.id !== entity?.id)
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.code}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField name="platform_org_unit_id" label={t.form.platformLink}>
                <AsyncRecordPicker
                  id="platform_org_unit_id"
                  ariaLabel={t.form.platformLink}
                  queryKey={['lex-platform-org-unit-picker', locale]}
                  loadOptions={async (search) => {
                    const units = await fetchPlatformOrgUnits();
                    const term = search.toLocaleLowerCase();
                    return units
                      .filter((unit) => unit.active)
                      .filter((unit) => {
                        const name = platformUnitName(unit, locale);
                        return !term || name.toLocaleLowerCase().includes(term) || unit.code?.toLocaleLowerCase().includes(term);
                      })
                      .map((unit) => ({
                        value: unit.id,
                        label: platformUnitName(unit, locale) || unit.code || unit.id,
                        description: unit.code,
                      }));
                  }}
                  value={platformUnitValue}
                  onChange={(value) => form.setValue('platform_org_unit_id', value, { shouldDirty: true, shouldValidate: true })}
                  enabled={open}
                  disabled={save.isPending}
                  allowClear
                  labels={{
                    select: t.form.platformLinkPlaceholder,
                    search: t.form.platformLinkPlaceholder,
                  }}
                />
              </FormField>
            </div>

            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <p className="font-medium">{t.form.platformSyncTitle}</p>
              <p className="mt-1 text-muted-foreground">{t.form.platformSyncDescription}</p>
            </div>

            <div className="space-y-3 rounded-md border bg-muted/10 p-3">
              <OrgMetadataEditor value={metadata} onChange={setMetadata} disabled={save.isPending} />
            </div>

            <div className="flex items-center gap-2">
              <Switch id="active" checked={form.watch('active')} onCheckedChange={(c) => form.setValue('active', c)} />
              <Label htmlFor="active">{t.form.active}</Label>
            </div>

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
