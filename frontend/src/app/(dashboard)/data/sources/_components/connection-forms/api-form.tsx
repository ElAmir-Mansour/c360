'use client';

import type { UseFormReturn } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FormField } from '@/components/shared/forms/form-field';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';
import type { APIConnectionValues } from '@/lib/data-suite/forms';

interface KeyValueRow {
  id: string;
  key: string;
  value: string;
}

interface APIFormProps {
  form: UseFormReturn<APIConnectionValues>;
}

export function APIForm({ form }: APIFormProps) {
  const labels = useDataLabels();
  const authType = form.watch('auth_type');
  const [headerRows, setHeaderRows] = useState<KeyValueRow[]>(() =>
    Object.entries(form.getValues('headers') ?? {}).map(([key, value], index) => ({
      id: `${index}-${key}`,
      key,
      value,
    })),
  );

  useEffect(() => {
    form.setValue(
      'headers',
      Object.fromEntries(headerRows.filter((row) => row.key.trim()).map((row) => [row.key, row.value])),
      { shouldValidate: true },
    );
  }, [form, headerRows]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField name="base_url" label={labels.connForms.baseUrl} required>
          <Input {...form.register('base_url')} placeholder="https://api.example.com" />
        </FormField>

        <FormField name="auth_type" label={labels.connForms.authType} required>
          <Select value={authType} onValueChange={(value) => form.setValue('auth_type', value as APIConnectionValues['auth_type'], { shouldValidate: true })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{labels.connForms.authTypeNone}</SelectItem>
              <SelectItem value="basic">{labels.connForms.authTypeBasic}</SelectItem>
              <SelectItem value="bearer">{labels.connForms.authTypeBearer}</SelectItem>
              <SelectItem value="api_key">{labels.connForms.authTypeApiKey}</SelectItem>
              <SelectItem value="oauth2">{labels.connForms.authTypeOauth2}</SelectItem>
            </SelectContent>
          </Select>
        </FormField>

        <FormField name="pagination_type" label={labels.connForms.paginationType} required>
          <Select value={form.watch('pagination_type')} onValueChange={(value) => form.setValue('pagination_type', value as APIConnectionValues['pagination_type'], { shouldValidate: true })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="offset">{labels.connForms.pagOffset}</SelectItem>
              <SelectItem value="cursor">{labels.connForms.pagCursor}</SelectItem>
              <SelectItem value="page">{labels.connForms.pagPage}</SelectItem>
              <SelectItem value="link_header">{labels.connForms.pagLinkHeader}</SelectItem>
            </SelectContent>
          </Select>
        </FormField>

        <FormField name="rate_limit" label={labels.connForms.rateLimit}>
          <Input type="number" {...form.register('rate_limit', { valueAsNumber: true })} />
        </FormField>

        <FormField name="data_path" label={labels.connForms.dataPath}>
          <Input {...form.register('data_path')} placeholder="data.results" />
        </FormField>
      </div>

      {authType === 'basic' ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField name="auth_config.username" label={labels.connForms.username} required>
            <Input value={(form.watch('auth_config') as { username?: string }).username ?? ''} onChange={(event) => form.setValue('auth_config', { username: event.target.value, password: (form.watch('auth_config') as { password?: string }).password ?? '' }, { shouldValidate: true })} />
          </FormField>
          <FormField name="auth_config.password" label={labels.connForms.password} required>
            <Input type="password" autoComplete="new-password" value={(form.watch('auth_config') as { password?: string }).password ?? ''} onChange={(event) => form.setValue('auth_config', { username: (form.watch('auth_config') as { username?: string }).username ?? '', password: event.target.value }, { shouldValidate: true })} />
          </FormField>
        </div>
      ) : null}

      {authType === 'bearer' ? (
        <FormField name="auth_config.token" label={labels.connForms.bearerToken} required>
          <Input
            type="password"
            autoComplete="new-password"
            value={(form.watch('auth_config') as { token?: string }).token ?? ''}
            onChange={(event) => form.setValue('auth_config', { token: event.target.value }, { shouldValidate: true })}
          />
        </FormField>
      ) : null}

      {authType === 'api_key' ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <FormField name="auth_config.key_name" label={labels.connForms.keyName} required>
            <Input
              value={(form.watch('auth_config') as { key_name?: string }).key_name ?? ''}
              onChange={(event) =>
                form.setValue(
                  'auth_config',
                  {
                    key_name: event.target.value,
                    key_value: (form.watch('auth_config') as { key_value?: string }).key_value ?? '',
                    location: (form.watch('auth_config') as { location?: 'header' | 'query' }).location ?? 'header',
                  },
                  { shouldValidate: true },
                )
              }
            />
          </FormField>
          <FormField name="auth_config.key_value" label={labels.connForms.keyValue} required>
            <Input
              type="password"
              autoComplete="new-password"
              value={(form.watch('auth_config') as { key_value?: string }).key_value ?? ''}
              onChange={(event) =>
                form.setValue(
                  'auth_config',
                  {
                    key_name: (form.watch('auth_config') as { key_name?: string }).key_name ?? '',
                    key_value: event.target.value,
                    location: (form.watch('auth_config') as { location?: 'header' | 'query' }).location ?? 'header',
                  },
                  { shouldValidate: true },
                )
              }
            />
          </FormField>
          <FormField name="auth_config.location" label={labels.connForms.location} required>
            <Select
              value={(form.watch('auth_config') as { location?: 'header' | 'query' }).location ?? 'header'}
              onValueChange={(value) =>
                form.setValue(
                  'auth_config',
                  {
                    key_name: (form.watch('auth_config') as { key_name?: string }).key_name ?? '',
                    key_value: (form.watch('auth_config') as { key_value?: string }).key_value ?? '',
                    location: value as 'header' | 'query',
                  },
                  { shouldValidate: true },
                )
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="header">{labels.connForms.locHeader}</SelectItem>
                <SelectItem value="query">{labels.connForms.locQuery}</SelectItem>
              </SelectContent>
            </Select>
          </FormField>
        </div>
      ) : null}

      {authType === 'oauth2' ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormField name="auth_config.token_url" label={labels.connForms.tokenUrl} required>
            <Input value={(form.watch('auth_config') as { token_url?: string }).token_url ?? ''} onChange={(event) => form.setValue('auth_config', { ...(form.watch('auth_config') as object), token_url: event.target.value }, { shouldValidate: true })} />
          </FormField>
          <FormField name="auth_config.client_id" label={labels.connForms.clientId} required>
            <Input value={(form.watch('auth_config') as { client_id?: string }).client_id ?? ''} onChange={(event) => form.setValue('auth_config', { ...(form.watch('auth_config') as object), client_id: event.target.value }, { shouldValidate: true })} />
          </FormField>
          <FormField name="auth_config.client_secret" label={labels.connForms.clientSecret} required>
            <Input type="password" autoComplete="new-password" value={(form.watch('auth_config') as { client_secret?: string }).client_secret ?? ''} onChange={(event) => form.setValue('auth_config', { ...(form.watch('auth_config') as object), client_secret: event.target.value }, { shouldValidate: true })} />
          </FormField>
          <FormField name="auth_config.scope" label={labels.connForms.scope}>
            <Input value={(form.watch('auth_config') as { scope?: string }).scope ?? ''} onChange={(event) => form.setValue('auth_config', { ...(form.watch('auth_config') as object), scope: event.target.value }, { shouldValidate: true })} />
          </FormField>
        </div>
      ) : null}

      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex items-center justify-between">
          <h4 className="font-medium">{labels.connForms.customHeaders}</h4>
          <Button type="button" variant="outline" size="sm" onClick={() => setHeaderRows((rows) => [...rows, { id: crypto.randomUUID(), key: '', value: '' }])}>
            <Plus className="me-1.5 h-4 w-4" />
            {labels.connForms.addHeader}
          </Button>
        </div>
        {headerRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{labels.connForms.noCustomHeaders}</p>
        ) : (
          headerRows.map((row) => (
            <div key={row.id} className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto]">
              <Input value={row.key} onChange={(event) => setHeaderRows((rows) => rows.map((item) => (item.id === row.id ? { ...item, key: event.target.value } : item)))} placeholder={labels.connForms.headerName} />
              <Input value={row.value} onChange={(event) => setHeaderRows((rows) => rows.map((item) => (item.id === row.id ? { ...item, value: event.target.value } : item)))} placeholder={labels.connForms.headerValue} />
              <Button type="button" variant="ghost" size="icon" onClick={() => setHeaderRows((rows) => rows.filter((item) => item.id !== row.id))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
