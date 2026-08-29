'use client';

import type { UseFormReturn } from 'react-hook-form';
import { FormField } from '@/components/shared/forms/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';
import type { HiveConnectionValues, KerberosConfigValues } from '@/lib/data-suite/forms';

interface HiveFormProps {
  form: UseFormReturn<HiveConnectionValues>;
}

export function HiveForm({ form }: HiveFormProps) {
  const t = useDataLabels();
  const authType = form.watch('auth_type');
  const transportMode = form.watch('transport_mode');

  const updateKerberos = (patch: Partial<KerberosConfigValues>) => {
    form.setValue(
      'kerberos',
      {
        realm: form.getValues('kerberos')?.realm ?? '',
        kdc: form.getValues('kerberos')?.kdc ?? '',
        principal: form.getValues('kerberos')?.principal ?? '',
        keytab: form.getValues('kerberos')?.keytab ?? '',
        ...patch,
      },
      { shouldValidate: true },
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField name="host" label={t.connForms.host} required>
          <Input {...form.register('host')} placeholder="hiveserver2.example.com" />
        </FormField>
        <FormField name="port" label={t.connForms.port} required>
          <Input type="number" {...form.register('port', { valueAsNumber: true })} />
        </FormField>
        <FormField name="database" label={t.connForms.database}>
          <Input {...form.register('database')} placeholder="default" />
        </FormField>
        <FormField name="transport_mode" label={t.connForms.transportMode} required>
          <Select value={transportMode} onValueChange={(value) => form.setValue('transport_mode', value as HiveConnectionValues['transport_mode'], { shouldValidate: true })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="binary">{t.connForms.transportBinary}</SelectItem>
              <SelectItem value="http">{t.connForms.protocolHttp}</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        {transportMode === 'http' ? (
          <FormField name="http_path" label={t.connForms.httpPath} required>
            <Input {...form.register('http_path')} placeholder="/cliservice" />
          </FormField>
        ) : null}
        <FormField name="auth_type" label={t.connForms.authentication} required>
          <Select value={authType} onValueChange={(value) => form.setValue('auth_type', value as HiveConnectionValues['auth_type'], { shouldValidate: true })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="noauth">{t.connForms.authNoAuth}</SelectItem>
              <SelectItem value="plain">{t.connForms.authUsernamePassword}</SelectItem>
              <SelectItem value="kerberos">{t.connForms.authKerberos}</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
      </div>

      {authType === 'plain' ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField name="username" label={t.connForms.username} required>
            <Input {...form.register('username')} />
          </FormField>
          <FormField name="password" label={t.connForms.password} required>
            <Input type="password" autoComplete="new-password" {...form.register('password')} />
          </FormField>
        </div>
      ) : null}

      {authType === 'kerberos' ? (
        <div className="grid grid-cols-1 gap-4 rounded-lg border p-4 md:grid-cols-2">
          <FormField name="kerberos.realm" label={t.connForms.realm} required>
            <Input value={form.watch('kerberos')?.realm ?? ''} onChange={(event) => updateKerberos({ realm: event.target.value })} />
          </FormField>
          <FormField name="kerberos.kdc" label={t.connForms.kdc} required>
            <Input value={form.watch('kerberos')?.kdc ?? ''} onChange={(event) => updateKerberos({ kdc: event.target.value })} />
          </FormField>
          <FormField name="kerberos.principal" label={t.connForms.principal} required>
            <Input value={form.watch('kerberos')?.principal ?? ''} onChange={(event) => updateKerberos({ principal: event.target.value })} />
          </FormField>
          <FormField name="kerberos.keytab" label={t.connForms.keytabPath}>
            <Input value={form.watch('kerberos')?.keytab ?? ''} onChange={(event) => updateKerberos({ keytab: event.target.value })} placeholder="/etc/security/keytabs/hive.keytab" />
          </FormField>
        </div>
      ) : null}

      <div className="flex items-center justify-between rounded-lg border p-4">
        <div>
          <Label>{t.connForms.tlsSsl}</Label>
          <p className="text-xs text-muted-foreground">{t.connForms.tlsSslHiveHelp}</p>
        </div>
        <Switch checked={form.watch('use_tls')} onCheckedChange={(checked) => form.setValue('use_tls', checked, { shouldValidate: true })} />
      </div>
    </div>
  );
}
