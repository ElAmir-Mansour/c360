'use client';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertTriangle } from 'lucide-react';
import type { DetectionRule } from '@/types/cyber';

import { useRulesLabels } from '../_lib/rules-i18n';

interface RulePerformanceCardProps {
  rule: DetectionRule;
}

export function RulePerformanceCard({ rule }: RulePerformanceCardProps) {
  const t = useRulesLabels();
  const fpRate =
    rule.false_positive_rate ??
    (rule.true_positive_count + rule.false_positive_count > 0
      ? rule.false_positive_count / (rule.true_positive_count + rule.false_positive_count)
      : 0);
  const fpPct = fpRate * 100;
  const fpColor =
    fpPct > 40 ? 'text-error-500 dark:text-error-300' : fpPct > 20 ? 'text-yellow-600 dark:text-yellow-400' : 'text-primary dark:text-primary';

  const tp = rule.true_positive_count ?? rule.tp_count;
  const fp = rule.false_positive_count ?? rule.fp_count;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="tabular-nums text-muted-foreground">{t.performanceCard.triggers(rule.trigger_count.toLocaleString())}</span>
            <span className="text-muted-foreground">·</span>
            <span className={`tabular-nums font-medium ${fpColor}`}>{fpPct.toFixed(1)}{t.performanceCard.fpSuffix}</span>
            {fpPct > 50 && (
              <span className="flex items-center gap-0.5 rounded-full bg-error-100 px-1.5 py-0.5 text-overline font-medium text-error-600 dark:bg-error-700/30 dark:text-error-300">
                <AlertTriangle className="h-2.5 w-2.5" />
                {t.performanceCard.highFp}
              </span>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">
            {t.performanceCard.truePositives(tp !== undefined ? String(tp) : '—')}
            {' · '}
            {t.performanceCard.falsePositives(fp !== undefined ? String(fp) : '—')}
          </p>
          {fpPct > 50 && (
            <p className="text-xs text-error-300">{t.performanceCard.autoDisableRisk}</p>
          )}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
