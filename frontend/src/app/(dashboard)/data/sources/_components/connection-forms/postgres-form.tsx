'use client';

import type { UseFormReturn } from 'react-hook-form';
import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { FormField } from '@/components/shared/forms/form-field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';
import type { PostgresConnectionValues } from '@/lib/data-suite/forms';

interface PostgresFormProps {
  form: UseFormReturn<PostgresConnectionValues>;
}

export function PostgresForm({ form }: PostgresFormProps) {
  const t = useDataLabels();
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <FormField name="host" label={t.connForms.host} required>
        <Input id="host" {...form.register('host')} />
      </FormField>

      <FormField name="port" label={t.connForms.port} required>
        <Input id="port" type="number" {...form.register('port', { valueAsNumber: true })} />
      </FormField>

      <FormField name="database" label={t.connForms.database} required>
        <Input id="database" {...form.register('database')} />
      </FormField>

      <FormField name="schema" label={t.connForms.schema}>
        <Input id="schema" {...form.register('schema')} />
      </FormField>

      <FormField name="username" label={t.connForms.username} required>
        <Input id="username" {...form.register('username')} />
      </FormField>

      <FormField name="password" label={t.connForms.password} required>
        <div className="flex gap-2">
          <Input
            id="password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            {...form.register('password')}
          />
          <Button type="button" variant="outline" size="icon" onClick={() => setShowPassword((current) => !current)}>
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        </div>
      </FormField>

      <FormField name="ssl_mode" label={t.connForms.sslMode} required>
        <Select value={form.watch('ssl_mode')} onValueChange={(value) => form.setValue('ssl_mode', value as PostgresConnectionValues['ssl_mode'], { shouldValidate: true })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="disable">{t.connForms.sslDisable}</SelectItem>
            <SelectItem value="allow">{t.connForms.sslAllow}</SelectItem>
            <SelectItem value="prefer">{t.connForms.sslPrefer}</SelectItem>
            <SelectItem value="require">{t.connForms.sslRequire}</SelectItem>
            <SelectItem value="verify-ca">{t.connForms.sslVerifyCa}</SelectItem>
            <SelectItem value="verify-full">{t.connForms.sslVerifyFull}</SelectItem>
          </SelectContent>
        </Select>
      </FormField>
    </div>
  );
}
