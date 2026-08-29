'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  FileStack,
  Loader2,
  Mail,
  Search,
  ShieldCheck,
  Timer,
  XCircle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LexRecordPicker } from '@/components/lex/lex-record-picker';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LoadingSkeleton } from '@/components/common/loading-skeleton';
import { ErrorState } from '@/components/common/error-state';
import { StatTile } from '@/components/shared/stat-tile';
import { useLocale } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import { apiGet, apiPost } from '@/lib/api';
import { enterpriseApi } from '@/lib/enterprise/api';
import { fetchSuitePaginated } from '@/lib/suite-api';
import { showApiError } from '@/lib/toast';
import { LEX_ADMIN_ENDPOINTS, lexAdminApi, type AttachmentPolicy, type SLATarget } from '@/lib/lex/admin';
import type { EligibilityDecision } from '@/lib/lex/requests';
import { useServiceCatalogLabels } from '../../_lib/admin-labels';

interface IntakeMailbox {
  id: string;
  address: string;
  request_type: string;
  service_id?: string | null;
  beneficiary_entity_id?: string | null;
  active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface ServiceSLAClock {
  id?: string | null;
  legal_request_id?: string | null;
  request_id?: string | null;
  service_code?: string | null;
  priority?: string | null;
  ack_due_at?: string | null;
  acknowledgement_due_at?: string | null;
  turnaround_due_at?: string | null;
  due_at?: string | null;
  escalation_level?: number | null;
  breached?: boolean | null;
  outcome?: string | null;
  status?: string | null;
  [key: string]: unknown;
}

interface ApiEnvelope<T> {
  data?: T | null;
}

interface Props {
  serviceId: string;
}

function listAll<T>(url: string, filters?: Record<string, string | string[]>): Promise<T[]> {
  return fetchSuitePaginated<T>(url, {
    page: 1,
    per_page: 500,
    order: 'asc',
    filters,
  }).then((res) => res.data);
}

function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function checkEligibility(payload: {
  service_id: string;
  department?: string;
  beneficiary_code?: string;
}): Promise<EligibilityDecision> {
  return apiPost<{ data: EligibilityDecision }>('/api/v1/lex/service-catalog/eligibility-check', payload).then(
    (res) => res.data,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unwrapClock(payload: ServiceSLAClock | ApiEnvelope<ServiceSLAClock> | null): ServiceSLAClock | null {
  if (!isRecord(payload)) return null;
  if ('data' in payload) {
    if (!isRecord(payload.data)) return null;
    return payload.data as ServiceSLAClock;
  }
  return payload as ServiceSLAClock;
}

function getText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function formatDate(value?: string | null, notSet = 'Not set'): string {
  if (!value) return notSet;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

export function ServiceDetailView({ serviceId }: Props) {
  const { locale } = useLocale();
  const labels = useServiceCatalogLabels();
  const dv = labels.detailView;
  const [department, setDepartment] = useState('');
  const [beneficiaryCode, setBeneficiaryCode] = useState('');
  const [clockRequestId, setClockRequestId] = useState('');

  const serviceQuery = useQuery({
    queryKey: ['lex-admin-service-catalog', serviceId],
    queryFn: () => lexAdminApi.getServiceCatalogEntry(serviceId),
    enabled: Boolean(serviceId),
  });

  const service = serviceQuery.data;

  const slaQuery = useQuery({
    queryKey: ['lex-admin-sla-targets', 'service', service?.code],
    queryFn: () => listAll<SLATarget>(LEX_ADMIN_ENDPOINTS.SLA_TARGETS, { service_code: service?.code ?? '' }),
    enabled: Boolean(service?.code),
  });

  const attachmentsQuery = useQuery({
    queryKey: ['lex-admin-attachment-policies', 'service-detail', service?.code, service?.request_type],
    queryFn: () => listAll<AttachmentPolicy>(LEX_ADMIN_ENDPOINTS.ATTACHMENT_POLICIES),
    enabled: Boolean(service),
  });

  const mailboxesQuery = useQuery({
    queryKey: ['lex-admin-intake-mailboxes', 'service-detail'],
    queryFn: () => listAll<IntakeMailbox>('/api/v1/lex/intake/mailboxes'),
    enabled: Boolean(service),
  });

  const orgsQuery = useQuery({
    queryKey: ['lex-admin-org-entities', 'service-detail-options'],
    queryFn: () => lexAdminApi.listOrgEntities({ page: 1, per_page: 500, order: 'asc' }),
    enabled: Boolean(service),
  });

  const policiesQuery = useQuery({
    queryKey: ['lex-approval-policies', 'service-detail'],
    queryFn: () => enterpriseApi.lex.listApprovalPolicies(),
    enabled: Boolean(service?.approval_policy_id),
  });

  const eligibility = useMutation({
    mutationFn: () =>
      checkEligibility({
        service_id: serviceId,
        department: department.trim() || undefined,
        beneficiary_code: beneficiaryCode.trim() || undefined,
      }),
    onError: showApiError,
  });

  const clockLookup = useMutation({
    mutationFn: async () =>
      unwrapClock(
        await apiGet<ServiceSLAClock | ApiEnvelope<ServiceSLAClock> | null>(
          `/api/v1/lex/sla/requests/${encodeURIComponent(clockRequestId.trim())}/clock`,
        ),
      ),
    onError: showApiError,
  });

  const orgs = useMemo(() => orgsQuery.data?.data ?? [], [orgsQuery.data]);
  const departments = useMemo(
    () =>
      unique(
        orgs.filter((org) => org.entity_type === 'department' || org.entity_type === 'section').map((org) => org.code),
      ),
    [orgs],
  );
  const orgCodes = useMemo(() => unique(orgs.map((org) => org.code)), [orgs]);

  const linkedSlas = slaQuery.data ?? [];
  const attachmentPolicies = useMemo(() => {
    const policies = attachmentsQuery.data ?? [];
    if (!service) return [];
    return policies.filter(
      (policy) =>
        policy.service_code === service.code ||
        policy.request_type === service.request_type ||
        (!policy.service_code && !policy.request_type),
    );
  }, [attachmentsQuery.data, service]);

  const mailboxes = useMemo(() => {
    const rows = mailboxesQuery.data ?? [];
    if (!service) return [];
    return rows.filter(
      (mailbox) =>
        mailbox.service_id === service.id ||
        mailbox.request_type === service.request_type ||
        (service.intake_email && mailbox.address === service.intake_email),
    );
  }, [mailboxesQuery.data, service]);

  const approvalPolicy = useMemo(
    () => (policiesQuery.data ?? []).find((policy) => policy.id === service?.approval_policy_id),
    [policiesQuery.data, service?.approval_policy_id],
  );
  const clock = clockLookup.data;
  const clockServiceCode = getText(clock?.service_code);
  const clockMatchesService = !clockServiceCode || clockServiceCode === service?.code;

  if (serviceQuery.isLoading) {
    return <LoadingSkeleton variant="detail" count={2} />;
  }

  if (serviceQuery.isError || !service) {
    return (
      <ErrorState
        title={labels.unavailable}
        message={serviceQuery.error instanceof Error ? serviceQuery.error.message : dv.loadFailed}
        onRetry={() => void serviceQuery.refetch()}
      />
    );
  }

  const serviceName = resolveLocalized(service.name, locale) || service.code;
  const emailReady = service.channel === 'platform' || mailboxes.some((mailbox) => mailbox.active);
  const activeSlas = linkedSlas.filter((sla) => sla.active).length;
  const activeAttachmentPolicies = attachmentPolicies.filter((policy) => policy.active).length;
  const activeMailboxes = mailboxes.filter((mailbox) => mailbox.active).length;
  const slaReadyShare = percent(activeSlas, linkedSlas.length);
  const attachmentReadyShare = percent(activeAttachmentPolicies, attachmentPolicies.length);
  const mailboxReadyShare = percent(activeMailboxes, mailboxes.length);
  const kpiCopy =
    locale === 'ar'
      ? {
          readiness: 'جاهزية نشطة',
          serviceScope: 'نطاق الخدمة',
          active: 'نشط',
          rules: 'قواعد',
        }
      : {
          readiness: 'Active readiness',
          serviceScope: 'Service scope',
          active: 'Active',
          rules: 'Rules',
        };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-h3 font-semibold">{serviceName}</h2>
            <Badge variant={service.active ? 'default' : 'outline'}>{service.active ? dv.published : dv.draft}</Badge>
            {!emailReady ? <Badge variant="destructive">{dv.mailboxMissing}</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {service.code} · {service.request_type}
          </p>
        </div>
        <div className="text-end text-xs text-muted-foreground">
          <p>
            {dv.createdPrefix} {formatDate(service.created_at, dv.notSet)}
          </p>
          <p>
            {dv.updatedPrefix} {formatDate(service.updated_at, dv.notSet)}
          </p>
        </div>
      </div>

      <div className="service-detail-kpi-grid grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label={labels.kpis.sla}
          value={linkedSlas.length}
          themeClass="kpi-theme-primary"
          icon={Timer}
          loading={slaQuery.isLoading}
          progress={slaReadyShare}
          progressLabel={kpiCopy.readiness}
          detail={kpiCopy.serviceScope}
          detailValue={`${slaReadyShare}%`}
          size="md"
          appearance="operational"
          className="service-detail-kpi-card"
          href="#service-detail-sla"
        />
        <StatTile
          label={labels.kpis.attachments}
          value={attachmentPolicies.length}
          themeClass="kpi-theme-amber"
          icon={FileStack}
          loading={attachmentsQuery.isLoading}
          progress={attachmentReadyShare}
          progressLabel={kpiCopy.readiness}
          detail={kpiCopy.serviceScope}
          detailValue={`${attachmentReadyShare}%`}
          size="md"
          appearance="operational"
          className="service-detail-kpi-card"
          href="#service-detail-attachments"
        />
        <StatTile
          label={labels.kpis.mailboxes}
          value={mailboxes.length}
          themeClass={emailReady ? 'kpi-theme-emerald' : 'kpi-theme-red'}
          icon={Mail}
          loading={mailboxesQuery.isLoading}
          progress={mailboxReadyShare}
          progressLabel={kpiCopy.readiness}
          detail={kpiCopy.serviceScope}
          detailValue={activeMailboxes > 0 ? kpiCopy.active : `${mailboxReadyShare}%`}
          size="md"
          appearance="operational"
          className="service-detail-kpi-card"
          href="#service-detail-mailboxes"
        />
        <StatTile
          label={labels.kpis.eligibility}
          value={service.eligibility_rules?.length ?? 0}
          themeClass="kpi-theme-emerald"
          icon={ShieldCheck}
          detail={kpiCopy.serviceScope}
          detailValue={kpiCopy.rules}
          size="md"
          appearance="operational"
          className="service-detail-kpi-card"
          href="#service-detail-rules"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <section id="service-detail-sla" className="scroll-mt-24 space-y-4 rounded-lg border bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold">{dv.linkedSlaTitle}</h3>
              <p className="text-xs text-muted-foreground">{dv.linkedSlaHint}</p>
            </div>
            <Button asChild variant="outline" size="sm">
              <Link href="/lex/admin/sla-targets#sla-clock-monitor">
                <ExternalLink className="me-1.5 h-3.5 w-3.5" />
                {dv.monitor}
              </Link>
            </Button>
          </div>
          {linkedSlas.length === 0 ? (
            <div className="flex items-start gap-2 rounded-md border border-warning-300/70 bg-warning-50 p-3 text-sm text-warning-700 dark:border-warning-700/60 dark:bg-warning-700/15 dark:text-warning-300">
              <AlertTriangle className="mt-0.5 h-4 w-4" aria-hidden />
              {dv.noSlaLinked(service.code)}
            </div>
          ) : (
            <div className="overflow-auto">
              <Table className="text-sm">
                <TableHeader>
                  <TableRow>
                    <TableHead>{dv.colPriority}</TableHead>
                    <TableHead>{dv.colTurnaround}</TableHead>
                    <TableHead>{dv.colAck}</TableHead>
                    <TableHead>{dv.colEscalation}</TableHead>
                    <TableHead>{dv.colStatus}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {linkedSlas.map((target) => (
                    <TableRow key={target.id}>
                      <TableCell>
                        <Badge variant={target.priority === 'urgent' ? 'destructive' : 'secondary'}>
                          {target.priority}
                        </Badge>
                      </TableCell>
                      <TableCell>{dv.workingDays(target.turnaround_working_days)}</TableCell>
                      <TableCell>
                        {target.ack_window_value} {target.ack_window_unit.replace('_', ' ')}
                      </TableCell>
                      <TableCell>
                        {dv.escalationCell(
                          target.escalation_l1_days,
                          target.escalation_l2_days,
                          target.escalation_l3_days,
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={target.active ? 'default' : 'outline'}>
                          {target.active ? dv.active : dv.inactive}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="space-y-3 border-t pt-4">
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <LexRecordPicker
                kind="legal_request"
                ariaLabel={labels.detail.slaRequestIdAria}
                value={clockRequestId}
                onChange={setClockRequestId}
                allowClear
                labels={{
                  select: labels.detail.slaRequestIdPlaceholder,
                  search: labels.detail.slaRequestIdPlaceholder,
                }}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => clockLookup.mutate()}
                disabled={!clockRequestId.trim() || clockLookup.isPending}
              >
                {clockLookup.isPending ? (
                  <Loader2 className="me-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="me-1.5 h-4 w-4" />
                )}
                {dv.lookupClock}
              </Button>
            </div>
            {clock ? (
              <div className="rounded-md border bg-muted/20 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{dv.clockPrefix(getText(clock.id) ?? dv.unknown)}</span>
                    {clock.priority ? <Badge variant="secondary">{clock.priority}</Badge> : null}
                    <Badge variant={clockMatchesService ? 'success' : 'warning'}>
                      {clockMatchesService ? (clockServiceCode ?? service.code) : clockServiceCode}
                    </Badge>
                  </div>
                  <Badge variant={clock.breached ? 'destructive' : 'outline'}>
                    {clock.breached ? dv.breached : (getText(clock.outcome ?? clock.status) ?? dv.onTrack)}
                  </Badge>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                  <span>{dv.ackPrefix(formatDate(clock.ack_due_at ?? clock.acknowledgement_due_at, dv.notSet))}</span>
                  <span>{dv.duePrefix(formatDate(clock.turnaround_due_at ?? clock.due_at, dv.notSet))}</span>
                  <span>{dv.levelPrefix(clock.escalation_level ?? 0)}</span>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <section className="space-y-4 rounded-lg border bg-card p-4">
          <div>
            <h3 className="text-sm font-semibold">{dv.eligibilityTitle}</h3>
            <p className="text-xs text-muted-foreground">{dv.eligibilityHint}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="department" className="text-sm font-medium">
                {dv.department}
              </label>
              <Input
                id="department"
                list="service-detail-departments"
                value={department}
                onChange={(event) => setDepartment(event.target.value)}
                placeholder={labels.detail.deptPlaceholder}
              />
              <datalist id="service-detail-departments">
                {departments.map((code) => (
                  <option key={code} value={code} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="beneficiary_code" className="text-sm font-medium">
                {dv.beneficiaryCode}
              </label>
              <Input
                id="beneficiary_code"
                list="service-detail-org-codes"
                value={beneficiaryCode}
                onChange={(event) => setBeneficiaryCode(event.target.value)}
                placeholder={dv.orgCodePlaceholder}
              />
              <datalist id="service-detail-org-codes">
                {orgCodes.map((code) => (
                  <option key={code} value={code} />
                ))}
              </datalist>
            </div>
          </div>
          <Button type="button" onClick={() => eligibility.mutate()} disabled={eligibility.isPending}>
            {eligibility.isPending ? (
              <Timer className="me-1.5 h-4 w-4 animate-spin" />
            ) : (
              <ShieldCheck className="me-1.5 h-4 w-4" />
            )}
            {dv.checkEligibility}
          </Button>
          {eligibility.data ? (
            <div className="rounded-md border bg-muted/30 p-3">
              <div className="flex items-center gap-2">
                {eligibility.data.eligible ? (
                  <CheckCircle2 className="h-4 w-4 text-success-600" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
                <p className="text-sm font-medium">{eligibility.data.eligible ? dv.eligible : dv.notEligible}</p>
                {eligibility.data.matched_rule ? (
                  <Badge variant="secondary">{eligibility.data.matched_rule}</Badge>
                ) : null}
              </div>
              {eligibility.data.reasons?.length ? (
                <ul className="mt-2 list-disc space-y-1 ps-5 text-xs text-muted-foreground">
                  {eligibility.data.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <section id="service-detail-mailboxes" className="scroll-mt-24 space-y-3 rounded-lg border bg-card p-4">
          <div>
            <h3 className="text-sm font-semibold">{dv.intakeChannelTitle}</h3>
            <p className="text-xs text-muted-foreground">{dv.intakeChannelHint}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{labels.channels[service.channel] ?? service.channel}</Badge>
            {service.intake_email ? <Badge variant="outline">{service.intake_email}</Badge> : null}
          </div>
          <div className="space-y-2">
            {mailboxes.length === 0 ? (
              <p className="text-sm text-muted-foreground">{dv.noMailbox}</p>
            ) : (
              mailboxes.map((mailbox) => (
                <div key={mailbox.id} className="rounded-md border bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{mailbox.address}</span>
                    <Badge variant={mailbox.active ? 'default' : 'outline'}>
                      {mailbox.active ? dv.active : dv.inactive}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{mailbox.request_type}</p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="space-y-3 rounded-lg border bg-card p-4">
          <div>
            <h3 className="text-sm font-semibold">{dv.intakePreviewTitle}</h3>
            <p className="text-xs text-muted-foreground">{dv.intakePreviewHint}</p>
          </div>
          <div className="space-y-2 text-sm">
            <PreviewRow label={dv.rowTitle} value={dv.required} />
            <PreviewRow label={dv.rowDescription} value={dv.required} />
            <PreviewRow
              label={dv.rowBeneficiary}
              value={service.available_to.length ? service.available_to.join(', ') : dv.any}
            />
            <PreviewRow label={dv.rowPriority} value={dv.priorityValue} />
            <PreviewRow
              label={dv.rowRequesterApproval}
              value={service.requester_approval_required ? dv.required : dv.notRequired}
            />
            <PreviewRow
              label={dv.rowProviderApproval}
              value={service.provider_approval_required ? dv.required : dv.notRequired}
            />
          </div>
        </section>

        <section className="space-y-3 rounded-lg border bg-card p-4">
          <div>
            <h3 className="text-sm font-semibold">{dv.approvalPolicyTitle}</h3>
            <p className="text-xs text-muted-foreground">{dv.approvalPolicyHint}</p>
          </div>
          {approvalPolicy ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">{approvalPolicy.name}</p>
              <p className="text-xs text-muted-foreground">
                {dv.approverSummary(approvalPolicy.mode, approvalPolicy.quorum, approvalPolicy.approvers.length)}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {approvalPolicy.approvers.slice(0, 6).map((approver) => (
                  <Badge key={`${approver.type}:${approver.ref}`} variant="outline">
                    {approver.label ?? approver.ref}
                  </Badge>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{dv.noPolicyLinked}</p>
          )}
        </section>
      </div>

      <section id="service-detail-attachments" className="scroll-mt-24 space-y-4 rounded-lg border bg-card p-4">
        <div>
          <h3 className="text-sm font-semibold">{dv.attachmentsTitle}</h3>
          <p className="text-xs text-muted-foreground">{dv.attachmentsHint}</p>
        </div>
        {attachmentPolicies.length === 0 ? (
          <p className="text-sm text-muted-foreground">{dv.noAttachmentPolicy}</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {attachmentPolicies.map((policy) => (
              <div key={policy.id} className="rounded-md border bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {resolveLocalized(policy.name, locale) || policy.service_code || policy.request_type}
                  </p>
                  <Badge variant={policy.active ? 'default' : 'outline'}>
                    {policy.active ? dv.active : dv.inactive}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {dv.filesSlots(policy.min_attachment_count, policy.max_attachment_count, policy.slots?.length ?? 0)}
                </p>
                {policy.slots?.length ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {policy.slots.map((slot) => (
                      <Badge key={slot.key} variant={slot.required ? 'secondary' : 'outline'}>
                        {resolveLocalized(slot.label, locale) || slot.key}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section id="service-detail-rules" className="scroll-mt-24 space-y-3 rounded-lg border bg-card p-4">
        <div className="flex items-start gap-2">
          <ClipboardList className="mt-0.5 h-4 w-4 text-primary" />
          <div>
            <h3 className="text-sm font-semibold">{dv.rulesTitle}</h3>
            <p className="text-xs text-muted-foreground">{dv.rulesHint}</p>
          </div>
        </div>
        {service.eligibility_rules?.length ? (
          <div className="flex flex-wrap gap-2">
            {service.eligibility_rules.map((rule, index) => (
              <Badge key={`${rule.rule_type}:${rule.value}:${index}`} variant="outline">
                {labels.ruleTypes[rule.rule_type] ?? rule.rule_type}: {rule.value || dv.ruleAny}
              </Badge>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{dv.noExplicitRules}</p>
        )}
      </section>
    </div>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/20 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
