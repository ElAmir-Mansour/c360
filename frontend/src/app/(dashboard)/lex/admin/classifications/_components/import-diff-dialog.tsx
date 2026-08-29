'use client';

import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAdminCommonLabels } from '../../_lib/admin-labels';
import type { ImportDiff, ImportDiffRow } from '../../_lib/classification-helpers';

export interface ImportDiffDialogLabels {
  title: string;
  description: string;
  create: string;
  update: string;
  skip: string;
  empty: string;
}

const defaultLabels: ImportDiffDialogLabels = {
  title: 'Review import',
  description: 'Confirm the changes before applying. Skipped rows will not be modified.',
  create: 'Create',
  update: 'Update',
  skip: 'Skip',
  empty: 'No rows to preview.',
};

interface Props {
  open: boolean;
  diff: ImportDiff | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
  applying?: boolean;
  labels?: Partial<ImportDiffDialogLabels>;
}

const ACTION_VARIANT: Record<ImportDiffRow['action'], 'success' | 'default' | 'outline'> = {
  create: 'success',
  update: 'default',
  skip: 'outline',
};

export function ImportDiffDialog({ open, diff, onOpenChange, onConfirm, applying, labels }: Props) {
  const common = useAdminCommonLabels();
  const t = { ...defaultLabels, ...labels };
  const rows = diff?.rows ?? [];
  const createCount = diff?.creates ?? 0;
  const updateCount = diff?.updates ?? 0;
  const skipCount = diff?.skips ?? 0;
  const applyCount = createCount + updateCount;
  const nothingToApply = applyCount === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="success">{t.create} {createCount}</Badge>
          <Badge variant="default">{t.update} {updateCount}</Badge>
          <Badge variant="outline">{t.skip} {skipCount}</Badge>
        </div>

        <ScrollArea className="mt-2 max-h-[50vh] rounded-lg border">
          {rows.length ? (
            <ul className="divide-y">
              {rows.map((row, index) => (
                <li
                  key={`${row.code}-${index}`}
                  className="flex flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge variant={ACTION_VARIANT[row.action]}>{t[row.action]}</Badge>
                    <span className="truncate font-mono text-xs text-muted-foreground">{row.code}</span>
                  </div>
                  {row.changes?.length ? (
                    <div className="flex flex-wrap gap-1 sm:justify-end">
                      {row.changes.map((field) => (
                        <span
                          key={field}
                          className="rounded bg-muted px-1.5 py-0.5 text-caption text-muted-foreground"
                        >
                          {field}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t.empty}</p>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={applying}>
            {common.cancel}
          </Button>
          <Button type="button" onClick={() => void onConfirm()} disabled={applying || nothingToApply}>
            {applying ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
            {common.save}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
