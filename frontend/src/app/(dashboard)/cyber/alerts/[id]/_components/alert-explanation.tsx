'use client';

import type { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Lightbulb, ShieldAlert, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { alertConfidencePercent } from '@/lib/cyber-alerts';
import type { CyberAlert } from '@/types/cyber';

import { ConfidenceGauge } from './confidence-gauge';
import { useAlertLabels } from '../../_lib/alerts-i18n';

interface AlertExplanationProps {
  alert: CyberAlert;
}

export function AlertExplanation({ alert }: AlertExplanationProps) {
  const t = useAlertLabels();
  const explanation = alert.explanation;

  return (
    <div className="space-y-6">
      <section className="rounded-softer border bg-gradient-to-br from-secondary to-success-50/60 p-5 shadow-sm dark:from-auth-dark-raised dark:to-success-700/15">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start">
          <ConfidenceGauge score={alertConfidencePercent(alert.confidence_score)} size="md" />
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">
                {t.explanation.summary}
              </p>
              <p className="mt-2 text-sm leading-7 text-foreground">
                {explanation.summary || t.explanation.noSummary}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">
                {t.explanation.whyMatters}
              </p>
              <p className="mt-2 text-sm leading-7 text-foreground">
                {explanation.reason || t.explanation.noReason}
              </p>
            </div>
          </div>
        </div>
      </section>

      <Section icon={CheckCircle2} eyebrow={t.explanation.eyebrow} title={t.explanation.matchedConditions}>
        {(explanation.matched_conditions?.length ?? 0) > 0 ? (
          <div className="flex flex-wrap gap-2">
            {explanation.matched_conditions.map((condition) => (
              <Badge key={condition} variant="secondary">
                {condition}
              </Badge>
            ))}
          </div>
        ) : (
          <EmptyMessage message={t.explanation.noMatchedConditions} />
        )}
      </Section>

      <Section icon={Sparkles} eyebrow={t.explanation.eyebrow} title={t.explanation.confidenceFactors}>
        {(explanation.confidence_factors?.length ?? 0) > 0 ? (
          <div className="space-y-3">
            {explanation.confidence_factors.map((factor, index) => (
              <div key={`${factor.factor}-${index}`} className="rounded-2xl border bg-background px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">{factor.factor}</p>
                  <Badge variant={factor.impact >= 0 ? 'secondary' : 'outline'}>
                    {(factor.impact * 100).toFixed(0)}%
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{factor.description}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyMessage message={t.explanation.noConfidenceFactors} />
        )}
      </Section>

      <Section icon={Lightbulb} eyebrow={t.explanation.eyebrow} title={t.explanation.recommendedActions}>
        {(explanation.recommended_actions?.length ?? 0) > 0 ? (
          <div className="space-y-3">
            {explanation.recommended_actions.map((action, index) => (
              <div key={`${action}-${index}`} className="flex gap-3 rounded-2xl border bg-background px-4 py-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                  {index + 1}
                </span>
                <p className="text-sm text-foreground">{action}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyMessage message={t.explanation.noRecommendedActions} />
        )}
      </Section>

      <Section icon={ShieldAlert} eyebrow={t.explanation.eyebrow} title={t.explanation.falsePositiveIndicators}>
        {(explanation.false_positive_indicators?.length ?? 0) > 0 ? (
          <div className="space-y-2">
            {explanation.false_positive_indicators.map((indicator, index) => (
              <div key={`${indicator}-${index}`} className="rounded-2xl border border-purple-200 bg-purple-50/70 px-4 py-3 text-sm text-purple-900 dark:border-purple-900 dark:bg-purple-950/30 dark:text-purple-200">
                {indicator}
              </div>
            ))}
          </div>
        ) : (
          <EmptyMessage message={t.explanation.noFalsePositiveIndicators} />
        )}
      </Section>

      <Section icon={AlertCircle} eyebrow={t.explanation.eyebrow} title={t.explanation.indicatorMatches}>
        {(explanation.indicator_matches?.length ?? 0) > 0 ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {explanation.indicator_matches?.map((match, index) => (
              <div key={`${match.value}-${index}`} className="rounded-2xl border bg-background px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{match.type}</Badge>
                  <Badge variant="secondary">{Math.round(match.confidence * 100)}%</Badge>
                  <Badge variant="secondary">{match.source}</Badge>
                </div>
                <p className="mt-3 break-all font-mono text-xs text-foreground">{match.value}</p>
                {match.field && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t.explanation.matchedField} <span className="font-mono">{match.field}</span>
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <EmptyMessage message={t.explanation.noIndicatorMatches} />
        )}
      </Section>
    </div>
  );
}

function Section({
  icon: Icon,
  eyebrow,
  title,
  children,
}: {
  icon: typeof AlertCircle;
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-softer border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-primary/15 bg-secondary text-foreground">
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-caps-xwide text-muted-foreground">
            {eyebrow}
          </p>
          <h2 className="text-h4 font-semibold text-foreground">{title}</h2>
        </div>
      </div>
      {children}
    </section>
  );
}

function EmptyMessage({ message }: { message: string }) {
  return <p className="text-sm text-muted-foreground">{message}</p>;
}
