'use client';

import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface ClassificationUsageBadgeLabels {
  matters: (n: number) => string;
  tooltip: string;
}

const defaultLabels: ClassificationUsageBadgeLabels = {
  matters: (n) => (n === 1 ? '1 matter' : `${n} matters`),
  tooltip: 'Matters using this classification',
};

interface Props {
  count: number | undefined;
  loading?: boolean;
  labels?: Partial<ClassificationUsageBadgeLabels>;
}

export function ClassificationUsageBadge({ count, loading, labels }: Props) {
  const t = { ...defaultLabels, ...labels };

  if (loading) {
    return (
      <Badge variant="outline" className="text-muted-foreground" aria-hidden>
        —
      </Badge>
    );
  }

  const value = count ?? 0;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant={value > 0 ? 'secondary' : 'outline'}
            className={cn(value === 0 && 'text-muted-foreground')}
          >
            {t.matters(value)}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{t.tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
