'use client';

import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { TONE_THEME_CLASS, type StatTone } from '@/components/shared/stat-card';

interface ModelCardProps {
  label: string;
  value: string | number;
  helper?: string;
  /**
   * Optional semantic tonal accent. Defaults to `"neutral"` (legacy flat card).
   * When toned, rides the materialized `.kpi-card-themed` / `.kpi-theme-*`
   * surfaces (faded gradient + orb + border + accented label) while the value
   * text stays neutral (`text-foreground`) — a decorative accent only.
   */
  tone?: StatTone;
  className?: string;
}

export function ModelCard({ label, value, helper, tone = 'neutral', className }: ModelCardProps) {
  const toned = tone !== 'neutral';

  if (toned) {
    return (
      <div className={cn('kpi-card-themed', TONE_THEME_CLASS[tone], className)}>
        <p className="text-xs font-semibold uppercase tracking-caps-xwide text-[color:var(--kpi-accent)]">
          {label}
        </p>
        <p className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{value}</p>
        {helper ? <p className="mt-2 text-sm text-muted-foreground">{helper}</p> : null}
      </div>
    );
  }

  return (
    <Card className={cn('overflow-hidden border-border/70 bg-card/80', className)}>
      <CardContent className="space-y-2 p-5">
        <p className="text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">
          {label}
        </p>
        <p className="text-3xl font-semibold tracking-tight">{value}</p>
        {helper ? <p className="text-sm text-muted-foreground">{helper}</p> : null}
      </CardContent>
    </Card>
  );
}
