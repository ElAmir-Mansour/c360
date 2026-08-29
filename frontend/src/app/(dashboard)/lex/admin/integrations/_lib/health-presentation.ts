/**
 * Presentation helpers for the integrations list: health-grade dot color, the
 * status-badge config, per-kind grouping + grade rollup, and a bilingual
 * relative-time formatter. Pure + module-local (suite-specific presentation).
 */
import {
  formatDistanceToNowStrict,
  parseISO,
} from 'date-fns';
import { ar as arLocale } from 'date-fns/locale';
import { AlertCircle, Ban, CheckCircle, Clock } from 'lucide-react';
import type { StatusConfig } from '@/lib/status-configs';
import {
  deriveHealthGrade,
  INTEGRATION_KINDS,
  type IntegrationEndpoint,
  type IntegrationHealth,
  type IntegrationHealthGrade,
  type IntegrationKind,
  type IntegrationStatus,
} from '@/lib/lex/integrations';
import type { IntegrationsListLabels } from './integrations-i18n';

/** Tailwind dot background for each health grade (mirrors status-badge dots). */
export const HEALTH_DOT_CLASS: Record<IntegrationHealthGrade, string> = {
  healthy: 'bg-success-500',
  degraded: 'bg-warning-500',
  down: 'bg-error-500',
  unconfigured: 'bg-neutral-400',
  disabled: 'bg-neutral-400',
};

/** KpiCard semantic tone per grade. */
export const HEALTH_TONE: Record<IntegrationHealthGrade, 'emerald' | 'gold' | 'rose' | 'slate'> = {
  healthy: 'emerald',
  degraded: 'gold',
  down: 'rose',
  unconfigured: 'slate',
  disabled: 'slate',
};

/** Status badge config keyed by IntegrationStatus, localized at build time. */
export function statusBadgeConfig(t: IntegrationsListLabels): StatusConfig {
  return {
    planned: { label: t.status.planned, color: 'gray', icon: Clock },
    active: { label: t.status.active, color: 'green', icon: CheckCircle },
    disabled: { label: t.status.disabled, color: 'gray', icon: Ban },
    error: { label: t.status.error, color: 'red', icon: AlertCircle },
  };
}

/** A kind bucket: the kind + its endpoints, possibly empty before setup. */
export interface KindGroup {
  kind: IntegrationKind;
  endpoints: IntegrationEndpoint[];
}

/**
 * Group endpoints by kind in the canonical INTEGRATION_KINDS order, INCLUDING
 * kinds with zero endpoints so the list can render an "+ Configure" empty card.
 */
export function groupByKind(endpoints: IntegrationEndpoint[]): KindGroup[] {
  const byKind = new Map<IntegrationKind, IntegrationEndpoint[]>();
  for (const k of INTEGRATION_KINDS) byKind.set(k, []);
  for (const ep of endpoints) {
    const bucket = byKind.get(ep.kind as IntegrationKind);
    if (bucket) bucket.push(ep);
    else byKind.set(ep.kind as IntegrationKind, [ep]);
  }
  return INTEGRATION_KINDS.map((kind) => ({ kind, endpoints: byKind.get(kind) ?? [] }));
}

/** Index health probes by endpoint id for O(1) lookup. */
export function indexHealth(probes: IntegrationHealth[]): Map<string, IntegrationHealth> {
  const m = new Map<string, IntegrationHealth>();
  for (const p of probes) m.set(p.endpoint_id, p);
  return m;
}

/** Resolve the grade for one endpoint, folding in a fresh probe when present. */
export function gradeFor(
  endpoint: IntegrationEndpoint,
  probe?: IntegrationHealth | null,
): IntegrationHealthGrade {
  return deriveHealthGrade(endpoint, probe ? { reachable: probe.reachable } : null);
}

/** Tally endpoints by grade across the whole tenant for the KPI strip. */
export interface GradeCounts {
  total: number;
  healthy: number;
  degraded: number;
  down: number;
  unconfigured: number;
  disabled: number;
}

export function tallyGrades(
  endpoints: IntegrationEndpoint[],
  health: Map<string, IntegrationHealth>,
): GradeCounts {
  const counts: GradeCounts = {
    total: endpoints.length,
    healthy: 0,
    degraded: 0,
    down: 0,
    unconfigured: 0,
    disabled: 0,
  };
  for (const ep of endpoints) {
    counts[gradeFor(ep, health.get(ep.id))] += 1;
  }
  return counts;
}

/** Worst grade across a kind's endpoints, for the per-kind rollup dot. */
const GRADE_SEVERITY: Record<IntegrationHealthGrade, number> = {
  down: 4,
  degraded: 3,
  unconfigured: 2,
  disabled: 1,
  healthy: 0,
};

export function rollupGrade(
  endpoints: IntegrationEndpoint[],
  health: Map<string, IntegrationHealth>,
): IntegrationHealthGrade | null {
  if (endpoints.length === 0) return null;
  let worst: IntegrationHealthGrade = 'healthy';
  for (const ep of endpoints) {
    const g = gradeFor(ep, health.get(ep.id));
    if (GRADE_SEVERITY[g] > GRADE_SEVERITY[worst]) worst = g;
  }
  return worst;
}

/**
 * Bilingual relative time. date-fns powers EN; AR uses the bundled `ar` locale.
 * Returns "" for nullish input so the caller can render a "never" fallback.
 */
export function relativeTime(
  value: string | null | undefined,
  locale: 'ar' | 'en',
  t: IntegrationsListLabels,
): string {
  if (!value) return '';
  try {
    const d = typeof value === 'string' ? parseISO(value) : value;
    if (Number.isNaN(d.getTime())) return '';
    return formatDistanceToNowStrict(d, {
      addSuffix: true,
      locale: locale === 'ar' ? arLocale : undefined,
    });
  } catch {
    return t.justNow;
  }
}

/** Whether an endpoint is currently in a non-active lifecycle for soft styling. */
export function isInactive(status: IntegrationStatus): boolean {
  return status === 'planned' || status === 'disabled';
}
