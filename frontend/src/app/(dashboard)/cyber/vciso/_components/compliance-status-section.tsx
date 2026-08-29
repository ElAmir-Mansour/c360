'use client';
import type { ComplianceFramework } from '@/types/cyber';
import { useVcisoLabels } from '../_lib/vciso-i18n';

const statusConfig = {
  compliant: {
    className: 'bg-primary/15 text-primary',
    barClassName: 'bg-primary',
  },
  partial: {
    className: 'bg-warning-50 text-warning-700 dark:bg-warning-700/15 dark:text-warning-300',
    barClassName: 'bg-severity-medium',
  },
  non_compliant: {
    className: 'bg-error-50 text-error-700 dark:bg-error-700/15 dark:text-error-300',
    barClassName: 'bg-severity-critical',
  },
} satisfies Record<
  ComplianceFramework['status'],
  { className: string; barClassName: string }
>;

export function ComplianceStatusSection({
  frameworks,
}: {
  frameworks: ComplianceFramework[];
}) {
  const t = useVcisoLabels();
  const statusLabel: Record<ComplianceFramework['status'], string> = {
    compliant: t.compliance.compliant,
    partial: t.compliance.partial,
    non_compliant: t.compliance.nonCompliant,
  };
  const list = Array.isArray(frameworks) ? frameworks : [];

  if (list.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        {t.compliance.none}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {list.map((fw) => {
        const config = statusConfig[fw.status];

        return (
          <div key={fw.name} className="rounded-lg border bg-card p-4 space-y-3">
            {/* Name + status badge */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-foreground">{fw.name}</span>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${config.className}`}
              >
                {statusLabel[fw.status]}
              </span>
            </div>

            {/* Coverage progress bar */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{t.compliance.coverage}</span>
                <span className="font-medium tabular-nums">
                  {fw.coverage_percent.toFixed(0)}%
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-2 rounded-full transition-all duration-500 ${config.barClassName}`}
                  style={{ width: `${Math.min(fw.coverage_percent, 100)}%` }}
                />
              </div>
            </div>

            {/* Controls passed */}
            <p className="text-xs text-muted-foreground">
              {t.compliance.controlsPassed(fw.controls_passed, fw.controls_total)}
            </p>
          </div>
        );
      })}
    </div>
  );
}
