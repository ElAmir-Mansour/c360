'use client';

import { useMemo } from 'react';
import { useForm, FormProvider } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { FormField } from '@/components/shared/forms/form-field';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { API_ENDPOINTS } from '@/lib/constants';
import type { CTEMAssessment } from '@/types/cyber';
import { useCtemLabels } from '../_lib/ctem-i18n';

const makeSchema = (nameRequired: string) =>
  z.object({
    name: z.string().min(2, nameRequired).max(255),
    description: z.string().optional(),
    asset_tags: z.string().optional(),
  });

type FormValues = z.infer<ReturnType<typeof makeSchema>>;

interface CreateAssessmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (assessment: CTEMAssessment) => void;
}

export function CreateAssessmentDialog({ open, onOpenChange, onSuccess }: CreateAssessmentDialogProps) {
  const t = useCtemLabels();
  const schema = useMemo(() => makeSchema(t.create.nameRequired), [t.create.nameRequired]);
  const methods = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '',
      description: '',
      asset_tags: '',
    },
  });

  const { mutate, isPending } = useApiMutation<CTEMAssessment, Record<string, unknown>>(
    'post',
    API_ENDPOINTS.CYBER_CTEM_ASSESSMENTS,
    {
      successMessage: t.create.createdToast,
      invalidateKeys: ['cyber-ctem-assessments'],
      onSuccess: (result) => {
        methods.reset();
        onOpenChange(false);
        onSuccess?.(result);
      },
    },
  );

  const onSubmit = methods.handleSubmit((data) => {
    const parsedTags = data.asset_tags
      ? data.asset_tags.split(',').map((t) => t.trim()).filter(Boolean)
      : [];
    mutate({
      name: data.name,
      description: data.description,
      scope: {
        asset_tags: parsedTags.length > 0 ? parsedTags : undefined,
      },
      start: true,
    });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.create.title}</DialogTitle>
          <DialogDescription>
            {t.create.description}
          </DialogDescription>
        </DialogHeader>

        <FormProvider {...methods}>
          <form onSubmit={onSubmit} className="space-y-4">
            <FormField name="name" label={t.create.name} required>
              <Input placeholder={t.create.namePlaceholder} {...methods.register('name')} />
            </FormField>
            <FormField name="description" label={t.create.descriptionLabel}>
              <Textarea rows={2} placeholder={t.create.descriptionPlaceholder} {...methods.register('description')} />
            </FormField>
            <FormField name="asset_tags" label={t.create.assetTagFilter}>
              <Input placeholder={t.create.assetTagPlaceholder} {...methods.register('asset_tags')} />
            </FormField>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{t.create.cancel}</Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? t.create.starting : t.create.startAssessment}
              </Button>
            </DialogFooter>
          </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
