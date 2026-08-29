'use client';

import type { UseFormReturn } from 'react-hook-form';
import { FormField } from '@/components/shared/forms/form-field';
import { Input } from '@/components/ui/input';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';
import type { DagsterConnectionValues } from '@/lib/data-suite/forms';

interface DagsterFormProps {
  form: UseFormReturn<DagsterConnectionValues>;
}

export function DagsterForm({ form }: DagsterFormProps) {
  const labels = useDataLabels();
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <FormField name="graphql_url" label={labels.connForms.graphqlUrl} required>
        <Input {...form.register('graphql_url')} placeholder="http://dagster-webserver:3000/graphql" />
      </FormField>
      <FormField name="workspace" label={labels.connForms.workspace}>
        <Input {...form.register('workspace')} placeholder="default" />
      </FormField>
      <FormField name="api_token" label={labels.connForms.apiToken}>
        <Input type="password" autoComplete="new-password" {...form.register('api_token')} />
      </FormField>
      <FormField name="timeout_seconds" label={labels.connForms.timeoutSeconds} required>
        <Input type="number" {...form.register('timeout_seconds', { valueAsNumber: true })} />
      </FormField>
    </div>
  );
}
