'use client';

import type { UseFormReturn } from 'react-hook-form';
import { FormField } from '@/components/shared/forms/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';
import type { DoltConnectionValues } from '@/lib/data-suite/forms';

interface DoltFormProps {
  form: UseFormReturn<DoltConnectionValues>;
}

export function DoltForm({ form }: DoltFormProps) {
  const t = useDataLabels();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField name="host" label={t.connForms.host} required>
          <Input {...form.register('host')} placeholder="dolt-server.example.com" />
        </FormField>
        <FormField name="port" label={t.connForms.port} required>
          <Input type="number" {...form.register('port', { valueAsNumber: true })} />
        </FormField>
        <FormField name="database" label={t.connForms.database} required>
          <Input {...form.register('database')} />
        </FormField>
        <FormField name="branch" label={t.connForms.branch}>
          <Input {...form.register('branch')} placeholder="main" />
        </FormField>
        <FormField name="username" label={t.connForms.username} required>
          <Input {...form.register('username')} />
        </FormField>
        <FormField name="password" label={t.connForms.password} required>
          <Input type="password" autoComplete="new-password" {...form.register('password')} />
        </FormField>
      </div>

      <div className="flex items-center justify-between rounded-lg border p-4">
        <div>
          <Label>{t.connForms.tlsSsl}</Label>
          <p className="text-xs text-muted-foreground">{t.connForms.tlsSslDoltHelp}</p>
        </div>
        <Switch checked={form.watch('use_tls')} onCheckedChange={(checked) => form.setValue('use_tls', checked, { shouldValidate: true })} />
      </div>
    </div>
  );
}
