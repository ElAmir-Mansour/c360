'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, GitMerge, Loader2 } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import type { CaseClassification } from '@/lib/lex/admin';

export interface MergeClassificationDialogLabels {
  title: string;
  description: string;
  sourceLabel: string;
  targetLabel: string;
  targetPlaceholder: string;
  noTargets: string;
  impact: (count: number) => string;
  systemBlockedTitle: string;
  systemBlockedDescription: string;
  inactiveSuffix: string;
  cancel: string;
  confirm: string;
}

const defaultLabels: MergeClassificationDialogLabels = {
  title: 'Merge classification',
  description: 'Move every matter to a target classification and deactivate the source.',
  sourceLabel: 'Source',
  targetLabel: 'Merge into',
  targetPlaceholder: 'Select a target classification',
  noTargets: 'No eligible target classifications are available.',
  impact: (count) =>
    `${count === 1 ? '1 matter' : `${count} matters`} will be reassigned to the target, then the source is deactivated. This cannot be undone.`,
  systemBlockedTitle: 'System classification',
  systemBlockedDescription: 'System classifications cannot be merged.',
  inactiveSuffix: 'inactive',
  cancel: 'Cancel',
  confirm: 'Merge',
};

interface Props {
  source: CaseClassification | null;
  open: boolean;
  options: CaseClassification[];
  usageCount?: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: (targetId: string) => Promise<void>;
  loading?: boolean;
  labels?: Partial<MergeClassificationDialogLabels>;
}

function isDescendantOf(candidate: CaseClassification, ancestor: CaseClassification): boolean {
  return candidate.path.includes(ancestor.id);
}

function compare(a: CaseClassification, b: CaseClassification): number {
  return a.sort - b.sort || a.code.localeCompare(b.code);
}

export function MergeClassificationDialog({
  source,
  open,
  options,
  usageCount,
  onOpenChange,
  onConfirm,
  loading,
  labels,
}: Props) {
  const { locale } = useLocaleOrDefault();
  const t = { ...defaultLabels, ...labels };
  const [targetId, setTargetId] = useState('');

  useEffect(() => {
    if (open) setTargetId('');
  }, [open, source]);

  const blocked = Boolean(source?.is_system);

  const targets = useMemo(
    () =>
      [...options]
        .filter((candidate) => {
          if (!source) return false;
          if (candidate.id === source.id) return false;
          if (!candidate.active) return false;
          if (isDescendantOf(candidate, source)) return false;
          return true;
        })
        .sort(compare),
    [options, source],
  );

  const matters = usageCount ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitMerge className="h-4 w-4 text-muted-foreground" aria-hidden />
            {t.title}
          </DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>

        {source ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>{t.sourceLabel}</Label>
              <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
                <p className="truncate text-sm font-medium">
                  {resolveLocalized(source.name, locale) || source.code}
                </p>
                <span className="font-mono text-xs text-muted-foreground">{source.code}</span>
              </div>
            </div>

            {blocked ? (
              <Alert variant="warning">
                <AlertTriangle className="h-4 w-4" aria-hidden />
                <AlertTitle>{t.systemBlockedTitle}</AlertTitle>
                <AlertDescription>{t.systemBlockedDescription}</AlertDescription>
              </Alert>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="merge-target">{t.targetLabel}</Label>
                  <Select value={targetId} onValueChange={setTargetId} disabled={targets.length === 0}>
                    <SelectTrigger id="merge-target">
                      <SelectValue placeholder={t.targetPlaceholder} />
                    </SelectTrigger>
                    <SelectContent>
                      {targets.map((candidate) => (
                        <SelectItem key={candidate.id} value={candidate.id}>
                          {`${candidate.path.length ? `${'--'.repeat(Math.min(candidate.path.length, 4))} ` : ''}${
                            resolveLocalized(candidate.name, locale) || candidate.code
                          } (${candidate.code})`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {targets.length === 0 ? (
                    <p className="text-xs text-muted-foreground">{t.noTargets}</p>
                  ) : null}
                </div>

                <Alert variant="warning">
                  <AlertTriangle className="h-4 w-4" aria-hidden />
                  <AlertDescription>{t.impact(matters)}</AlertDescription>
                </Alert>
              </>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {t.cancel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={blocked || loading || !targetId || !source}
            onClick={() => {
              if (targetId) void onConfirm(targetId);
            }}
          >
            {loading ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : null}
            {t.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
