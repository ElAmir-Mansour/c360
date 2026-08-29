'use client';

import { Check, Minus, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CoverageCell as CoverageCellData } from '../../_lib/escalation-coverage';
import type { CoverageLabels } from '../../_lib/escalation-coverage-i18n';

interface CoverageCellProps {
  cell: CoverageCellData;
  /** Code of the row entity, used for the GREEN tooltip. */
  entityCode: string;
  labels: CoverageLabels;
  /** When true, RED/AMBER cells are actionable (open the assign dialog). */
  interactive: boolean;
  onAssign: () => void;
}

const STATUS_STYLES: Record<
  CoverageCellData['status'],
  { box: string; icon: typeof Check }
> = {
  bound: {
    box: 'bg-success-500/15 text-success-700 ring-1 ring-inset ring-success-500/30',
    icon: Check,
  },
  inherited: {
    box: 'bg-warning-300/15 text-warning-700 dark:text-warning-300 ring-1 ring-inset ring-warning-500/30',
    icon: Minus,
  },
  none: {
    box: 'bg-rose-500/15 text-rose-700 ring-1 ring-inset ring-rose-500/35',
    icon: X,
  },
};

export function CoverageCell({
  cell,
  entityCode,
  labels,
  interactive,
  onAssign,
}: CoverageCellProps) {
  const { status } = cell;
  const style = STATUS_STYLES[status];
  const Icon = style.icon;

  const title =
    status === 'bound'
      ? labels.cellBound(entityCode)
      : status === 'inherited'
        ? labels.cellInherited(cell.sourceEntityCode ?? '')
        : labels.cellNone;

  const actionable = interactive && status !== 'bound';
  const fullTitle = actionable ? `${title} — ${labels.cellAssignHint}` : title;

  const className = cn(
    'grid h-7 w-7 place-items-center rounded-md transition-colors',
    style.box,
    actionable &&
      'cursor-pointer hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
  );

  const content = <Icon className="h-3.5 w-3.5" aria-hidden />;

  if (actionable) {
    return (
      <button type="button" className={className} title={fullTitle} onClick={onAssign}>
        <span className="sr-only">{fullTitle}</span>
        {content}
      </button>
    );
  }

  return (
    <span className={className} title={fullTitle} role="img" aria-label={fullTitle}>
      {content}
    </span>
  );
}
