'use client';

import { useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormProvider, useForm } from 'react-hook-form';
import { X } from 'lucide-react';
import { FormField } from '@/components/shared/forms/form-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  pipelineBasicSchema,
  type PipelineBasicValues,
} from '@/app/(dashboard)/data/pipelines/_components/pipeline-wizard-types';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface WizardStepBasicProps {
  defaultValues: PipelineBasicValues;
  onContinue: (values: PipelineBasicValues) => void;
}

export function WizardStepBasic({
  defaultValues,
  onContinue,
}: WizardStepBasicProps) {
  const labels = useDataLabels();
  const [tagValue, setTagValue] = useState('');
  const form = useForm<PipelineBasicValues>({
    resolver: zodResolver(pipelineBasicSchema),
    mode: 'onChange',
    defaultValues,
  });

  const tags = form.watch('tags');

  return (
    <FormProvider {...form}>
      <form className="space-y-6" onSubmit={form.handleSubmit(onContinue)}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField name="name" label={labels.pipelines.pipelineName} required>
            <Input {...form.register('name')} placeholder="customer_orders_sync" />
          </FormField>

          <FormField name="type" label={labels.pipelines.pipelineType} required>
            <Select
              value={form.watch('type')}
              onValueChange={(next) =>
                form.setValue('type', next as PipelineBasicValues['type'], { shouldValidate: true })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="etl">{labels.pipelines.ptEtl}</SelectItem>
                <SelectItem value="elt">{labels.pipelines.ptElt}</SelectItem>
                <SelectItem value="batch">{labels.pipelines.ptBatch}</SelectItem>
                <SelectItem value="streaming">{labels.pipelines.ptStreaming}</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
        </div>

        <FormField name="description" label={labels.common.description}>
          <Textarea
            {...form.register('description')}
            rows={4}
            placeholder={labels.pipelines.descriptionPlaceholder}
          />
        </FormField>

        <FormField name="tags" label={labels.sources.tags} description={labels.pipelines.tagsDesc}>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-2 rounded-full border bg-muted/20 px-3 py-1 text-xs"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() =>
                      form.setValue(
                        'tags',
                        tags.filter((item) => item !== tag),
                        { shouldValidate: true },
                      )
                    }
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>

            <Input
              value={tagValue}
              onChange={(event) => setTagValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') {
                  return;
                }
                event.preventDefault();
                const next = tagValue.trim();
                if (!next || tags.includes(next)) {
                  return;
                }
                form.setValue('tags', [...tags, next], { shouldValidate: true });
                setTagValue('');
              }}
              placeholder={labels.pipelines.tagsPlaceholder}
            />
          </div>
        </FormField>

        <div className="flex justify-end">
          <Button type="submit" disabled={!form.formState.isValid}>
            {labels.common.continue}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}
