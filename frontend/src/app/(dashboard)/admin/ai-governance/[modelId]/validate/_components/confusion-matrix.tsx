'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatNumber, formatPercentage } from '@/lib/format';
import { useT } from '@/components/providers/locale-provider';
import type { AIValidationResult } from '@/types/ai-governance';

interface ConfusionMatrixProps {
  result: AIValidationResult;
}

function matrixCellClass(kind: 'tp' | 'fp' | 'tn' | 'fn') {
  switch (kind) {
    case 'tp':
    case 'tn':
      return 'border-primary/30 bg-primary/90';
    case 'fp':
      return 'border-error-300/60 bg-error-50/90 dark:border-error-700/50 dark:bg-error-700/20';
    default:
      return 'border-warning-300/60 bg-warning-50/90 dark:border-warning-700/50 dark:bg-warning-700/20';
  }
}

function cellShare(value: number, total: number) {
  return total > 0 ? value / total : 0;
}

export function ConfusionMatrix({ result }: ConfusionMatrixProps) {
  const t = useT('admin');
  const total = result.dataset_size;
  const cells = [
    { title: t('cmx.tp'), short: 'TP', value: result.true_positives, kind: 'tp' as const },
    { title: t('cmx.fp'), short: 'FP', value: result.false_positives, kind: 'fp' as const },
    { title: t('cmx.fn'), short: 'FN', value: result.false_negatives, kind: 'fn' as const },
    { title: t('cmx.tn'), short: 'TN', value: result.true_negatives, kind: 'tn' as const },
  ];

  return (
    <Card className="border-border/70">
      <CardHeader>
        <CardTitle>{t('cmx.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {cells.map((cell) => (
            <div
              key={cell.short}
              className={`rounded-2xl border p-4 ${matrixCellClass(cell.kind)}`}
            >
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-foreground/70">
                {cell.short}
              </div>
              <div className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-foreground">
                {formatNumber(cell.value)}
              </div>
              <div className="mt-2 text-sm text-foreground/70">
                {cell.title} • {formatPercentage(cellShare(cell.value, total), 1)}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
