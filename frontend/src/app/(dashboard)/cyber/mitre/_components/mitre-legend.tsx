'use client';

import { useMitreLabels } from '../_lib/mitre-i18n';

export function MitreLegend() {
  const t = useMitreLabels();
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-5 rounded border border-primary/30 bg-primary/10" />
        <span>{t.legend.covered}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-5 rounded border border-warning-300 bg-warning-50 dark:border-warning-800 dark:bg-warning-800/40" />
        <span>{t.legend.noisy}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-5 rounded border border-error-300 bg-error-50 dark:border-error-700 dark:bg-error-700/40" />
        <span>{t.legend.gap}</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-5 rounded border border-primary/15 bg-secondary" />
        <span>{t.legend.idle}</span>
      </div>
    </div>
  );
}
