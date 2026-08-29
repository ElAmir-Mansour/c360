'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, FileSpreadsheet, History, Loader2, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { downloadBlob } from '@/lib/format';
import { showApiError, showSuccess } from '@/lib/toast';
import {
  lexAdminApi,
  type OrgImportJob,
  type OrgImportMode,
  type OrgStructureImportRow,
} from '@/lib/lex/admin';
import { parseOrgStructureFile } from '../_lib/org-import-file';
import { useOrgImportLabels } from './org-import-labels';

export function OrgStructureImportDialog() {
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const labels = useOrgImportLabels();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<OrgImportMode>('merge');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<OrgStructureImportRow[]>([]);
  const [fileError, setFileError] = useState('');
  const [preview, setPreview] = useState<OrgImportJob | null>(null);

  const history = useQuery({
    queryKey: ['lex-admin-org-imports'],
    queryFn: lexAdminApi.listOrgImportJobs,
    enabled: open,
  });

  const previewMutation = useMutation({
    mutationFn: () => lexAdminApi.importOrgStructure({ mode, dry_run: true, source_filename: fileName, rows }),
    onSuccess: async (job) => {
      setPreview(job);
      await qc.invalidateQueries({ queryKey: ['lex-admin-org-imports'] });
    },
    onError: showApiError,
  });

  const applyMutation = useMutation({
    mutationFn: () => lexAdminApi.importOrgStructure({ mode, dry_run: false, source_filename: fileName, rows }),
    onSuccess: async (job) => {
      setPreview(job);
      if (job.status === 'completed') {
        showSuccess(labels.imported);
        await Promise.all([
          qc.invalidateQueries({ queryKey: ['lex-admin-org-entities'] }),
          qc.invalidateQueries({ queryKey: ['lex-admin-org-imports'] }),
        ]);
      }
    },
    onError: showApiError,
  });

  const readFile = async (file?: File) => {
    if (!file) return;
    setFileError('');
    setPreview(null);
    try {
      const parsed = await parseOrgStructureFile(file);
      if (parsed.length === 0) {
        setFileError(labels.emptyFile);
        return;
      }
      setRows(parsed);
      setFileName(file.name);
    } catch {
      setRows([]);
      setFileName(file.name);
      setFileError(labels.readError);
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const template = async (format: 'xlsx' | 'csv' | 'json', sample: boolean) => {
    try {
      const blob = await lexAdminApi.getOrgImportTemplate(format, sample);
      downloadBlob(blob, `watheeq-org-structure-${sample ? 'filled-sample' : 'template'}.${format}`);
    } catch (error) { showApiError(error); }
  };

  const errors = preview?.errors ?? [];
  const canApply = preview?.status === 'validated' && errors.length === 0;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Upload className="me-1.5 h-3.5 w-3.5" />
          {labels.importStructure}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{labels.uploadTitle}</DialogTitle>
          <DialogDescription>
            {labels.uploadDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="space-y-4">
            <div className="rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium">{labels.downloadStep}</p>
                  <p className="text-sm text-muted-foreground">{labels.templateHelp}</p>
                </div>
              </div>
              <TemplateDownloads label={labels.blankTemplate} onDownload={(format) => void template(format, false)} />
              <TemplateDownloads label={labels.filledSample} onDownload={(format) => void template(format, true)} />
            </div>

            <div className="rounded-lg border p-4">
              <p className="font-medium">{labels.behaviorStep}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-[13rem_1fr] sm:items-center">
                <Select value={mode} onValueChange={(value) => { setMode(value as OrgImportMode); setPreview(null); }}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(labels.modes) as OrgImportMode[]).map((value) => (
                      <SelectItem key={value} value={value}>{labels.modes[value].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">{labels.modes[mode].description}</p>
              </div>
              {mode === 'replace' ? (
                <div className="mt-3 flex gap-2 rounded-md border border-warning-500/40 bg-warning-500/10 p-3 text-sm text-warning-700 dark:text-warning-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {labels.replaceWarning}
                </div>
              ) : null}
            </div>

            <div className="rounded-lg border p-4">
              <p className="font-medium">{labels.uploadStep}</p>
              <input ref={inputRef} type="file" className="hidden" accept=".xlsx,.csv,.json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,application/json" onChange={(event) => void readFile(event.target.files?.[0])} />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
                  <FileSpreadsheet className="me-1.5 h-4 w-4" />{labels.chooseFile}
                </Button>
                <span className="text-sm text-muted-foreground">{fileName || labels.noFile}</span>
                {rows.length ? <Badge variant="secondary">{labels.rows(rows.length)}</Badge> : null}
                <Button type="button" onClick={() => previewMutation.mutate()} disabled={!rows.length || previewMutation.isPending}>
                  {previewMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                  {labels.runDryRun}
                </Button>
              </div>
              {fileError ? <p role="alert" className="mt-3 text-sm text-destructive">{fileError}</p> : null}
            </div>

            {preview ? (
              <div className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{labels.validationResult}</p>
                  <Badge variant={preview.status === 'failed' ? 'destructive' : 'secondary'}>{labels.status[preview.status]}</Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-6">
                  <Summary label={labels.summary.rows} value={preview.total_rows} />
                  <Summary label={labels.summary.create} value={preview.create_count} />
                  <Summary label={labels.summary.update} value={preview.update_count} />
                  <Summary label={labels.summary.deactivate} value={preview.deactivate_count} />
                  <Summary label={labels.summary.roles} value={preview.role_count} />
                  <Summary label={labels.summary.employees} value={preview.employee_count} />
                </div>
                {errors.length ? (
                  <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-destructive">{labels.validationErrors(errors.length)}</p>
                      <Button type="button" variant="outline" size="sm" onClick={async () => downloadBlob(await lexAdminApi.getOrgImportErrors(preview.id), `org-import-${preview.id}-errors.csv`)}>
                        <Download className="me-1 h-3.5 w-3.5" />{labels.errorReport}
                      </Button>
                    </div>
                    <div className="max-h-52 overflow-auto rounded-md border">
                      {errors.map((issue, index) => (
                        <div key={`${issue.row}-${issue.field}-${index}`} className="grid grid-cols-[4rem_7rem_1fr] gap-2 border-b px-3 py-2 text-xs last:border-0">
                          <span>{labels.row(issue.row)}</span><span className="font-mono">{issue.code || '—'}</span><span>{issue.message}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : <p className="mt-4 text-sm text-success-700 dark:text-success-300">{labels.allRowsPassed}</p>}
              </div>
            ) : null}
          </div>

          <aside className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center gap-2"><History className="h-4 w-4" /><p className="font-medium">{labels.history}</p></div>
            {history.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            <div className="max-h-[32rem] space-y-2 overflow-auto">
              {(history.data ?? []).map((job) => (
                <div key={job.id} className="rounded-md border p-2 text-xs">
                  <div className="flex items-center justify-between gap-2"><span className="truncate font-medium">{job.source_filename || labels.apiImport}</span><Badge variant={job.status === 'failed' ? 'destructive' : 'outline'}>{labels.status[job.status]}</Badge></div>
                  <p className="mt-1 text-muted-foreground">{labels.modes[job.mode].label} · {labels.rows(job.total_rows)}</p>
                  <p className="text-muted-foreground">{new Date(job.created_at).toLocaleString()}</p>
                  {job.errors.length ? <Button type="button" variant="ghost" size="sm" className="mt-1 h-7 px-1.5" onClick={async () => downloadBlob(await lexAdminApi.getOrgImportErrors(job.id), `org-import-${job.id}-errors.csv`)}>{labels.downloadErrors}</Button> : null}
                </div>
              ))}
              {!history.isLoading && !history.data?.length ? <p className="text-sm text-muted-foreground">{labels.noHistory}</p> : null}
            </div>
          </aside>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>{labels.close}</Button>
          <Button type="button" onClick={() => applyMutation.mutate()} disabled={!canApply || applyMutation.isPending}>
            {applyMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
            {labels.applyAtomically}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return <div className="rounded-md bg-muted/50 p-2"><p className="text-muted-foreground">{label}</p><p className="font-semibold tabular-nums">{value}</p></div>;
}

function TemplateDownloads({ label, onDownload }: { label: string; onDownload: (format: 'xlsx' | 'csv' | 'json') => void }) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex gap-2">
        {(['xlsx', 'csv', 'json'] as const).map((format) => (
          <Button key={format} type="button" variant="outline" size="sm" onClick={() => onDownload(format)}>
            <Download className="me-1 h-3.5 w-3.5" />{format.toUpperCase()}
          </Button>
        ))}
      </div>
    </div>
  );
}
