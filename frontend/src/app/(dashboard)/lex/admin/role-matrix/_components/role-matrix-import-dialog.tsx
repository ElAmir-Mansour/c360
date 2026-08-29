'use client';

/**
 * Tenant Role-Matrix Import dialog (Lex_Role_Matrix_Import_Design.md §9).
 * Mirrors the shipped Org-Structure Import flow: template download → file
 * upload (client parse = deserialization only) → server DRY-RUN with
 * per-cell errors + diff preview → warnings confirmation → COMMIT (draft
 * version). Activation is deliberately a separate, four-eyes step in the
 * Versions dialog — an importer can never activate their own version.
 */

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, FileSpreadsheet, History, Loader2, Upload } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  type RoleMatrixImportJob,
  type RoleMatrixImportMode,
  type RoleMatrixImportPayload,
  type RoleMatrixImportRolePayload,
} from '@/lib/lex/admin';
import { parseRoleMatrixFile } from '../_lib/role-matrix-import-file';
import { useRoleMatrixImportLabels } from '../_lib/role-matrix-import-i18n';

export function RoleMatrixImportDialog() {
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const t = useRoleMatrixImportLabels();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<RoleMatrixImportMode>('merge');
  const [fileName, setFileName] = useState('');
  const [grants, setGrants] = useState<Record<string, string[]>>({});
  const [roles, setRoles] = useState<RoleMatrixImportRolePayload[]>([]);
  const [fileError, setFileError] = useState('');
  const [preview, setPreview] = useState<RoleMatrixImportJob | null>(null);
  const [confirmWarnings, setConfirmWarnings] = useState(false);
  const [changeReason, setChangeReason] = useState('');

  const history = useQuery({
    queryKey: ['lex-role-matrix-imports'],
    queryFn: lexAdminApi.listRoleMatrixImports,
    enabled: open,
  });

  const payload = (dryRun: boolean): RoleMatrixImportPayload => ({
    mode,
    dry_run: dryRun,
    source_filename: fileName,
    change_reason: changeReason,
    confirm_warnings: confirmWarnings,
    roles: roles.length > 0 ? roles : undefined,
    grants,
  });

  const previewMutation = useMutation({
    mutationFn: () => lexAdminApi.importRoleMatrix(payload(true)),
    onSuccess: async (job) => {
      setPreview(job);
      setConfirmWarnings(false);
      await qc.invalidateQueries({ queryKey: ['lex-role-matrix-imports'] });
    },
    onError: showApiError,
  });

  const commitMutation = useMutation({
    mutationFn: () => lexAdminApi.importRoleMatrix(payload(false)),
    onSuccess: async (job) => {
      setPreview(job);
      if (job.status === 'committed') {
        showSuccess(t.committed);
        await Promise.all([
          qc.invalidateQueries({ queryKey: ['lex-role-matrix-imports'] }),
          qc.invalidateQueries({ queryKey: ['lex-role-matrix-versions'] }),
        ]);
      }
    },
    onError: showApiError,
  });

  const readFile = async (file?: File) => {
    if (!file) return;
    setFileError('');
    setPreview(null);
    setConfirmWarnings(false);
    try {
      const parsed = await parseRoleMatrixFile(file);
      const grantCount = Object.values(parsed.grants).reduce((sum, list) => sum + list.length, 0);
      if (grantCount === 0) {
        setGrants({});
        setRoles([]);
        setFileError(t.emptyFile);
        return;
      }
      setGrants(parsed.grants);
      setRoles(parsed.roles);
      setFileName(file.name);
    } catch {
      setGrants({});
      setRoles([]);
      setFileName(file.name);
      setFileError(t.readError);
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const template = async (format: 'xlsx' | 'csv' | 'json', prefilled: boolean) => {
    try {
      const blob = await lexAdminApi.getRoleMatrixTemplate(format, prefilled);
      downloadBlob(blob, `watheeq-role-matrix-${prefilled ? 'current' : 'blank'}.${format}`);
    } catch (error) {
      showApiError(error);
    }
  };

  const errors = preview?.errors ?? [];
  const warnings = preview?.warnings ?? [];
  const grantCount = Object.values(grants).reduce((sum, list) => sum + list.length, 0);
  const canCommit =
    preview?.status === 'validated' &&
    errors.length === 0 &&
    (warnings.length === 0 || confirmWarnings);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Upload className="me-1.5 h-3.5 w-3.5" />
          {t.importCta}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t.dialogTitle}</DialogTitle>
          <DialogDescription>{t.dialogDescription}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="space-y-4">
            <div className="rounded-lg border p-4">
              <p className="font-medium">{t.downloadStep}</p>
              <p className="text-sm text-muted-foreground">{t.templateHelp}</p>
              <TemplateDownloads label={t.currentTemplate} onDownload={(format) => void template(format, true)} />
              <TemplateDownloads label={t.blankTemplate} onDownload={(format) => void template(format, false)} />
            </div>

            <div className="rounded-lg border p-4">
              <p className="font-medium">{t.behaviorStep}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-[13rem_1fr] sm:items-center">
                <Select
                  value={mode}
                  onValueChange={(value) => {
                    setMode(value as RoleMatrixImportMode);
                    setPreview(null);
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(t.modes) as RoleMatrixImportMode[]).map((value) => (
                      <SelectItem key={value} value={value}>{t.modes[value].label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">{t.modes[mode].description}</p>
              </div>
              {mode === 'replace' ? (
                <div className="mt-3 flex gap-2 rounded-md border border-warning-500/40 bg-warning-500/10 p-3 text-sm text-warning-700 dark:text-warning-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  {t.replaceWarning}
                </div>
              ) : null}
            </div>

            <div className="rounded-lg border p-4">
              <p className="font-medium">{t.uploadStep}</p>
              <input
                ref={inputRef}
                type="file"
                className="hidden"
                accept=".xlsx,.csv,.json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,application/json"
                onChange={(event) => void readFile(event.target.files?.[0])}
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
                  <FileSpreadsheet className="me-1.5 h-4 w-4" />
                  {t.chooseFile}
                </Button>
                <span className="text-sm text-muted-foreground">{fileName || t.noFile}</span>
                {grantCount > 0 ? (
                  <Badge variant="secondary">{t.parsedSummary(Object.keys(grants).length, grantCount)}</Badge>
                ) : null}
                <Button
                  type="button"
                  onClick={() => previewMutation.mutate()}
                  disabled={grantCount === 0 || previewMutation.isPending}
                >
                  {previewMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
                  {t.runDryRun}
                </Button>
              </div>
              {fileError ? <p role="alert" className="mt-3 text-sm text-destructive">{fileError}</p> : null}
            </div>

            {preview ? (
              <div className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{t.validationResult}</p>
                  <Badge variant={preview.status === 'failed' ? 'destructive' : 'secondary'}>
                    {t.status[preview.status]}
                  </Badge>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
                  <Summary label={t.summary.roles} value={preview.role_count} />
                  <Summary label={t.summary.grants} value={preview.grant_count} />
                  <Summary label={t.summary.added} value={preview.diff.grants_added} />
                  <Summary label={t.summary.removed} value={preview.diff.grants_removed} />
                  <Summary label={t.summary.unchanged} value={preview.diff.roles_unchanged} />
                </div>

                <DiffPreview job={preview} />

                {errors.length ? (
                  <div className="mt-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-destructive">{t.validationErrors(errors.length)}</p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={async () =>
                          downloadBlob(
                            await lexAdminApi.getRoleMatrixImportErrors(preview.id),
                            `role-matrix-import-${preview.id}-errors.csv`,
                          )
                        }
                      >
                        <Download className="me-1 h-3.5 w-3.5" />
                        {t.errorReport}
                      </Button>
                    </div>
                    <IssueList issues={errors} tone="error" />
                  </div>
                ) : null}

                {warnings.length ? (
                  <div className="mt-4 space-y-2">
                    <p className="text-sm font-medium text-warning-700 dark:text-warning-300">
                      {t.warnings(warnings.length)}
                    </p>
                    <IssueList issues={warnings} tone="warning" />
                    <label className="flex items-start gap-2 rounded-md border border-warning-500/40 bg-warning-500/10 p-3">
                      <Checkbox
                        checked={confirmWarnings}
                        onCheckedChange={(value) => setConfirmWarnings(value === true)}
                        className="mt-0.5"
                      />
                      <span className="text-sm">{t.confirmWarnings}</span>
                    </label>
                  </div>
                ) : null}

                {!errors.length && !warnings.length ? (
                  <p className="mt-4 text-sm text-success-700 dark:text-success-300">{t.allPassed}</p>
                ) : null}
              </div>
            ) : null}

            <div className="rounded-lg border p-4">
              <Label htmlFor="role-matrix-change-reason">{t.changeReason}</Label>
              <Input
                id="role-matrix-change-reason"
                className="mt-2"
                value={changeReason}
                onChange={(event) => setChangeReason(event.target.value)}
                placeholder={t.changeReasonPlaceholder}
              />
              <p className="mt-2 text-xs text-muted-foreground">{t.fourEyesNote}</p>
            </div>
          </div>

          <aside className="space-y-3 rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4" />
              <p className="font-medium">{t.history}</p>
            </div>
            {history.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            <div className="max-h-[32rem] space-y-2 overflow-auto">
              {(history.data ?? []).map((job) => (
                <div key={job.id} className="rounded-md border p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{job.source_filename || '—'}</span>
                    <Badge variant={job.status === 'failed' ? 'destructive' : 'outline'}>
                      {t.status[job.status]}
                    </Badge>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {t.modes[job.mode].label} · {t.rolesCount(job.role_count)}
                  </p>
                  <p className="text-muted-foreground">{new Date(job.created_at).toLocaleString()}</p>
                </div>
              ))}
              {!history.isLoading && !history.data?.length ? (
                <p className="text-sm text-muted-foreground">{t.noHistory}</p>
              ) : null}
            </div>
          </aside>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {t.close}
          </Button>
          <Button
            type="button"
            onClick={() => commitMutation.mutate()}
            disabled={!canCommit || commitMutation.isPending}
          >
            {commitMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
            {t.commit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-muted/50 p-2">
      <p className="text-muted-foreground">{label}</p>
      <p className="font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function IssueList({
  issues,
  tone,
}: {
  issues: Array<{ role_slug?: string; permission?: string; code_key: string; message: string }>;
  tone: 'error' | 'warning';
}) {
  return (
    <div className="max-h-52 overflow-auto rounded-md border">
      {issues.map((issue, index) => (
        <div
          key={`${issue.role_slug}-${issue.permission}-${issue.code_key}-${index}`}
          className="grid grid-cols-[10rem_1fr] gap-2 border-b px-3 py-2 text-xs last:border-0"
        >
          <span className={tone === 'error' ? 'font-mono text-destructive' : 'font-mono text-warning-700 dark:text-warning-300'}>
            {issue.role_slug || '—'}
            {issue.permission ? ` · ${issue.permission}` : ''}
          </span>
          <span>{issue.message}</span>
        </div>
      ))}
    </div>
  );
}

function DiffPreview({ job }: { job: RoleMatrixImportJob }) {
  const t = useRoleMatrixImportLabels();
  const changed = job.diff.roles_changed ?? [];
  const added = job.diff.roles_added ?? [];
  const deactivated = job.diff.roles_deactivated ?? [];
  if (!changed.length && !added.length && !deactivated.length) {
    return <p className="mt-3 text-sm text-muted-foreground">{t.noChanges}</p>;
  }
  return (
    <div className="mt-3 space-y-2">
      <p className="text-sm font-medium">{t.diffHeading}</p>
      {added.length ? <p className="text-xs text-success-700 dark:text-success-300">{t.rolesAdded(added.join(', '))}</p> : null}
      {deactivated.length ? (
        <p className="text-xs text-warning-700 dark:text-warning-300">{t.rolesDeactivated(deactivated.join(', '))}</p>
      ) : null}
      {changed.length ? (
        <div className="max-h-48 overflow-auto rounded-md border">
          {changed.map((role) => (
            <div key={role.role_slug} className="border-b px-3 py-2 text-xs last:border-0">
              <p className="font-medium">{role.role_slug}</p>
              {(role.added ?? []).map((perm) => (
                <span key={perm} className="me-1 inline-block text-success-700 dark:text-success-300">+{perm}</span>
              ))}
              {(role.removed ?? []).map((perm) => (
                <span key={perm} className="me-1 inline-block text-destructive">-{perm}</span>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function TemplateDownloads({
  label,
  onDownload,
}: {
  label: string;
  onDownload: (format: 'xlsx' | 'csv' | 'json') => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex gap-2">
        {(['xlsx', 'csv', 'json'] as const).map((format) => (
          <Button key={format} type="button" variant="outline" size="sm" onClick={() => onDownload(format)}>
            <Download className="me-1 h-3.5 w-3.5" />
            {format.toUpperCase()}
          </Button>
        ))}
      </div>
    </div>
  );
}
