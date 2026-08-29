import { fetchSuiteData } from '@/lib/suite-api';

export interface WorkforceMetricValue {
  value: number | null;
  available: boolean;
  reason?: string;
  numerator?: number;
  denominator?: number;
  sample?: number;
}

export type WorkforceScopeMode = 'org' | 'self' | 'tenant' | 'unscoped';
export type WorkforceCalendarSource = 'tenant' | 'fallback_utc';
export type WorkforceDomainErrorKind = 'forbidden' | 'query_error';
export type WorkforceAttributionPath = 'direct' | 'linked';
export type WorkforceIdentityStatus = 'resolved' | 'unverified' | 'unknown';
export type WorkforceRelation =
  | 'owner'
  | 'handler'
  | 'advisor'
  | 'reviewer'
  | 'supervisor'
  | 'assignee';

export interface WorkforceScopeEnvelope {
  mode: WorkforceScopeMode;
  entityIds: string[];
  userIds: string[];
  memberCount: number;
  reason?: string;
  warning?: string;
  staleDays?: number;
}

export interface WorkforcePeriodEnvelope {
  from: string;
  to: string;
  timezone: string;
  calendarSource: WorkforceCalendarSource;
  workingDays: WorkforceMetricValue;
}

export interface WorkforceCoverageExclusion {
  domain: string;
  reason: string;
  detail?: string;
}

export interface WorkforceCoverageEnvelope {
  domainsRequested: number;
  domainsReturned: number;
  itemsTotal: number;
  itemsAttributed: number;
  itemsUnattributed: number;
  attributionPct: number;
  rowsReturned: number;
  rowsTruncated: number;
  exclusions: WorkforceCoverageExclusion[];
}

export interface WorkforceDomainError {
  domain: string;
  kind: WorkforceDomainErrorKind;
  detail?: string;
}

export interface WorkforceDomainBreakdown {
  domain: string;
  rel: WorkforceRelation;
  attributionPath: WorkforceAttributionPath;
  open: number;
  resolved: number;
}

export interface WorkforceTeamMemberMetrics {
  activeWorkload: WorkforceMetricValue;
  loadIndexPct: WorkforceMetricValue;
  utilisationPct: WorkforceMetricValue;
  completionRatePct: WorkforceMetricValue;
  onTimePct: WorkforceMetricValue;
  medianCycleDays: WorkforceMetricValue;
  approvalLatencyHrs: WorkforceMetricValue;
  obligationDischargePct: WorkforceMetricValue;
  overdueCount: WorkforceMetricValue;
  idleAssignmentPct: WorkforceMetricValue;
}

export interface WorkforceTeamMember {
  userId: string;
  displayName: string;
  avatarUrl?: string;
  title?: Record<string, string>;
  entityId?: string;
  identityStatus: WorkforceIdentityStatus;
  userStatus: string;
  metrics: WorkforceTeamMemberMetrics;
  byDomain: WorkforceDomainBreakdown[];
  linkedCount: number;
}

export interface WorkforceRollup {
  distributionGini: WorkforceMetricValue;
  keyPersonConcentrationPct: WorkforceMetricValue;
  backlogBurnPct: WorkforceMetricValue;
  unroutedRequests: WorkforceMetricValue;
  aging: Record<string, WorkforceMetricValue>;
}

export interface WorkforceReport {
  scope: WorkforceScopeEnvelope;
  period: WorkforcePeriodEnvelope;
  team: WorkforceTeamMember[];
  rollup: WorkforceRollup;
  coverage: WorkforceCoverageEnvelope;
  degraded: boolean;
  errors: WorkforceDomainError[];
}

export interface WorkforceReportQuery {
  from?: string;
  to?: string;
  scope?: Exclude<WorkforceScopeMode, 'unscoped'>;
  entityId?: string;
  domains?: string[];
  rels?: string[];
  sort?: 'active_workload' | 'completion_rate_pct' | 'display_name';
  limit?: number;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown, path: string): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  return value as JsonRecord;
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  return value;
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new TypeError(`${path} must be a string`);
  return value;
}

function number(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number`);
  }
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${path} must be a boolean`);
  return value;
}

function optionalText(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : text(value, path);
}

function optionalNumber(value: unknown, path: string): number | undefined {
  return value === undefined ? undefined : number(value, path);
}

function enumText<const T extends readonly string[]>(
  value: unknown,
  path: string,
  allowed: T,
): T[number] {
  const candidate = text(value, path);
  if (!allowed.includes(candidate)) {
    throw new TypeError(`${path} must be one of: ${allowed.join(', ')}`);
  }
  return candidate as T[number];
}

function metric(value: unknown, path: string): WorkforceMetricValue {
  const source = record(value, path);
  const available = boolean(source.available, `${path}.available`);
  const rawValue = source.value;
  if (rawValue !== null && typeof rawValue !== 'number') {
    throw new TypeError(`${path}.value must be a number or null`);
  }
  if (available && rawValue === null) {
    throw new TypeError(`${path}.value cannot be null when available is true`);
  }
  const reason = optionalText(source.reason, `${path}.reason`);
  if (!available && !reason) {
    throw new TypeError(`${path}.reason is required when available is false`);
  }
  return {
    value: rawValue as number | null,
    available,
    reason,
    numerator: optionalNumber(source.numerator, `${path}.numerator`),
    denominator: optionalNumber(source.denominator, `${path}.denominator`),
    sample: optionalNumber(source.sample, `${path}.sample`),
  };
}

function stringRecord(value: unknown, path: string): Record<string, string> {
  const source = record(value, path);
  return Object.fromEntries(
    Object.entries(source).map(([key, item]) => [key, text(item, `${path}.${key}`)]),
  );
}

function parseTeamMember(value: unknown, path: string): WorkforceTeamMember {
  const source = record(value, path);
  const metrics = record(source.metrics, `${path}.metrics`);
  return {
    userId: text(source.user_id, `${path}.user_id`),
    displayName: text(source.display_name, `${path}.display_name`),
    avatarUrl: optionalText(source.avatar_url, `${path}.avatar_url`),
    title: source.title === undefined ? undefined : stringRecord(source.title, `${path}.title`),
    entityId: optionalText(source.entity_id, `${path}.entity_id`),
    identityStatus: enumText(source.identity_status, `${path}.identity_status`, ['resolved', 'unverified', 'unknown'] as const),
    userStatus: text(source.user_status, `${path}.user_status`),
    metrics: {
      activeWorkload: metric(metrics.active_workload, `${path}.metrics.active_workload`),
      loadIndexPct: metric(metrics.load_index_pct, `${path}.metrics.load_index_pct`),
      utilisationPct: metric(metrics.utilisation_pct, `${path}.metrics.utilisation_pct`),
      completionRatePct: metric(metrics.completion_rate_pct, `${path}.metrics.completion_rate_pct`),
      onTimePct: metric(metrics.on_time_pct, `${path}.metrics.on_time_pct`),
      medianCycleDays: metric(metrics.median_cycle_days, `${path}.metrics.median_cycle_days`),
      approvalLatencyHrs: metric(metrics.approval_latency_hrs, `${path}.metrics.approval_latency_hrs`),
      obligationDischargePct: metric(metrics.obligation_discharge_pct, `${path}.metrics.obligation_discharge_pct`),
      overdueCount: metric(metrics.overdue_count, `${path}.metrics.overdue_count`),
      idleAssignmentPct: metric(metrics.idle_assignment_pct, `${path}.metrics.idle_assignment_pct`),
    },
    byDomain: array(source.by_domain, `${path}.by_domain`).map((item, index) => {
      const breakdown = record(item, `${path}.by_domain[${index}]`);
      return {
        domain: text(breakdown.domain, `${path}.by_domain[${index}].domain`),
        rel: enumText(breakdown.rel, `${path}.by_domain[${index}].rel`, ['owner', 'handler', 'advisor', 'reviewer', 'supervisor', 'assignee'] as const),
        attributionPath: enumText(
          breakdown.attribution_path,
          `${path}.by_domain[${index}].attribution_path`,
          ['direct', 'linked'] as const,
        ),
        open: number(breakdown.open, `${path}.by_domain[${index}].open`),
        resolved: number(breakdown.resolved, `${path}.by_domain[${index}].resolved`),
      };
    }),
    linkedCount: number(source.linked_count, `${path}.linked_count`),
  };
}

/** Maps and validates the standard suite payload into the camel-cased UI contract. */
export function parseWorkforceReport(value: unknown): WorkforceReport {
  const source = record(value, 'workforce');
  const scope = record(source.scope, 'workforce.scope');
  const period = record(source.period, 'workforce.period');
  const coverage = record(source.coverage, 'workforce.coverage');
  const rollup = record(source.rollup, 'workforce.rollup');
  return {
    scope: {
      mode: enumText(scope.mode, 'workforce.scope.mode', ['org', 'self', 'tenant', 'unscoped'] as const),
      entityIds: array(scope.entity_ids, 'workforce.scope.entity_ids').map((item, index) =>
        text(item, `workforce.scope.entity_ids[${index}]`),
      ),
      userIds: array(scope.user_ids, 'workforce.scope.user_ids').map((item, index) =>
        text(item, `workforce.scope.user_ids[${index}]`),
      ),
      memberCount: number(scope.member_count, 'workforce.scope.member_count'),
      reason: optionalText(scope.reason, 'workforce.scope.reason'),
      warning: optionalText(scope.warning, 'workforce.scope.warning'),
      staleDays: optionalNumber(scope.stale_days, 'workforce.scope.stale_days'),
    },
    period: {
      from: text(period.from, 'workforce.period.from'),
      to: text(period.to, 'workforce.period.to'),
      timezone: text(period.timezone, 'workforce.period.timezone'),
      calendarSource: enumText(
        period.calendar_source,
        'workforce.period.calendar_source',
        ['tenant', 'fallback_utc'] as const,
      ),
      workingDays: metric(period.working_days, 'workforce.period.working_days'),
    },
    team: array(source.team, 'workforce.team').map((item, index) =>
      parseTeamMember(item, `workforce.team[${index}]`),
    ),
    rollup: {
      distributionGini: metric(rollup.distribution_gini, 'workforce.rollup.distribution_gini'),
      keyPersonConcentrationPct: metric(
        rollup.key_person_concentration_pct,
        'workforce.rollup.key_person_concentration_pct',
      ),
      backlogBurnPct: metric(rollup.backlog_burn_pct, 'workforce.rollup.backlog_burn_pct'),
      unroutedRequests: metric(rollup.unrouted_requests, 'workforce.rollup.unrouted_requests'),
      aging: Object.fromEntries(
        Object.entries(record(rollup.aging, 'workforce.rollup.aging')).map(([key, item]) => [
          key,
          metric(item, `workforce.rollup.aging.${key}`),
        ]),
      ),
    },
    coverage: {
      domainsRequested: number(coverage.domains_requested, 'workforce.coverage.domains_requested'),
      domainsReturned: number(coverage.domains_returned, 'workforce.coverage.domains_returned'),
      itemsTotal: number(coverage.items_total, 'workforce.coverage.items_total'),
      itemsAttributed: number(coverage.items_attributed, 'workforce.coverage.items_attributed'),
      itemsUnattributed: number(coverage.items_unattributed, 'workforce.coverage.items_unattributed'),
      attributionPct: number(coverage.attribution_pct, 'workforce.coverage.attribution_pct'),
      rowsReturned: number(coverage.rows_returned, 'workforce.coverage.rows_returned'),
      rowsTruncated: number(coverage.rows_truncated, 'workforce.coverage.rows_truncated'),
      exclusions: array(coverage.exclusions, 'workforce.coverage.exclusions').map((item, index) => {
        const exclusion = record(item, `workforce.coverage.exclusions[${index}]`);
        return {
          domain: text(exclusion.domain, `workforce.coverage.exclusions[${index}].domain`),
          reason: text(exclusion.reason, `workforce.coverage.exclusions[${index}].reason`),
          detail: optionalText(exclusion.detail, `workforce.coverage.exclusions[${index}].detail`),
        };
      }),
    },
    degraded: boolean(source.degraded, 'workforce.degraded'),
    errors: array(source.errors, 'workforce.errors').map((item, index) => {
      const domainError = record(item, `workforce.errors[${index}]`);
      return {
        domain: text(domainError.domain, `workforce.errors[${index}].domain`),
        kind: enumText(domainError.kind, `workforce.errors[${index}].kind`, ['forbidden', 'query_error'] as const),
        detail: optionalText(domainError.detail, `workforce.errors[${index}].detail`),
      };
    }),
  };
}

function workforceParams(query: WorkforceReportQuery): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (query.from) params.from = query.from;
  if (query.to) params.to = query.to;
  if (query.scope) params.scope = query.scope;
  if (query.entityId) params.entity_id = query.entityId;
  if (query.domains?.length) params.domain = query.domains.join(',');
  if (query.rels?.length) params.rel = query.rels.join(',');
  if (query.sort) params.sort = query.sort;
  if (query.limit !== undefined) params.limit = query.limit;
  return params;
}

export async function getWorkforceReport(
  query: WorkforceReportQuery = {},
): Promise<WorkforceReport> {
  const payload = await fetchSuiteData<unknown>(
    '/api/v1/lex/reports/workforce',
    workforceParams(query),
  );
  return parseWorkforceReport(payload);
}
