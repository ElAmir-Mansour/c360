'use client';

import Link from 'next/link';
import { ArrowRight, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { SectionCard } from '@/components/suites/section-card';
import { EmptyState } from '@/components/common/empty-state';
import { cn } from '@/lib/utils';
import type { ActaCommitteeCompliance } from '@/types/suites';
import { useActaCommonLabels, useActaDashboardLabels } from '../_lib/acta-i18n';

interface ActaComplianceBarsProps {
  items: ActaCommitteeCompliance[];
}

export function ActaComplianceBars({ items }: ActaComplianceBarsProps) {
  const common = useActaCommonLabels();
  const t = useActaDashboardLabels();
  return (
    <SectionCard
      title={t.complianceTitle}
      description={t.complianceDescription}
      actions={
        <Button variant="ghost" size="sm" asChild>
          <Link href="/acta/compliance">
            {common.fullReport}
            <ArrowRight className="ms-1 h-3.5 w-3.5 rtl:-scale-x-100" />
          </Link>
        </Button>
      }
    >
      {items.length === 0 ? (
        <EmptyState
          icon={Shield}
          size="compact"
          title={t.complianceEmptyTitle}
          description={t.complianceEmptyDescription}
        />
      ) : (
        <div className="space-y-4">
          {items.map((item) => (
            <Link
              key={item.committee_id}
              href={`/acta/compliance?committee=${item.committee_id}`}
              className="block rounded-xl border px-4 py-3 transition hover:border-primary"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{item.committee_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.nonCompliantWarnings(item.non_compliant, item.warnings)}
                  </p>
                </div>
                <div className="text-sm font-semibold">{Math.round(item.score)}%</div>
              </div>
              <Progress
                value={item.score}
                indicatorClassName={cn(
                  item.score >= 85
                    ? 'bg-primary'
                    : item.score >= 70
                      ? 'bg-warning-500'
                      : 'bg-error-500',
                )}
                className="mt-3 h-2"
              />
            </Link>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
