'use client';

import type { UseFormReturn } from 'react-hook-form';
import { useState } from 'react';
import { FormField } from '@/components/shared/forms/form-field';
import { FileUpload } from '@/components/shared/forms/file-upload';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { dataSuiteApi } from '@/lib/data-suite';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';
import type { CSVConnectionValues } from '@/lib/data-suite/forms';

interface CSVFormProps {
  form: UseFormReturn<CSVConnectionValues>;
}

export function CSVForm({ form }: CSVFormProps) {
  const t = useDataLabels();
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4">
        <h4 className="mb-2 font-medium">{t.connForms.uploadFile}</h4>
        <p className="mb-3 text-sm text-muted-foreground">{t.connForms.csvUploadHelp}</p>
        <FileUpload
          accept=".csv,.tsv"
          uploading={uploading}
          progress={uploadProgress}
          onUpload={async (files) => {
            const file = files[0];
            if (!file) {
              return;
            }
            setUploading(true);
            try {
              const uploaded = await dataSuiteApi.uploadDataFile(file, setUploadProgress);
              form.setValue('upload_file_id', uploaded.id, { shouldDirty: true });
              form.setValue('upload_file_name', uploaded.original_name, { shouldDirty: true });
              if (!form.getValues('file_path')) {
                form.setValue('file_path', uploaded.original_name, { shouldValidate: true, shouldDirty: true });
              }
            } finally {
              setUploading(false);
            }
          }}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FormField name="minio_endpoint" label={t.connForms.minioEndpoint} required>
          <Input {...form.register('minio_endpoint')} placeholder="http://minio:9000" />
        </FormField>
        <FormField name="bucket" label={t.connForms.bucket} required>
          <Input {...form.register('bucket')} />
        </FormField>
        <FormField name="file_path" label={t.connForms.filePath} required>
          <Input {...form.register('file_path')} placeholder="imports/customers.csv" />
        </FormField>
        <FormField name="delimiter" label={t.connForms.delimiter}>
          <Select value={form.watch('delimiter')} onValueChange={(value) => form.setValue('delimiter', value, { shouldValidate: true })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value=",">{t.connForms.delimComma}</SelectItem>
              <SelectItem value="\t">{t.connForms.delimTab}</SelectItem>
              <SelectItem value=";">{t.connForms.delimSemicolon}</SelectItem>
              <SelectItem value="|">{t.connForms.delimPipe}</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
        <FormField name="access_key" label={t.connForms.accessKey} required>
          <Input {...form.register('access_key')} />
        </FormField>
        <FormField name="secret_key" label={t.connForms.secretKey} required>
          <Input type="password" autoComplete="new-password" {...form.register('secret_key')} />
        </FormField>
        <FormField name="encoding" label={t.connForms.encoding}>
          <Select value={form.watch('encoding')} onValueChange={(value) => form.setValue('encoding', value as CSVConnectionValues['encoding'], { shouldValidate: true })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="UTF-8">UTF-8</SelectItem>
              <SelectItem value="Latin-1">Latin-1</SelectItem>
              <SelectItem value="Windows-1252">Windows-1252</SelectItem>
            </SelectContent>
          </Select>
        </FormField>
      </div>

      <div className="flex flex-wrap gap-6 rounded-lg border p-4">
        <div className="flex items-center gap-3">
          <Switch checked={form.watch('has_header')} onCheckedChange={(checked) => form.setValue('has_header', checked, { shouldValidate: true })} />
          <Label>{t.connForms.hasHeaderRow}</Label>
        </div>
        <div className="flex items-center gap-3">
          <Switch checked={form.watch('use_ssl')} onCheckedChange={(checked) => form.setValue('use_ssl', checked, { shouldValidate: true })} />
          <Label>{t.connForms.useSsl}</Label>
        </div>
      </div>
    </div>
  );
}
