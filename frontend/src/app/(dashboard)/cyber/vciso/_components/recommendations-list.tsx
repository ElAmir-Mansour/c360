'use client';
import { useState } from 'react';
import { ChevronRight, CheckCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { VCISORecommendation } from '@/types/cyber';
import { useVcisoLabels } from '../_lib/vciso-i18n';

const effortColors: Record<VCISORecommendation['effort'], string> = {
  low: 'bg-primary/15 text-primary',
  medium: 'bg-warning-50 text-warning-700 dark:bg-warning-700/15 dark:text-warning-300',
  high: 'bg-error-50 text-error-700 dark:bg-error-700/15 dark:text-error-300',
};

export function RecommendationsList({
  recommendations,
}: {
  recommendations: VCISORecommendation[];
}) {
  const t = useVcisoLabels();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  if (!recommendations || recommendations.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        {t.recs.none}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {recommendations.map((rec, idx) => {
        const isExpanded = expandedIds.has(rec.id);

        return (
          <div
            key={rec.id ?? idx}
            className="rounded-lg border bg-card overflow-hidden"
          >
            {/* Collapsed header — always visible */}
            <button
              type="button"
              onClick={() => toggleExpand(rec.id)}
              className="flex w-full items-center gap-3 p-4 text-start hover:bg-muted/40 transition-colors"
            >
              {/* Priority badge */}
              <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                {rec.priority}
              </span>

              {/* Title */}
              <span className="flex-1 text-sm font-semibold text-foreground leading-snug">
                {rec.title}
              </span>

              {/* Category badge */}
              <Badge variant="secondary" className="hidden sm:inline-flex text-xs">
                {rec.category}
              </Badge>

              {/* Effort */}
              <span
                className={`hidden sm:inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${effortColors[rec.effort]}`}
              >
                {t.recs.effortSuffix(rec.effort)}
              </span>

              {/* Risk reduction */}
              <span className="hidden sm:inline text-xs font-medium text-primary whitespace-nowrap">
                {t.recs.ptsSuffix(rec.estimated_risk_reduction)}
              </span>

              {/* Chevron */}
              <ChevronRight
                className={`h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform duration-200 ${
                  isExpanded ? 'rotate-90' : ''
                }`}
              />
            </button>

            {/* Expanded content */}
            {isExpanded && (
              <div className="border-t bg-muted/20 px-4 pb-4 pt-3 space-y-4">
                {/* Mobile badges */}
                <div className="flex flex-wrap gap-2 sm:hidden">
                  <Badge variant="secondary" className="text-xs">
                    {rec.category}
                  </Badge>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${effortColors[rec.effort]}`}
                  >
                    {t.recs.effortSuffix(rec.effort)}
                  </span>
                  <span className="text-xs font-medium text-primary">
                    {t.recs.ptsSuffix(rec.estimated_risk_reduction)}
                  </span>
                </div>

                {/* Description */}
                <p className="text-sm text-muted-foreground">{rec.description}</p>

                {/* Actions checklist */}
                {(rec.actions ?? []).length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t.recs.actions}
                    </p>
                    <ul className="space-y-1">
                      {(rec.actions ?? []).map((action, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm">
                          <CheckCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                          <span className="text-foreground">{action}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Impact */}
                <div className="rounded-md border border-blue-100 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-700 dark:text-blue-300 mb-0.5">
                    {t.recs.expectedImpact}
                  </p>
                  <p className="text-sm text-blue-800 dark:text-blue-200">{rec.impact}</p>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
