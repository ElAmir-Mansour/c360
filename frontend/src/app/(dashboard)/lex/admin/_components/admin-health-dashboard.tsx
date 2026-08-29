'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Info,
  ShieldCheck,
  Stethoscope,
} from 'lucide-react';
import { LexKpiStrip, type LexKpiItem } from '@/components/lex/kpi-strip';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import { lexAdminApi, type CaseClassification } from '@/lib/lex/admin';
import { findOverlappingSegments, type AdminIssue } from '../_lib/admin-feature-utils';
import { useAdminHealthLabels } from '../_lib/admin-labels';

const page = { page: 1, per_page: 200, sort: 'updated_at', order: 'desc' as const };

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function flatten(nodes: CaseClassification[], acc: CaseClassification[] = []): CaseClassification[] {
  for (const node of nodes) {
    acc.push(node);
    if (node.children?.length) flatten(node.children, acc);
  }
  return acc;
}

function stale(updatedAt?: string): boolean {
  if (!updatedAt) return false;
  const age = Date.now() - Date.parse(updatedAt);
  return age > 1000 * 60 * 60 * 24 * 180;
}

/** Severity → row accent + chip presentation. Literal class strings for Tailwind JIT. */
const SEVERITY_PRESENTATION: Record<
  AdminIssue['severity'],
  { row: string; badge: string; icon: typeof AlertOctagon }
> = {
  critical: {
    row: 'border-s-4 border-s-error-500 bg-error-500/5',
    badge: 'badge-base badge-danger',
    icon: AlertOctagon,
  },
  warning: {
    row: 'border-s-4 border-s-warning-500 bg-warning-500/5',
    badge: 'badge-base badge-warning',
    icon: AlertTriangle,
  },
  info: {
    row: 'border-s-4 border-s-info-500 bg-info-500/4',
    badge: 'badge-base badge-info',
    icon: Info,
  },
};

export function AdminHealthDashboard() {
  const { direction } = useLocale();
  const t = useAdminHealthLabels();
  const [issueScope, setIssueScope] = useState<'all' | AdminIssue['severity']>('all');

  const calendars = useQuery({
    queryKey: ['lex-admin-health', 'calendars'],
    queryFn: () => lexAdminApi.listWorkingCalendars(page),
  });
  const services = useQuery({
    queryKey: ['lex-admin-health', 'services'],
    queryFn: () => lexAdminApi.listServiceCatalog(page),
  });
  const sla = useQuery({
    queryKey: ['lex-admin-health', 'sla'],
    queryFn: () => lexAdminApi.listSLATargets(page),
  });
  const attachments = useQuery({
    queryKey: ['lex-admin-health', 'attachments'],
    queryFn: () => lexAdminApi.listAttachmentPolicies(page),
  });
  const orgs = useQuery({
    queryKey: ['lex-admin-health', 'orgs'],
    queryFn: () => lexAdminApi.listOrgEntities(page),
  });
  const tree = useQuery({
    queryKey: ['lex-admin-health', 'classifications'],
    queryFn: () => lexAdminApi.getCaseClassificationTree(),
  });

  const issues = useMemo<AdminIssue[]>(() => {
    const out: AdminIssue[] = [];
    const calendarRows = calendars.data?.data ?? [];
    const serviceRows = services.data?.data ?? [];
    const slaRows = sla.data?.data ?? [];
    const attachmentRows = attachments.data?.data ?? [];
    const orgRows = orgs.data?.data ?? [];
    const classificationRows = flatten(tree.data ?? []);

    const defaultCalendars = calendarRows.filter((cal) => cal.is_default);
    if (calendarRows.length > 0 && defaultCalendars.length === 0) {
      out.push({
        id: 'calendar-default-missing',
        severity: 'critical',
        area: 'Working calendars',
        title: 'No default calendar',
        description: 'SLA and turnaround calculations need exactly one default working calendar.',
        href: '/lex/admin/working-calendars',
      });
    }
    if (defaultCalendars.length > 1) {
      out.push({
        id: 'calendar-default-many',
        severity: 'critical',
        area: 'Working calendars',
        title: 'Multiple default calendars',
        description: `${defaultCalendars.length} calendars are marked as default.`,
        href: '/lex/admin/working-calendars',
      });
    }
    for (const cal of calendarRows) {
      const overlaps = findOverlappingSegments(
        (cal.working_hours ?? []).map((seg) => ({
          profile: seg.profile,
          day_of_week: seg.day_of_week,
          start_minute: seg.start_minute,
          end_minute: seg.end_minute,
        })),
      );
      if ((cal.working_hours ?? []).length === 0 || overlaps.length > 0) {
        out.push({
          id: `calendar-hours-${cal.id}`,
          severity: overlaps.length ? 'critical' : 'warning',
          area: 'Working calendars',
          title: `${cal.name} needs working-hour review`,
          description: overlaps[0] ?? 'No weekly working-hour segments are configured.',
          href: '/lex/admin/working-calendars',
        });
      }
    }

    for (const service of serviceRows) {
      const sharedMailbox =
        typeof service.metadata?.intake_mailbox === 'string'
          ? service.metadata.intake_mailbox.trim()
          : '';
      if (
        (service.channel === 'email' || service.channel === 'both') &&
        !service.intake_email &&
        !sharedMailbox
      ) {
        out.push({
          id: `service-email-${service.id}`,
          severity: 'warning',
          area: 'Service catalog',
          title: `${service.code} has no intake email`,
          description: 'Email-enabled services should have a mailbox or intake address.',
          href: `/lex/admin/service-catalog/${service.id}`,
        });
      }
      if ((service.requester_approval_required || service.provider_approval_required) && !service.approval_policy_id) {
        out.push({
          id: `service-policy-${service.id}`,
          severity: 'info',
          area: 'Service catalog',
          title: `${service.code} has approval enabled without a linked policy`,
          description: 'Link an approval policy or confirm that the runtime recommendation endpoint supplies one.',
          href: `/lex/admin/service-catalog/${service.id}`,
        });
      }
    }

    const activeServiceCodes = new Set(serviceRows.filter((s) => s.active).map((s) => s.code));
    const slaPairs = new Map<string, number>();
    for (const target of slaRows.filter((row) => row.active)) {
      const key = `${target.service_code}:${target.priority}`;
      slaPairs.set(key, (slaPairs.get(key) ?? 0) + 1);
    }
    for (const service of activeServiceCodes) {
      for (const priority of ['normal', 'urgent']) {
        if (!slaPairs.has(`${service}:${priority}`)) {
          out.push({
            id: `sla-missing-${service}-${priority}`,
            severity: 'warning',
            area: 'SLA targets',
            title: `${service} is missing ${priority} SLA`,
            description: 'Active services should have normal and urgent SLA targets.',
            href: '/lex/admin/sla-targets',
          });
        }
      }
    }
    for (const [key, count] of slaPairs.entries()) {
      if (count > 1) {
        out.push({
          id: `sla-duplicate-${key}`,
          severity: 'critical',
          area: 'SLA targets',
          title: `Duplicate active SLA target for ${key}`,
          description: `${count} active targets match the same service and priority.`,
          href: '/lex/admin/sla-targets',
        });
      }
    }

    for (const policy of attachmentRows) {
      const required = policy.slots?.filter((slot) => slot.required).length ?? 0;
      if (policy.max_attachment_count && policy.min_attachment_count > policy.max_attachment_count) {
        out.push({
          id: `attachment-range-${policy.id}`,
          severity: 'critical',
          area: 'Attachment policies',
          title: `${policy.service_code || policy.request_type} has invalid min/max`,
          description: 'Minimum attachment count is greater than maximum attachment count.',
          href: '/lex/admin/attachment-policies',
        });
      }
      if (required > policy.max_attachment_count && policy.max_attachment_count > 0) {
        out.push({
          id: `attachment-required-${policy.id}`,
          severity: 'warning',
          area: 'Attachment policies',
          title: `${policy.service_code || policy.request_type} has too many required slots`,
          description: 'Required slots exceed the maximum attachment count.',
          href: '/lex/admin/attachment-policies',
        });
      }
    }

    const escalationRoles = new Set(['section_supervisor', 'department_manager', 'shared_services_manager']);
    for (const org of orgRows.filter((row) => row.active)) {
      const roleKeys = new Set((org.roles ?? []).map((role) => role.role_key));
      const missing = [...escalationRoles].filter((role) => !roleKeys.has(role as never));
      if (missing.length > 0 && org.entity_type !== 'company') {
        out.push({
          id: `org-roles-${org.id}`,
          severity: 'info',
          area: 'Org registry',
          title: `${org.code} has incomplete escalation roles`,
          description: `Missing ${missing.join(', ')}.`,
          href: `/lex/admin/org-entities/${org.id}`,
        });
      }
    }

    if (classificationRows.length === 0) {
      out.push({
        id: 'classification-empty',
        severity: 'warning',
        area: 'Case classifications',
        title: 'No classification taxonomy',
        description: 'Legal cases need at least the base classification tree.',
        href: '/lex/admin/classifications',
      });
    }
    for (const row of [...calendarRows, ...serviceRows, ...slaRows, ...attachmentRows, ...orgRows, ...classificationRows]) {
      if (stale(row.updated_at)) {
        out.push({
          id: `stale-${row.id}`,
          severity: 'info',
          area: 'Stale configuration',
          title: `${'code' in row ? row.code : 'name' in row ? row.name : row.id} has not changed recently`,
          description: 'Review records older than 180 days to confirm they still match policy.',
        });
      }
    }

    return out;
  }, [attachments.data, calendars.data, orgs.data, services.data, sla.data, tree.data]);

  const critical = issues.filter((issue) => issue.severity === 'critical').length;
  const warnings = issues.filter((issue) => issue.severity === 'warning').length;
  const info = issues.filter((issue) => issue.severity === 'info').length;
  const criticalShare = percent(critical, issues.length);
  const warningShare = percent(warnings, issues.length);
  const infoShare = percent(info, issues.length);
  const loading =
    calendars.isLoading ||
    services.isLoading ||
    sla.isLoading ||
    attachments.isLoading ||
    orgs.isLoading ||
    tree.isLoading;

  const kpis: LexKpiItem[] = [
    {
      id: 'issues',
      label: t.kpiIssues,
      value: issues.length,
      theme: issues.length ? 'pink' : 'emerald',
      icon: Stethoscope,
      loading,
      detail: t.kpiIssues,
      detailValue: issues.length,
      onAction: () => setIssueScope('all'),
      pressed: issueScope === 'all',
    },
    {
      id: 'critical',
      label: t.kpiCritical,
      value: critical,
      theme: critical ? 'red' : 'emerald',
      icon: AlertOctagon,
      loading,
      progress: criticalShare,
      progressLabel: t.kpiIssues,
      detail: t.kpiIssues,
      detailValue: `${criticalShare}%`,
      onAction: () => setIssueScope('critical'),
      pressed: issueScope === 'critical',
    },
    {
      id: 'warnings',
      label: t.kpiWarnings,
      value: warnings,
      theme: warnings ? 'amber' : 'emerald',
      icon: AlertTriangle,
      loading,
      progress: warningShare,
      progressLabel: t.kpiIssues,
      detail: t.kpiIssues,
      detailValue: `${warningShare}%`,
      onAction: () => setIssueScope('warning'),
      pressed: issueScope === 'warning',
    },
    {
      id: 'info',
      label: t.kpiHealthy,
      value: info,
      theme: 'primary',
      icon: ShieldCheck,
      loading,
      progress: infoShare,
      progressLabel: t.kpiIssues,
      detail: t.kpiIssues,
      detailValue: `${infoShare}%`,
      onAction: () => setIssueScope('info'),
      pressed: issueScope === 'info',
    },
  ];

  const scopedIssues =
    issueScope === 'all' ? issues : issues.filter((issue) => issue.severity === issueScope);
  const visible = scopedIssues.slice(0, 8);
  const hidden = scopedIssues.length - visible.length;

  return (
    <div dir={direction} className="space-y-4 motion-safe:animate-fade-up">
      <LexKpiStrip
        items={kpis}
        columns={4}
        appearance="operational"
        className="admin-health-kpi-grid"
      />

      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-elevation-1">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-bg-subtle px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-[image:var(--ds-gradient-primary)] text-primary-foreground">
              <Stethoscope className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-semibold tracking-tight text-foreground">{t.linterTitle}</p>
              <p className="text-xs text-muted-foreground">{t.linterDescription}</p>
            </div>
          </div>
          <span
            className={cn(
              'badge-base',
              scopedIssues.length === 0 ? 'badge-success' : 'badge-neutral',
            )}
          >
            {scopedIssues.length === 0 ? t.healthy : t.findings(scopedIssues.length)}
          </span>
        </div>

        {scopedIssues.length === 0 ? (
          <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-success-500" aria-hidden />
            {t.noIssues}
          </div>
        ) : (
          <div className="space-y-2.5 p-4">
            {visible.map((issue, index) => {
              const present = SEVERITY_PRESENTATION[issue.severity];
              const Icon = present.icon;
              return (
                <div
                  key={issue.id}
                  className={cn(
                    'flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border/50 p-3',
                    'transition-[box-shadow] duration-fast ease-standard',
                    'hover:shadow-elevation-2 motion-safe:animate-fade-up',
                    present.row,
                  )}
                  style={{ animationDelay: `${Math.min(index * 45, 360)}ms` }}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn(present.badge, 'inline-flex items-center gap-1')}>
                        <Icon className="h-3 w-3" aria-hidden />
                        {t.severity[issue.severity]}
                      </span>
                      <span className="text-xs font-medium text-muted-foreground">{issue.area}</span>
                    </div>
                    <p className="mt-1.5 text-sm font-medium text-foreground">{issue.title}</p>
                    <p className="text-xs leading-5 text-muted-foreground">{issue.description}</p>
                  </div>
                  {issue.href ? (
                    <Button
                      asChild
                      variant="ghost"
                      className="group shrink-0 gap-1.5 text-xs"
                    >
                      <Link href={issue.href}>
                        {t.open}
                        <ArrowRight
                          className="h-3.5 w-3.5 transition-transform duration-fast ease-standard group-hover:translate-x-0.5 rtl:-scale-x-100"
                          aria-hidden
                        />
                      </Link>
                    </Button>
                  ) : null}
                </div>
              );
            })}
            {hidden > 0 ? (
              <p className="px-1 pt-1 text-xs font-medium text-muted-foreground">{t.more(hidden)}</p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
