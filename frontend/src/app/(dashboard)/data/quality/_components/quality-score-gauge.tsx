'use client';

import { GaugeChart } from '@/components/shared/charts/gauge-chart';
import { type QualityScore } from '@/lib/data-suite';
import { useDataLabels } from '@/app/(dashboard)/data/_lib/data-i18n';

interface QualityScoreGaugeProps {
  score: QualityScore;
}

export function QualityScoreGauge({
  score,
}: QualityScoreGaugeProps) {
  const labels = useDataLabels();

  return (
    <div className="flex flex-col items-center justify-center gap-4 rounded-lg border bg-card p-6">
      <GaugeChart value={score.overall_score} size={180} />
      <div className="text-center">
        <div className="text-sm text-muted-foreground">{labels.quality.overallGrade}</div>
        <div className="text-3xl font-semibold">{score.grade}</div>
        <div className="mt-1 text-sm text-muted-foreground">
          {labels.quality.gaugeSummary(
            String(score.passed_rules),
            String(score.failed_rules),
            String(score.warning_rules),
          )}
        </div>
      </div>
    </div>
  );
}
