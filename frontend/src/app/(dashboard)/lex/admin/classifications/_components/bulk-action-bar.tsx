'use client';

import { CheckCircle2, Download, Loader2, Trash2, X, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export interface BulkActionBarLabels {
  selected: (n: number) => string;
  activate: string;
  deactivate: string;
  delete: string;
  export: string;
  clear: string;
}

const defaultLabels: BulkActionBarLabels = {
  selected: (n) => `${n} selected`,
  activate: 'Activate',
  deactivate: 'Deactivate',
  delete: 'Delete',
  export: 'Export',
  clear: 'Clear',
};

interface Props {
  count: number;
  canWrite: boolean;
  onActivate: () => void;
  onDeactivate: () => void;
  onDelete: () => void;
  onExport: () => void;
  onClear: () => void;
  busy?: boolean;
  labels?: Partial<BulkActionBarLabels>;
}

export function BulkActionBar({
  count,
  canWrite,
  onActivate,
  onDeactivate,
  onDelete,
  onExport,
  onClear,
  busy,
  labels,
}: Props) {
  const t = { ...defaultLabels, ...labels };
  if (count <= 0) return null;

  return (
    <div
      role="toolbar"
      aria-label={t.selected(count)}
      className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 shadow-sm"
    >
      <Badge variant="secondary" className="shrink-0">
        {t.selected(count)}
      </Badge>
      {busy ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden /> : null}

      <div className="flex flex-1 flex-wrap items-center justify-end gap-1.5">
        {canWrite ? (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              aria-label={t.activate}
              onClick={onActivate}
            >
              <CheckCircle2 className="me-1.5 h-3.5 w-3.5" />
              {t.activate}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              aria-label={t.deactivate}
              onClick={onDeactivate}
            >
              <XCircle className="me-1.5 h-3.5 w-3.5" />
              {t.deactivate}
            </Button>
          </>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          aria-label={t.export}
          onClick={onExport}
        >
          <Download className="me-1.5 h-3.5 w-3.5" />
          {t.export}
        </Button>
        {canWrite ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            aria-label={t.delete}
            onClick={onDelete}
            className="text-destructive hover:text-destructive"
          >
            <Trash2 className="me-1.5 h-3.5 w-3.5" />
            {t.delete}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          aria-label={t.clear}
          onClick={onClear}
        >
          <X className="me-1.5 h-3.5 w-3.5" />
          {t.clear}
        </Button>
      </div>
    </div>
  );
}
