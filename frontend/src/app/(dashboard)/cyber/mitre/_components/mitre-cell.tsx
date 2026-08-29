'use client';

import { AlertTriangle } from 'lucide-react';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { timeAgo } from '@/lib/utils';
import type { MITRETechniqueCoverage } from '@/types/cyber';

import { useMitreLabels } from '../_lib/mitre-i18n';

export type CellState = 'covered' | 'noisy' | 'gap' | 'idle';

const STATE_CLASSES: Record<CellState, string> = {
  covered: 'border-primary/30 bg-primary/10 text-primary',
  noisy: 'border-warning-300 bg-warning-50 text-warning-800',
  gap: 'border-error-300 bg-error-50 text-error-700',
  idle: 'border-primary/15 bg-secondary text-foreground/55',
};

export function MitreCell({
  technique,
  selected,
  highlighted,
  onSelect,
}: {
  technique: MITRETechniqueCoverage;
  selected: boolean;
  highlighted: boolean;
  onSelect: (technique: MITRETechniqueCoverage) => void;
}) {
  const t = useMitreLabels();
  const state = technique.coverage_state;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={[
              'w-full rounded-2xl border p-2 text-start transition hover:shadow-sm',
              STATE_CLASSES[state],
              selected ? 'ring-2 ring-primary' : '',
              highlighted ? 'ring-2 ring-sky-500' : '',
            ].join(' ')}
            onClick={() => onSelect(technique)}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-mono text-[11px] font-semibold">{technique.technique_id}</span>
              {state === 'gap' ? <AlertTriangle className="h-3.5 w-3.5 text-error-500" /> : null}
            </div>
            <p className="mt-1 line-clamp-2 text-[11px] leading-4">{technique.technique_name}</p>
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p className="font-medium">{technique.technique_name}</p>
          <p className="text-xs text-muted-foreground">
            {t.cell.ruleCount(technique.rule_count)} · {t.cell.alertCount(technique.alert_count)}
          </p>
          <p className="text-xs text-muted-foreground">
            {t.cell.activeThreatCount(technique.active_threat_count)}
          </p>
          {technique.rule_names && technique.rule_names.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t.cell.rules(technique.rule_names.slice(0, 3).join(', '), technique.rule_names.length - 3)}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {technique.last_alert_at ? t.cell.lastAlert(timeAgo(technique.last_alert_at)) : t.cell.noRecentAlerts}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
