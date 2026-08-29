'use client';

import type { UseFormReturn } from 'react-hook-form';
import { FormField } from '@/components/shared/forms/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';
import type { ClickHouseConnectionValues } from '@/lib/data-suite/forms';

interface ClickHouseFormProps {
  form: UseFormReturn<ClickHouseConnectionValues>;
}

export function ClickHouseForm({ form }: ClickHouseFormProps) {
  const t = useDataLabels();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField name="host" label={t.connForms.host} required>
          <Input {...form.register('host')} placeholder="clickhouse.example.com" />
        </FormField>
        <FormField name="port" label={t.connForms.port} required description={t.connForms.portHelpClickhouse}>
          <Input type="number" {...form.register('port', { valueAsNumber: true })} />
        </FormField>
        <FormField name="database" label={t.connForms.database} required>
          <Input {...form.register('database')} placeholder="default" />
        </FormField>
        <FormField name="protocol" label={t.connForms.protocol} required>
          <Select value={form.watch('protocol')} onValueChange={(value) => form.setValue('protocol', value as ClickHouseConnectionValues['protocol'], { shouldValidate: true })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="native">{t.connForms.protocolNative}</SelectItem>
              <SelectItem value="http">{t.connForms.protocolHttp}</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField name="username" label={t.connForms.username} required>
          <Input {...form.register('username')} placeholder="default" />
        </FormField>
        <FormField name="password" label={t.connForms.password} required>
          <Input type="password" autoComplete="new-password" {...form.register('password')} />
        </FormField>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <Label>{t.connForms.tlsSsl}</Label>
            <p className="text-xs text-muted-foreground">{t.connForms.tlsSslEncryptHelp}</p>
          </div>
          <Switch checked={form.watch('secure')} onCheckedChange={(checked) => form.setValue('secure', checked, { shouldValidate: true })} />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div>
            <Label>{t.connForms.compression}</Label>
            <p className="text-xs text-muted-foreground">{t.connForms.compressionHelp}</p>
          </div>
          <Switch checked={form.watch('compression')} onCheckedChange={(checked) => form.setValue('compression', checked, { shouldValidate: true })} />
        </div>
      </div>
    </div>
  );
}
