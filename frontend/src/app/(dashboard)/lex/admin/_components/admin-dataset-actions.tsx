'use client';

import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Download, FileJson, FileSpreadsheet, Upload } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { SavedViewsBar } from '@/components/shared/saved-views-bar';
import { showError, showSuccess } from '@/lib/toast';
import {
  exportCsv,
  exportJson,
  parseImportFile,
  type AdminDatasetFormat,
} from '../_lib/admin-feature-utils';
import { useAdminCommonLabels } from '../_lib/admin-labels';

interface Props<T extends Record<string, unknown>> {
  namespace: string;
  filename: string;
  rows: T[];
  activeFilters: Record<string, string | string[]>;
  labels?: {
    savedView?: string;
    importTitle?: string;
    importDescription?: string;
  };
  onImportRows?: (rows: Record<string, unknown>[]) => Promise<void> | void;
  extraActions?: ReactNode;
}

function applyParams(
  router: ReturnType<typeof useRouter>,
  pathname: string,
  current: URLSearchParams,
  params: Record<string, string | string[]>,
) {
  const next = new URLSearchParams(current);
  for (const key of Array.from(next.keys())) {
    if (!['page', 'per_page', 'sort', 'order', 'search'].includes(key)) next.delete(key);
  }
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      next.delete(key);
      value.forEach((v) => next.append(key, v));
    } else if (value) {
      next.set(key, value);
    }
  }
  next.set('page', '1');
  router.push(next.toString() ? `${pathname}?${next.toString()}` : pathname);
}

export function AdminDatasetActions<T extends Record<string, unknown>>({
  namespace,
  filename,
  rows,
  activeFilters,
  labels,
  onImportRows,
  extraActions,
}: Props<T>) {
  const common = useAdminCommonLabels();
  const da = common.datasetActions;
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const searchParams = useSearchParams();
  const fileRef = useRef<HTMLInputElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [previewErrors, setPreviewErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  const currentParams = useMemo(() => new URLSearchParams(searchParams?.toString()), [searchParams]);

  const exportRows = (format: AdminDatasetFormat) => {
    if (format === 'json') exportJson(`${filename}.json`, rows);
    else exportCsv(`${filename}.csv`, rows);
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    const preview = await parseImportFile(file);
    setPreviewRows(preview.rows);
    setPreviewErrors(preview.errors);
    setPreviewOpen(true);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SavedViewsBar
          namespace={namespace}
          activeFilters={activeFilters}
          onApply={(params) => applyParams(router, pathname, currentParams, params)}
          labels={{ save: labels?.savedView ?? da.saveView, saved: da.savedViews }}
        />
        <div className="flex flex-wrap items-center gap-2">
          {extraActions}
          <Button type="button" variant="outline" size="sm" onClick={() => exportRows('csv')}>
            <FileSpreadsheet className="me-1.5 h-3.5 w-3.5" />
            CSV
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => exportRows('json')}>
            <FileJson className="me-1.5 h-3.5 w-3.5" />
            JSON
          </Button>
          {onImportRows ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.json,application/json,text/csv"
                className="hidden"
                onChange={(event) => void handleFile(event.target.files?.[0])}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="me-1.5 h-3.5 w-3.5" />
                {da.import}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{labels?.importTitle ?? da.importTitle}</DialogTitle>
            <DialogDescription>
              {labels?.importDescription ?? da.importDescription}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={previewErrors.length ? 'destructive' : 'secondary'}>
                {previewErrors.length ? da.errorsBadge(previewErrors.length) : da.noParseErrors}
              </Badge>
              <Badge variant="outline">{da.rowsBadge(previewRows.length)}</Badge>
            </div>
            {previewErrors.length ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {previewErrors.join(' ')}
              </div>
            ) : (
              <pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 text-xs">
                {JSON.stringify(previewRows.slice(0, 5), null, 2)}
              </pre>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPreviewOpen(false)}>
              {common.cancel}
            </Button>
            <Button
              type="button"
              disabled={previewErrors.length > 0 || previewRows.length === 0 || importing}
              onClick={async () => {
                try {
                  setImporting(true);
                  await onImportRows?.(previewRows);
                  showSuccess(da.importApplied);
                  setPreviewOpen(false);
                } catch (error) {
                  showError(error instanceof Error ? error.message : da.importFailed);
                } finally {
                  setImporting(false);
                }
              }}
            >
              <Download className="me-1.5 h-3.5 w-3.5 rotate-180" />
              {da.applyImport}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
