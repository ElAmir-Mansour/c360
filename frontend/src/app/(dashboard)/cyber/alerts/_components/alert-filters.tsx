import type { FetchParams, FilterConfig } from '@/types/table';
import type { MITRETacticItem } from '@/types/cyber';

import { ALERT_RULE_TYPE_OPTIONS, ALERT_STATUS_OPTIONS } from '@/lib/cyber-alerts';
import { alertLabels } from '../_lib/alerts-i18n';

type AlertFilterLabels = (typeof alertLabels)['en']['filters'];

export function buildAlertFilters(
  tactics: MITRETacticItem[],
  labels: AlertFilterLabels = alertLabels.en.filters,
): FilterConfig[] {
  return [
    {
      key: 'severity',
      label: labels.severity,
      type: 'multi-select',
      options: [
        { label: labels.critical, value: 'critical' },
        { label: labels.high, value: 'high' },
        { label: labels.medium, value: 'medium' },
        { label: labels.low, value: 'low' },
        { label: labels.info, value: 'info' },
      ],
    },
    {
      key: 'status',
      label: labels.status,
      type: 'multi-select',
      options: ALERT_STATUS_OPTIONS.map((option) => ({
        label: option.label,
        value: option.value,
      })),
    },
    {
      key: 'mitre_tactic_id',
      label: labels.mitreTactic,
      type: 'select',
      options: tactics.map((tactic) => ({
        label: `${tactic.id} · ${tactic.name}`,
        value: tactic.id,
      })),
    },
    {
      key: 'confidence_range',
      label: labels.confidence,
      type: 'range',
      min: 0,
      max: 100,
      step: 5,
      valueSuffix: '%',
    },
    {
      key: 'date_range',
      label: labels.dateRange,
      type: 'date-range',
    },
    {
      key: 'rule_type',
      label: labels.ruleType,
      type: 'select',
      options: ALERT_RULE_TYPE_OPTIONS.map((option) => ({
        label: option.label,
        value: option.value,
      })),
    },
  ];
}

export function flattenAlertFetchParams(params: FetchParams): Record<string, unknown> {
  const flat: Record<string, unknown> = {
    page: params.page,
    per_page: params.per_page,
    sort: params.sort,
    order: params.order,
    search: params.search,
  };

  for (const [key, value] of Object.entries(params.filters ?? {})) {
    if (!value) {
      continue;
    }
    if (key === 'date_range' && typeof value === 'string') {
      const [from, to] = value.split(',');
      if (from) {
        flat.date_from = from;
      }
      if (to) {
        flat.date_to = to;
      }
      continue;
    }
    if (key === 'confidence_range' && typeof value === 'string') {
      const [minRaw, maxRaw] = value.split(',');
      const min = Number(minRaw);
      const max = Number(maxRaw);
      if (Number.isFinite(min)) {
        flat.min_confidence = min / 100;
      }
      if (Number.isFinite(max)) {
        flat.max_confidence = max / 100;
      }
      continue;
    }
    flat[key] = value;
  }

  return flat;
}
