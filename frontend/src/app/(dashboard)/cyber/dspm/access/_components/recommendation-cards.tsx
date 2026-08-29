'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { AccessRecommendation } from '@/types/cyber';
import { useDspmLabels } from '../../_lib/dspm-i18n';

interface RecommendationCardsProps {
  recommendations: AccessRecommendation[];
}

function typeBadgeVariant(type: string) {
  switch (type) {
    case 'revoke':
      return 'destructive' as const;
    case 'downgrade':
      return 'warning' as const;
    case 'time_bound':
      return 'default' as const;
    case 'review':
      return 'secondary' as const;
    default:
      return 'outline' as const;
  }
}

function formatLabel(value: string): string {
  return value
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function RecommendationCards({ recommendations }: RecommendationCardsProps) {
  const t = useDspmLabels().accessComponents;
  if (recommendations.length === 0) {
    return (
      <div className="rounded-lg border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        {t.noRecommendations}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {recommendations.map((rec) => (
        <Card key={`${rec.mapping_id}-${rec.type}`}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm">{rec.data_asset_name}</CardTitle>
              <Badge variant={typeBadgeVariant(rec.type)}>{formatLabel(rec.type)}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {formatLabel(rec.permission_type)}
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            <div>
              <p className="text-xs font-medium text-muted-foreground">{t.reason}</p>
              <p className="text-sm">{rec.reason}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">{t.impact}</p>
              <p className="text-sm">{rec.impact}</p>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
              <span className="text-xs text-muted-foreground">{t.riskReduction}</span>
              <span className="text-sm font-semibold text-primary">
                {Math.round(rec.risk_reduction)}%
              </span>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
