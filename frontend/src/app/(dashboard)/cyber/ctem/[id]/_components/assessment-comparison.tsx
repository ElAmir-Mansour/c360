'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Minus, BarChart3 } from 'lucide-react';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import type { StatTone } from '@/components/shared/stat-card';
import type { PaginatedResponse } from '@/types/api';
import type { CTEMAssessment } from '@/types/cyber';
import { useCtemLabels, type CtemLabels } from '../../_lib/ctem-i18n';
import { useCyberSeverityLabels } from '../../../_lib/cyber-i18n';

interface ComparisonSide {
  id: string;
  name: string;
  exposure_score?: number;
  findings: Record<string, number>;
}

interface FindingSummary {
  id: string;
  title: string;
  type: string;
  severity: string;
  priority_score: number;
}

interface ComparisonDelta {
  score_change: number;
  score_direction: string;
  findings_new: number;
  findings_resolved: number;
  findings_unchanged: number;
  findings_worsened: number;
  new_findings: FindingSummary[];
  resolved_findings: FindingSummary[];
}

interface AssessmentComparison {
  current: ComparisonSide;
  previous: ComparisonSide;
  delta: ComparisonDelta;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'text-status-error',
  high: 'text-severity-high',
  medium: 'text-yellow-600',
  low: 'text-status-info',
};

interface AssessmentComparisonViewProps {
  assessmentId: string;
}

export function AssessmentComparisonView({ assessmentId }: AssessmentComparisonViewProps) {
  const t = useCtemLabels();
  const [otherId, setOtherId] = useState<string | null>(null);

  // Fetch completed assessments to compare against
  const { data: assessmentsData } = useQuery({
    queryKey: ['cyber-ctem-assessments-completed'],
    queryFn: () =>
      apiGet<PaginatedResponse<CTEMAssessment>>(API_ENDPOINTS.CYBER_CTEM_ASSESSMENTS, {
        per_page: 50,
        status: 'completed',
        sort: 'created_at',
        order: 'desc',
      }),
  });

  const otherAssessments = (assessmentsData?.data ?? []).filter((a) => a.id !== assessmentId);

  const { data: comparisonData, isLoading: comparing } = useQuery({
    queryKey: [`ctem-compare-${assessmentId}-${otherId}`],
    queryFn: () =>
      apiGet<{ data: AssessmentComparison }>(API_ENDPOINTS.CYBER_CTEM_ASSESSMENT_COMPARE(assessmentId, otherId!)),
    enabled: !!otherId,
  });

  const comparison = comparisonData?.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <BarChart3 className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-base font-semibold">{t.comparison.title}</h3>
      </div>

      <div className="flex items-center gap-3">
        <Select value={otherId ?? ''} onValueChange={(v) => setOtherId(v || null)}>
          <SelectTrigger className="w-72">
            <SelectValue placeholder={t.comparison.selectPlaceholder} />
          </SelectTrigger>
          <SelectContent>
            {otherAssessments.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {comparing && <LoadingSkeleton variant="card" />}

      {comparison && (
        <div className="space-y-4">
          {/* Score Comparison */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <ScoreCard label={comparison.current.name} score={comparison.current.exposure_score} variant="current" t={t} />
            <DeltaCard delta={comparison.delta} />
            <ScoreCard label={comparison.previous.name} score={comparison.previous.exposure_score} variant="previous" t={t} />
          </div>

          {/* Findings Summary */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label={t.comparison.newFindings} value={comparison.delta.findings_new} tone="rose" />
            <StatCard label={t.comparison.resolved} value={comparison.delta.findings_resolved} tone="emerald" />
            <StatCard label={t.comparison.unchanged} value={comparison.delta.findings_unchanged} tone="slate" />
            <StatCard label={t.comparison.worsened} value={comparison.delta.findings_worsened} tone="gold" />
          </div>

          {/* Findings by Severity */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <SeverityBreakdown label={t.comparison.current} findings={comparison.current.findings} />
            <SeverityBreakdown label={t.comparison.previous} findings={comparison.previous.findings} />
          </div>

          {/* New Findings List */}
          {comparison.delta.new_findings.length > 0 && (
            <FindingsList title={t.comparison.newFindingsTitle} findings={comparison.delta.new_findings} />
          )}

          {/* Resolved Findings List */}
          {comparison.delta.resolved_findings.length > 0 && (
            <FindingsList title={t.comparison.resolvedFindingsTitle} findings={comparison.delta.resolved_findings} />
          )}
        </div>
      )}

      {!otherId && otherAssessments.length === 0 && (
        <p className="py-4 text-center text-sm text-muted-foreground">
          {t.comparison.noOther}
        </p>
      )}
    </div>
  );
}

function ScoreCard({ label, score, variant, t }: { label: string; score?: number; variant: 'current' | 'previous'; t: CtemLabels }) {
  return (
    <div className="rounded-xl border bg-card p-4 text-center">
      <p className="text-xs font-medium text-muted-foreground">{variant === 'current' ? t.comparison.current : t.comparison.previous}</p>
      <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{label}</p>
      <p className="mt-2 text-3xl font-bold tabular-nums">{score != null ? Math.round(score) : '—'}</p>
      <p className="text-xs text-muted-foreground">{t.comparison.exposureScore}</p>
    </div>
  );
}

function DeltaCard({ delta }: { delta: ComparisonDelta }) {
  const Icon = delta.score_direction === 'worsened' ? ArrowUp : delta.score_direction === 'improved' ? ArrowDown : Minus;
  const color = delta.score_direction === 'worsened' ? 'text-status-error' : delta.score_direction === 'improved' ? 'text-primary' : 'text-muted-foreground';

  return (
    <div className="flex flex-col items-center justify-center rounded-xl border bg-card p-4">
      <Icon className={`h-6 w-6 ${color}`} />
      <p className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>
        {delta.score_change > 0 ? '+' : ''}{delta.score_change.toFixed(1)}
      </p>
      <p className="text-xs capitalize text-muted-foreground">{delta.score_direction}</p>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: StatTone }) {
  return <DetailStatCard label={label} value={value.toLocaleString()} tone={tone} />;
}

function SeverityBreakdown({ label, findings }: { label: string; findings: Record<string, number> }) {
  const sevLabels = useCyberSeverityLabels();
  const severities = ['critical', 'high', 'medium', 'low'];
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="mb-2 text-xs font-semibold text-muted-foreground">{label}</p>
      <div className="flex items-center gap-4">
        {severities.map((sev) => (
          <div key={sev} className="text-center">
            <p className={`text-lg font-bold tabular-nums ${SEVERITY_COLORS[sev] ?? ''}`}>{findings[sev] ?? 0}</p>
            <p className="text-xs capitalize text-muted-foreground">{sevLabels[sev] ?? sev}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function FindingsList({ title, findings }: { title: string; findings: FindingSummary[] }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="mb-2 text-sm font-semibold">{title}</p>
      <div className="space-y-1">
        {findings.map((f) => (
          <div key={f.id} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-muted/20">
            <div className="flex items-center gap-2">
              <span className={`text-xs font-bold capitalize ${SEVERITY_COLORS[f.severity] ?? ''}`}>
                {f.severity.charAt(0).toUpperCase()}
              </span>
              <span className="text-sm">{f.title}</span>
            </div>
            <Badge variant="outline" className="text-xs capitalize">{f.type.replace(/_/g, ' ')}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
