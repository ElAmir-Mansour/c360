'use client';

import { GitBranch, Layers, BarChart3 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { truncate } from '@/lib/format';
import { useFormat } from '@/lib/format/index';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import {
  getTemplateDisplay,
  getTemplateCountLabel,
  useTemplateLocalLabels,
} from './template-i18n';
import type { WorkflowTemplate } from '@/types/models';

interface TemplateCardProps {
  template: WorkflowTemplate;
  onClick: (template: WorkflowTemplate) => void;
}

/**
 * Per-category accent (start-edge bar + tinted category badge + hover ring).
 * Deterministic — the same category always renders the same hue, so color
 * carries meaning across the gallery rather than being decoration. Hues avoid
 * the semantic status ramps (success/warning/destructive) so a colorful card
 * never reads as a state.
 */
const CATEGORY_ACCENTS: Record<string, { bar: string; badge: string; ring: string }> = {
  legal: {
    bar: 'bg-emerald-500/80',
    badge: 'border-transparent bg-emerald-500/10 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300',
    ring: 'hover:ring-emerald-500/30',
  },
  approval: {
    bar: 'bg-sky-500/80',
    badge: 'border-transparent bg-sky-500/10 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300',
    ring: 'hover:ring-sky-500/30',
  },
  onboarding: {
    bar: 'bg-violet-500/80',
    badge: 'border-transparent bg-violet-500/10 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300',
    ring: 'hover:ring-violet-500/30',
  },
  review: {
    bar: 'bg-amber-500/80',
    badge: 'border-transparent bg-amber-500/10 text-amber-700 dark:bg-amber-400/15 dark:text-amber-300',
    ring: 'hover:ring-amber-500/30',
  },
  escalation: {
    bar: 'bg-rose-500/80',
    badge: 'border-transparent bg-rose-500/10 text-rose-700 dark:bg-rose-400/15 dark:text-rose-300',
    ring: 'hover:ring-rose-500/30',
  },
  notification: {
    bar: 'bg-cyan-500/80',
    badge: 'border-transparent bg-cyan-500/10 text-cyan-700 dark:bg-cyan-400/15 dark:text-cyan-300',
    ring: 'hover:ring-cyan-500/30',
  },
  data_pipeline: {
    bar: 'bg-indigo-500/80',
    badge: 'border-transparent bg-indigo-500/10 text-indigo-700 dark:bg-indigo-400/15 dark:text-indigo-300',
    ring: 'hover:ring-indigo-500/30',
  },
  compliance: {
    bar: 'bg-teal-500/80',
    badge: 'border-transparent bg-teal-500/10 text-teal-700 dark:bg-teal-400/15 dark:text-teal-300',
    ring: 'hover:ring-teal-500/30',
  },
};

const DEFAULT_ACCENT = {
  bar: 'bg-slate-400/80',
  badge: 'border-transparent bg-slate-500/10 text-slate-700 dark:bg-slate-400/15 dark:text-slate-300',
  ring: 'hover:ring-slate-400/30',
};

export function TemplateCard({ template, onClick }: TemplateCardProps) {
  const labels = useTemplateLocalLabels();
  const { locale } = useLocaleOrDefault();
  const { formatNumber } = useFormat();
  const stepCount = template.steps?.length ?? 0;
  const variableCount = template.variables ? Object.keys(template.variables).length : 0;
  const usageCount = template.usage_count ?? 0;
  const display = getTemplateDisplay(template, labels, locale);
  const accent = CATEGORY_ACCENTS[template.category ?? ''] ?? DEFAULT_ACCENT;

  return (
    <Card
      className={cn(
        'relative cursor-pointer overflow-hidden ps-1.5 transition-all hover:shadow-md hover:ring-1',
        accent.ring,
      )}
      onClick={() => onClick(template)}
    >
      <span className={cn('absolute inset-y-0 start-0 w-1', accent.bar)} aria-hidden />
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm font-semibold leading-snug line-clamp-2">
            {display.name}
          </CardTitle>
          <Badge variant="outline" className={cn('text-overline shrink-0', accent.badge)}>
            {display.category}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {display.description && (
          <p className="text-xs text-muted-foreground line-clamp-3">
            {truncate(display.description, 120)}
          </p>
        )}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <GitBranch className="h-3 w-3" />
            {getTemplateCountLabel(labels, 'step', stepCount, formatNumber(stepCount))}
          </span>
          <span className="flex items-center gap-1">
            <Layers className="h-3 w-3" />
            {getTemplateCountLabel(labels, 'variable', variableCount, formatNumber(variableCount))}
          </span>
          <span className="flex items-center gap-1">
            <BarChart3 className="h-3 w-3" />
            {getTemplateCountLabel(labels, 'use', usageCount, formatNumber(usageCount))}
          </span>
        </div>
        {(template.tags?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1">
            {display.tags.slice(0, 4).map((tag, index) => (
              <Badge key={`${template.tags![index]}-${tag}`} variant="outline" className="text-overline">
                {tag}
              </Badge>
            ))}
            {template.tags!.length > 4 && (
              <Badge variant="outline" className="text-overline">
                +{template.tags!.length - 4}
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
