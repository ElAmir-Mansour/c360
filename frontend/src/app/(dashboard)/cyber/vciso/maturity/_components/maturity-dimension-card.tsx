'use client';

import { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Lightbulb,
  Users,
  Cog,
  Cpu,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { VCISOMaturityDimension, MaturityCategory } from '@/types/cyber';
import { useVcisoGovLabels } from '../../_lib/vciso-i18n';

interface MaturityDimensionCardProps {
  dimension: VCISOMaturityDimension;
  onViewDetails?: (dimension: VCISOMaturityDimension) => void;
}

const CATEGORY_STYLE: Record<
  MaturityCategory,
  { color: string; bgColor: string; icon: typeof Users }
> = {
  people: {
    color: 'text-blue-700 dark:text-blue-400',
    bgColor: 'bg-blue-100 dark:bg-blue-900/30',
    icon: Users,
  },
  process: {
    color: 'text-primary dark:text-primary',
    bgColor: 'bg-primary/15 dark:bg-primary/30',
    icon: Cog,
  },
  technology: {
    color: 'text-purple-700 dark:text-purple-400',
    bgColor: 'bg-purple-100 dark:bg-purple-900/30',
    icon: Cpu,
  },
  governance: {
    color: 'text-indigo-700 dark:text-indigo-400',
    bgColor: 'bg-indigo-100 dark:bg-indigo-900/30',
    icon: Cog,
  },
  security: {
    color: 'text-error-600 dark:text-error-300',
    bgColor: 'bg-error-100 dark:bg-error-700/30',
    icon: Cpu,
  },
  operations: {
    color: 'text-warning-700 dark:text-warning-300',
    bgColor: 'bg-warning-100 dark:bg-warning-800/30',
    icon: Users,
  },
};

function getLevelColor(level: number): string {
  if (level >= 4) return 'text-primary';
  if (level >= 3) return 'text-status-info';
  if (level >= 2) return 'text-warning-700 dark:text-warning-300';
  return 'text-status-error';
}

function getProgressColor(current: number, target: number): string {
  const ratio = target > 0 ? current / target : 0;
  if (ratio >= 0.8) return 'bg-primary';
  if (ratio >= 0.5) return 'bg-severity-medium';
  return 'bg-severity-critical';
}

export function MaturityDimensionCard({
  dimension,
  onViewDetails,
}: MaturityDimensionCardProps) {
  const labels = useVcisoGovLabels().maturity;
  const t = labels.dimension;
  const categoryLabels = labels.categories as Record<string, string>;
  const [expanded, setExpanded] = useState(false);
  const categoryStyle = CATEGORY_STYLE[dimension.category];
  const CategoryIcon = categoryStyle.icon;
  const progressPct =
    dimension.target_level > 0
      ? Math.min((dimension.current_level / dimension.target_level) * 100, 100)
      : 0;

  return (
    <Card className="group overflow-hidden transition-shadow hover:shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1.5 min-w-0">
            <CardTitle className="text-sm font-semibold leading-tight truncate">
              {dimension.name}
            </CardTitle>
            <Badge
              variant="secondary"
              className={cn(
                'text-xs font-medium',
                categoryStyle.bgColor,
                categoryStyle.color,
              )}
            >
              <CategoryIcon className="me-1 h-3 w-3" />
              {categoryLabels[dimension.category] ?? dimension.category}
            </Badge>
          </div>
          <div className="text-end shrink-0">
            <p
              className={cn(
                'text-2xl font-bold tabular-nums',
                getLevelColor(dimension.current_level),
              )}
            >
              {dimension.score.toFixed(1)}
            </p>
            <p className="text-xs text-muted-foreground">{t.score}</p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Level Progress */}
        <div>
          <div className="flex items-center justify-between text-sm mb-1.5">
            <span className="text-muted-foreground">
              {t.levelPrefix(dimension.current_level, dimension.target_level)}
            </span>
            <span className="text-xs font-medium">
              {progressPct.toFixed(0)}%
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500',
                getProgressColor(dimension.current_level, dimension.target_level),
              )}
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Findings & Recommendations counts */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="flex items-center gap-1.5 rounded-lg border p-2">
            <AlertTriangle className="h-3.5 w-3.5 text-warning-700 dark:text-warning-300 shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">{t.findings}</p>
              <p className="text-sm font-semibold tabular-nums">
                {dimension.findings.length}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 rounded-lg border p-2">
            <Lightbulb className="h-3.5 w-3.5 text-status-info shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">{t.recommendations}</p>
              <p className="text-sm font-semibold tabular-nums">
                {dimension.recommendations.length}
              </p>
            </div>
          </div>
        </div>

        {/* Expand/Collapse */}
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? (
            <>
              <ChevronUp className="me-1 h-3.5 w-3.5" />
              {t.hideDetails}
            </>
          ) : (
            <>
              <ChevronDown className="me-1 h-3.5 w-3.5" />
              {t.showDetails}
            </>
          )}
        </Button>

        {expanded && (
          <div className="space-y-3 pt-1">
            {/* Findings List */}
            {dimension.findings.length > 0 && (
              <div>
                <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3 text-warning-700 dark:text-warning-300" />
                  {t.findings}
                </h5>
                <ul className="space-y-1.5">
                  {dimension.findings.map((finding, idx) => (
                    <li
                      key={idx}
                      className="text-sm text-foreground rounded-lg border border-warning-300/40 bg-warning-50/50 dark:bg-warning-700/10 dark:border-warning-700/30 px-3 py-2"
                    >
                      {finding}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {dimension.findings.length > 0 &&
              dimension.recommendations.length > 0 && <Separator />}

            {/* Recommendations List */}
            {dimension.recommendations.length > 0 && (
              <div>
                <h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
                  <Lightbulb className="h-3 w-3 text-status-info" />
                  {t.recommendations}
                </h5>
                <ul className="space-y-1.5">
                  {dimension.recommendations.map((rec, idx) => (
                    <li
                      key={idx}
                      className="text-sm text-foreground rounded-lg border border-info-300/40 bg-info-50/50 dark:bg-info-700/10 dark:border-info-700/30 px-3 py-2"
                    >
                      {rec}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* View Full Details button */}
            {onViewDetails && (
              <>
                <Separator />
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => onViewDetails(dimension)}
                >
                  {t.viewFullDetails}
                </Button>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
