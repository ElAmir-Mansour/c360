'use client';

import { useEffect, useMemo } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormProvider, useForm } from 'react-hook-form';
import { Loader2 } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { LexCreationGuidance } from '@/components/lex/creation-guidance';
import { Checkbox } from '@/components/ui/checkbox';
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
import { FormField } from '@/components/shared/forms/form-field';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { showApiError, showSuccess } from '@/lib/toast';
import { casesApi, type CaseClassification } from '@/lib/lex/cases';
import { useCaseLabels } from '../../_components/labels';

function buildSchema(codeRequired: string, nameRequired: string) {
  return z
    .object({
      code: z.string().trim().min(1, codeRequired),
      name_ar: z.string().trim().optional().default(''),
      name_en: z.string().trim().optional().default(''),
      parent_id: z.string().optional().default(''),
      active: z.boolean().default(true),
      sort: z.coerce.number().int().min(0).default(0),
    })
    .refine((v) => v.name_ar.length > 0 || v.name_en.length > 0, {
      path: ['name_ar'],
      message: nameRequired,
    });
}
type FormValues = z.infer<ReturnType<typeof buildSchema>>;

interface Props {
  classification?: CaseClassification | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

/** Flatten the tree into a flat list of {id, depth, label} for the parent select. */
function flattenForSelect(
  nodes: CaseClassification[],
  locale: 'ar' | 'en',
  depth = 0,
  acc: { id: string; label: string }[] = [],
): { id: string; label: string }[] {
  for (const node of nodes) {
    acc.push({
      id: node.id,
      label: `${'— '.repeat(depth)}${node.code} (${resolveLocalized(node.name, locale)})`,
    });
    flattenForSelect(node.children ?? [], locale, depth + 1, acc);
  }
  return acc;
}

export function ClassificationFormDialog({ classification, open, onOpenChange, onSaved }: Props) {
  const isEdit = Boolean(classification);
  const queryClient = useQueryClient();
  const labels = useCaseLabels();
  const t = labels.classification.form;
  const { locale } = useLocaleOrDefault();

  const treeQuery = useQuery({
    queryKey: ['lex-case-classifications', 'tree'],
    queryFn: () => casesApi.getClassificationTree(),
    enabled: open,
  });

  const parentOptions = useMemo(
    () => flattenForSelect(treeQuery.data ?? [], locale).filter((o) => o.id !== classification?.id),
    [treeQuery.data, locale, classification?.id],
  );

  const schema = useMemo(
    () => buildSchema(t.errors.codeRequired, t.errors.nameRequired),
    [t.errors.codeRequired, t.errors.nameRequired],
  );
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: buildDefaults(classification),
  });

  useEffect(() => {
    if (open) form.reset(buildDefaults(classification));
  }, [classification, form, open]);

  const save = useMutation({
    mutationFn: (values: FormValues) => {
      const payload = {
        code: values.code,
        name: { ar: values.name_ar || values.name_en, en: values.name_en || values.name_ar },
        parent_id: values.parent_id || null,
        active: values.active,
        sort: values.sort,
      };
      if (isEdit && classification) {
        return casesApi.updateClassification(classification.id, payload);
      }
      return casesApi.createClassification(payload);
    },
    onSuccess: async () => {
      showSuccess(isEdit ? labels.toast.classificationUpdated : labels.toast.classificationCreated);
      await queryClient.invalidateQueries({ queryKey: ['lex-case-classifications'] });
      onOpenChange(false);
      onSaved?.();
    },
    onError: showApiError,
  });

  const parentValue = form.watch('parent_id');
  const activeValue = form.watch('active');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? t.editTitle : t.addTitle}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
          <form className="space-y-4" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
            {!isEdit ? <LexCreationGuidance workflow="classification" /> : null}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField name="code" label={t.code} required>
                <Input id="code" {...form.register('code')} placeholder={t.codePlaceholder} />
              </FormField>
              <FormField name="sort" label={t.sort}>
                <Input id="sort" type="number" {...form.register('sort')} />
              </FormField>
              <FormField name="name_ar" label={t.nameAr} required>
                <Input id="name_ar" dir="rtl" {...form.register('name_ar')} placeholder={t.nameArPlaceholder} />
              </FormField>
              <FormField name="name_en" label={t.nameEn}>
                <Input id="name_en" dir="ltr" {...form.register('name_en')} placeholder={t.nameEnPlaceholder} />
              </FormField>
            </div>

            <FormField name="parent_id" label={t.parent}>
              <Select
                value={parentValue || 'none'}
                onValueChange={(v) => form.setValue('parent_id', v === 'none' ? '' : v, { shouldValidate: true })}
              >
                <SelectTrigger id="parent_id">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t.noParent}</SelectItem>
                  {parentOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <div className="flex items-center gap-2">
              <Checkbox
                id="active"
                checked={activeValue}
                onCheckedChange={(checked) => form.setValue('active', checked === true, { shouldValidate: true })}
              />
              <Label htmlFor="active" className="text-sm font-medium">
                {t.active}
              </Label>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t.cancel}
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                {isEdit ? t.save : t.create}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}

function buildDefaults(classification?: CaseClassification | null): FormValues {
  return {
    code: classification?.code ?? '',
    name_ar: classification?.name?.ar ?? '',
    name_en: classification?.name?.en ?? '',
    parent_id: classification?.parent_id ?? '',
    active: classification?.active ?? true,
    sort: classification?.sort ?? 0,
  };
}
