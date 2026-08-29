'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { FormProvider, useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { z } from 'zod';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FormField } from '@/components/shared/forms/form-field';
import { useApiMutation } from '@/hooks/use-api-mutation';
import { dataSuiteApi, deriveModelName } from '@/lib/data-suite';
import { getSourceTypeVisual } from '@/lib/data-suite/utils';
import { showApiError, showSuccess } from '@/lib/toast';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

// Standalone counterpart to the source-detail DeriveModelDialog: the models list
// page has no pre-selected source/table, so the user picks a source, we lazy-load
// its discovered schema, and they pick a table before deriving. The submit path is
// identical (POST /api/v1/data/models/derive).
const schema = z.object({
  source_id: z.string().min(1, 'Source is required'),
  table_name: z.string().min(1, 'Table is required'),
  name: z.string().min(2, 'Model name is required'),
  auto_generate_quality_rules: z.boolean().default(true),
});

type FormValues = z.infer<typeof schema>;

interface DeriveModelFromSourceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DeriveModelFromSourceDialog({
  open,
  onOpenChange,
}: DeriveModelFromSourceDialogProps) {
  const labels = useDataLabels();
  const router = useRouter();
  const [nameTouched, setNameTouched] = useState(false);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: {
      source_id: '',
      table_name: '',
      name: '',
      auto_generate_quality_rules: true,
    },
  });

  const sourceId = form.watch('source_id');
  const tableName = form.watch('table_name');

  const sourcesQuery = useQuery({
    queryKey: ['derive-model-sources'],
    queryFn: () =>
      dataSuiteApi.listSources({
        page: 1,
        per_page: 200,
        sort: 'name',
        order: 'asc',
      }),
    enabled: open,
  });

  const schemaQuery = useQuery({
    queryKey: ['derive-model-source-schema', sourceId],
    queryFn: () => dataSuiteApi.getSourceSchema(sourceId),
    enabled: open && Boolean(sourceId),
    staleTime: 60_000,
  });

  const sources = useMemo(() => sourcesQuery.data?.data ?? [], [sourcesQuery.data]);
  const tables = useMemo(() => schemaQuery.data?.tables ?? [], [schemaQuery.data]);

  useEffect(() => {
    if (!open) {
      form.reset({ source_id: '', table_name: '', name: '', auto_generate_quality_rules: true });
      setNameTouched(false);
    }
  }, [form, open]);

  // Suggest a model name from the picked table until the user edits it themselves.
  useEffect(() => {
    if (!tableName || nameTouched) {
      return;
    }
    form.setValue('name', deriveModelName(tableName), { shouldValidate: true });
  }, [form, nameTouched, tableName]);

  const mutation = useApiMutation('post', () => '/api/v1/data/models/derive', {
    invalidateKeys: ['data-models'],
    onSuccess: (data) => {
      const model = data as { id?: string };
      if (model.id) {
        showSuccess(labels.sourcesDetail.modelDerived, labels.sourcesDetail.modelDerivedDesc);
        onOpenChange(false);
        router.push(`/data/models/${model.id}`);
      }
    },
    onError: (error) => showApiError(error),
  });

  const onSubmit = (values: FormValues) => {
    mutation.mutate({
      source_id: values.source_id,
      table_name: values.table_name,
      name: values.name,
      auto_generate_quality_rules: values.auto_generate_quality_rules,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{labels.sourcesDetail.deriveModelTitle}</DialogTitle>
          <DialogDescription>
            {labels.models.deriveDesc}
          </DialogDescription>
        </DialogHeader>
        <FormProvider {...form}>
        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
          <FormField name="source_id" label={labels.pipelines.source} required>
            <Select
              value={sourceId}
              onValueChange={(next) => {
                form.setValue('source_id', next, { shouldValidate: true });
                form.setValue('table_name', '', { shouldValidate: true });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder={labels.pipelines.selectDataSource} />
              </SelectTrigger>
              <SelectContent>
                {sources.map((source) => (
                  <SelectItem key={source.id} value={source.id}>
                    {getSourceTypeVisual(source.type).label} • {source.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField name="table_name" label={labels.models.tableLabel} required>
            <Select
              value={tableName}
              onValueChange={(next) => {
                setNameTouched(false);
                form.setValue('table_name', next, { shouldValidate: true });
              }}
              disabled={!sourceId || schemaQuery.isFetching}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    !sourceId
                      ? labels.models.selectSourceFirst
                      : schemaQuery.isFetching
                        ? labels.pipelines.loadingSchema
                        : labels.models.selectTableOpt
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {tables.map((table) => (
                  <SelectItem key={`${table.schema_name ?? 'public'}.${table.name}`} value={table.name}>
                    {(table.schema_name ?? 'public')}.{table.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {sourceId && !schemaQuery.isFetching && tables.length === 0 ? (
              <p className="mt-1 text-xs text-muted-foreground">
                {labels.models.noTablesDiscovered}
              </p>
            ) : null}
          </FormField>

          <FormField name="name" label={labels.sourcesDetail.modelName} required>
            <Input
              {...form.register('name', {
                onChange: () => setNameTouched(true),
              })}
            />
          </FormField>

          <div className="flex items-center gap-3 rounded-lg border p-3">
            <Checkbox
              id="auto_generate_quality_rules"
              checked={form.watch('auto_generate_quality_rules')}
              onCheckedChange={(checked) => form.setValue('auto_generate_quality_rules', Boolean(checked))}
            />
            <Label htmlFor="auto_generate_quality_rules">{labels.sourcesDetail.autoGenRules}</Label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {labels.common.cancel}
            </Button>
            <Button type="submit" disabled={mutation.isPending || !form.formState.isValid}>
              {mutation.isPending ? (
                <>
                  <Loader2 className="me-2 h-4 w-4 animate-spin" />
                  {labels.sourcesDetail.deriving}
                </>
              ) : (
                labels.sourcesDetail.deriveModelBtn
              )}
            </Button>
          </DialogFooter>
        </form>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}
