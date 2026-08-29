'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, KeyRound, Loader2, Play, Plus, RotateCw, Timer, Trash2, Workflow } from 'lucide-react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { ErrorState } from '@/components/common/error-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { parseApiError } from '@/lib/format';
import { readBool, unwrapList, unwrapTotal } from '@/lib/response-shape';
import { useAuth } from '@/hooks/use-auth';
import { useWorkflowDefinitions } from '@/hooks/use-workflow-definitions';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useAdminT } from '../../_lib/admin-i18n';

type TriggerExecution = {
  id: string;
  definition_id: string;
  instance_id?: string;
  event_id: string;
  topic: string;
  status: string;
  reason?: string;
  error_message?: string | null;
  created_at: string;
};

type SLATier = {
  after_seconds: number;
  notify: string;
  action: string;
};

type SLAPolicy = {
  id: string;
  name: string;
  description: string;
  definition_id?: string;
  calendar_id?: string;
  tiers: SLATier[];
  remind_before: number[];
  created_at: string;
  updated_at: string;
};

type BusinessCalendar = {
  id: string;
  name: string;
  description: string;
  timezone: string;
  working_days: Record<string, { start_minute: number; end_minute: number }>;
  holidays: string[];
  is_default: boolean;
  created_at: string;
  updated_at: string;
};

type CredentialStatus = {
  configured: boolean;
  enabled: boolean;
  provider?: string;
  model?: string;
  version?: number;
  last_rotated_at?: string;
  updated_at?: string;
};

type OperationsTab = 'triggers' | 'sla' | 'calendars' | 'llm';

const DEFAULT_TIERS = '[\n  {\n    "after_seconds": 3600,\n    "notify": "role:workflow-admin",\n    "action": "notify"\n  }\n]';
const DEFAULT_REMINDERS = '[900]';
const DEFAULT_WORKING_DAYS = '{\n  "1": { "start_minute": 540, "end_minute": 1020 },\n  "2": { "start_minute": 540, "end_minute": 1020 },\n  "3": { "start_minute": 540, "end_minute": 1020 },\n  "4": { "start_minute": 540, "end_minute": 1020 },\n  "5": { "start_minute": 540, "end_minute": 1020 }\n}';
const OPTIONAL_SELECTION_NONE = '__none__';

type JsonValidationLabels = Pick<
  ReturnType<typeof useAdminT>['workflowsOps'],
  'jsonInvalid' | 'jsonArrayRequired' | 'jsonObjectRequired'
>;

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonArrayField<T>(raw: string, label: string, messages: JsonValidationLabels): T[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error(messages.jsonInvalid(label));
  }

  if (!Array.isArray(parsed)) {
    throw new Error(messages.jsonArrayRequired(label));
  }
  return parsed as T[];
}

function parseJsonObjectField(raw: string, label: string, messages: JsonValidationLabels): Record<string, unknown> {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error(messages.jsonInvalid(label));
  }

  if (!isJsonObject(parsed)) {
    throw new Error(messages.jsonObjectRequired(label));
  }
  return parsed;
}

function labelFromCode(labels: Record<string, string>, code: string): string {
  return labels[code] ?? labels[code.toLowerCase()] ?? labels[code.toUpperCase()] ?? code;
}

export default function WorkflowOperationsPage() {
  const labels = useAdminT();
  const t = labels.workflowsOps;
  const { locale } = useLocaleOrDefault();
  const dateLocale = locale === 'ar' ? 'ar' : 'en-US';
  const pickerCopy = locale === 'ar'
    ? {
        definitionLabel: 'سير العمل (اختياري)',
        definitionNone: 'كل مسارات العمل',
        definitionMissing: 'سير عمل غير متاح',
        calendarLabel: 'تقويم العمل (اختياري)',
        calendarNone: 'التقويم الافتراضي',
        calendarMissing: 'تقويم غير متاح',
      }
    : {
        definitionLabel: 'Workflow definition (optional)',
        definitionNone: 'All workflow definitions',
        definitionMissing: 'Unavailable workflow definition',
        calendarLabel: 'Business calendar (optional)',
        calendarNone: 'Default calendar',
        calendarMissing: 'Unavailable calendar',
      };
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const canAuthor = hasPermission('workflow:write');
  const [activeTab, setActiveTab] = useState<OperationsTab>('triggers');
  const [policyForm, setPolicyForm] = useState({
    id: '',
    name: '',
    description: '',
    definition_id: '',
    calendar_id: '',
    tiers: DEFAULT_TIERS,
    remind_before: DEFAULT_REMINDERS,
  });
  const [calendarForm, setCalendarForm] = useState({
    id: '',
    name: '',
    description: '',
    timezone: 'UTC',
    working_days: DEFAULT_WORKING_DAYS,
    holidays: '[]',
    is_default: false,
  });
  const [credentialForm, setCredentialForm] = useState({
    provider: 'anthropic',
    model: 'claude-opus-4-8',
    api_key: '',
  });

  const triggersQuery = useQuery({
    queryKey: ['workflow-trigger-executions'],
    queryFn: () => apiGet<unknown>(API_ENDPOINTS.WORKFLOWS_TRIGGER_EXECUTIONS, { page: 1, per_page: 50 }),
    refetchInterval: 30_000,
  });

  const policiesQuery = useQuery({
    queryKey: ['workflow-sla-policies'],
    queryFn: () => apiGet<unknown>(API_ENDPOINTS.WORKFLOWS_SLA_POLICIES),
  });

  const calendarsQuery = useQuery({
    queryKey: ['workflow-calendars'],
    queryFn: () => apiGet<unknown>(API_ENDPOINTS.WORKFLOWS_CALENDARS),
  });

  const definitionsQuery = useWorkflowDefinitions({
    page: 1,
    per_page: 100,
    sort: 'name',
    order: 'asc',
  });

  const credentialQuery = useQuery({
    queryKey: ['workflow-llm-credential'],
    queryFn: () => apiGet<CredentialStatus>(API_ENDPOINTS.LLM_CREDENTIALS),
    enabled: activeTab === 'llm',
    retry: false,
  });

  const triggers = unwrapList<TriggerExecution>(triggersQuery.data);
  const policies = unwrapList<SLAPolicy>(policiesQuery.data, ['sla_policies']);
  const calendars = unwrapList<BusinessCalendar>(calendarsQuery.data, ['calendars']);
  const definitions = definitionsQuery.data?.data ?? [];

  useEffect(() => {
    if (credentialQuery.data?.provider || credentialQuery.data?.model) {
      setCredentialForm((prev) => ({
        ...prev,
        provider: credentialQuery.data?.provider ?? prev.provider,
        model: credentialQuery.data?.model ?? prev.model,
      }));
    }
  }, [credentialQuery.data]);

  const replayTriggerMutation = useMutation({
    mutationFn: (execution: TriggerExecution) => apiPost(API_ENDPOINTS.WORKFLOWS_TRIGGER_EXECUTION_REPLAY(execution.id), {}),
    onSuccess: () => {
      toast.success(t.toastReplayStarted);
      void queryClient.invalidateQueries({ queryKey: ['workflow-trigger-executions'] });
    },
    onError: (error) => toast.error(parseApiError(error)),
  });

  const savePolicyMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: policyForm.name.trim(),
        description: policyForm.description.trim(),
        definition_id: policyForm.definition_id.trim() || undefined,
        calendar_id: policyForm.calendar_id.trim() || undefined,
        tiers: parseJsonArrayField<SLATier>(policyForm.tiers, t.fieldTiers, t),
        remind_before: parseJsonArrayField<number>(policyForm.remind_before, t.fieldRemindBefore, t),
      };
      return policyForm.id
        ? apiPut<SLAPolicy>(API_ENDPOINTS.WORKFLOWS_SLA_POLICY_DETAIL(policyForm.id), payload)
        : apiPost<SLAPolicy>(API_ENDPOINTS.WORKFLOWS_SLA_POLICIES, payload);
    },
    onSuccess: () => {
      toast.success(policyForm.id ? t.toastSlaUpdated : t.toastSlaCreated);
      resetPolicyForm();
      void queryClient.invalidateQueries({ queryKey: ['workflow-sla-policies'] });
    },
    onError: (error) => toast.error(parseApiError(error)),
  });

  const deletePolicyMutation = useMutation({
    mutationFn: (policy: SLAPolicy) => apiDelete<void>(API_ENDPOINTS.WORKFLOWS_SLA_POLICY_DETAIL(policy.id)),
    onSuccess: () => {
      toast.success(t.toastSlaDeleted);
      void queryClient.invalidateQueries({ queryKey: ['workflow-sla-policies'] });
    },
    onError: (error) => toast.error(parseApiError(error)),
  });

  const saveCalendarMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: calendarForm.name.trim(),
        description: calendarForm.description.trim(),
        timezone: calendarForm.timezone.trim() || 'UTC',
        working_days: parseJsonObjectField(calendarForm.working_days, t.fieldWorkingDays, t),
        holidays: parseJsonArrayField<string>(calendarForm.holidays, t.fieldHolidays, t),
        is_default: calendarForm.is_default,
      };
      return calendarForm.id
        ? apiPut<BusinessCalendar>(API_ENDPOINTS.WORKFLOWS_CALENDAR_DETAIL(calendarForm.id), payload)
        : apiPost<BusinessCalendar>(API_ENDPOINTS.WORKFLOWS_CALENDARS, payload);
    },
    onSuccess: () => {
      toast.success(calendarForm.id ? t.toastCalendarUpdated : t.toastCalendarCreated);
      resetCalendarForm();
      void queryClient.invalidateQueries({ queryKey: ['workflow-calendars'] });
    },
    onError: (error) => toast.error(parseApiError(error)),
  });

  const deleteCalendarMutation = useMutation({
    mutationFn: (calendar: BusinessCalendar) => apiDelete<void>(API_ENDPOINTS.WORKFLOWS_CALENDAR_DETAIL(calendar.id)),
    onSuccess: () => {
      toast.success(t.toastCalendarDeleted);
      void queryClient.invalidateQueries({ queryKey: ['workflow-calendars'] });
    },
    onError: (error) => toast.error(parseApiError(error)),
  });

  const setCredentialMutation = useMutation({
    mutationFn: () => apiPut<CredentialStatus>(API_ENDPOINTS.LLM_CREDENTIALS, credentialForm),
    onSuccess: () => {
      toast.success(t.toastCredSaved);
      setCredentialForm((prev) => ({ ...prev, api_key: '' }));
      void queryClient.invalidateQueries({ queryKey: ['workflow-llm-credential'] });
    },
    onError: (error) => toast.error(parseApiError(error)),
  });

  const rotateCredentialMutation = useMutation({
    mutationFn: () => apiPost<CredentialStatus>(API_ENDPOINTS.LLM_CREDENTIALS_ROTATE, { api_key: credentialForm.api_key }),
    onSuccess: () => {
      toast.success(t.toastCredRotated);
      setCredentialForm((prev) => ({ ...prev, api_key: '' }));
      void queryClient.invalidateQueries({ queryKey: ['workflow-llm-credential'] });
    },
    onError: (error) => toast.error(parseApiError(error)),
  });

  const deleteCredentialMutation = useMutation({
    mutationFn: () => apiDelete<void>(API_ENDPOINTS.LLM_CREDENTIALS),
    onSuccess: () => {
      toast.success(t.toastCredRemoved);
      void queryClient.invalidateQueries({ queryKey: ['workflow-llm-credential'] });
    },
    onError: (error) => toast.error(parseApiError(error)),
  });

  function resetPolicyForm() {
    setPolicyForm({ id: '', name: '', description: '', definition_id: '', calendar_id: '', tiers: DEFAULT_TIERS, remind_before: DEFAULT_REMINDERS });
  }

  function resetCalendarForm() {
    setCalendarForm({ id: '', name: '', description: '', timezone: 'UTC', working_days: DEFAULT_WORKING_DAYS, holidays: '[]', is_default: false });
  }

  return (
    <PermissionRedirect permission="workflow:read">
      <div className="space-y-6">
        <PageHeader
          eyebrow={labels.workflowsOps.eyebrow}
          title={labels.workflowsOps.title}
          description={labels.workflowsOps.description}
        />

        <div className="grid gap-4 md:grid-cols-4">
          <MetricCard title={labels.workflowsOps.metricTriggerExecutions} value={String(unwrapTotal(triggersQuery.data, triggers.length))} detail={labels.workflowsOps.metricTriggerExecutionsDetail} />
          <MetricCard title={labels.workflowsOps.metricFailedTriggers} value={String(triggers.filter((tr) => tr.status === 'failed').length)} detail={labels.workflowsOps.metricFailedTriggersDetail} />
          <MetricCard title={labels.workflowsOps.metricSlaPolicies} value={String(policies.length)} detail={labels.workflowsOps.metricSlaPoliciesDetail} />
          <MetricCard title={labels.workflowsOps.metricCalendars} value={String(calendars.length)} detail={labels.workflowsOps.metricCalendarsDetail} />
        </div>

        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as OperationsTab)}>
          <TabsList>
            <TabsTrigger value="triggers"><Workflow className="me-1.5 h-4 w-4" />{labels.workflowsOps.tabTriggers}</TabsTrigger>
            <TabsTrigger value="sla"><Timer className="me-1.5 h-4 w-4" />{labels.workflowsOps.tabSla}</TabsTrigger>
            <TabsTrigger value="calendars"><CalendarDays className="me-1.5 h-4 w-4" />{labels.workflowsOps.tabCalendars}</TabsTrigger>
            <TabsTrigger value="llm"><KeyRound className="me-1.5 h-4 w-4" />{labels.workflowsOps.tabLlm}</TabsTrigger>
          </TabsList>

          <TabsContent value="triggers">
            <Card>
              <CardHeader>
                <CardTitle>{labels.workflowsOps.triggersTitle}</CardTitle>
                <CardDescription>{labels.workflowsOps.triggersDescription}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {triggersQuery.error ? (
                  <ErrorState error={triggersQuery.error} onRetry={() => void triggersQuery.refetch()} />
                ) : triggers.map((execution) => (
                  <div key={execution.id} className="rounded-lg border p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{execution.topic}</p>
                          <Badge variant="outline" title={`${labels.workflowsOps.statusCodeLabel}: ${execution.status}`}>
                            {labelFromCode(labels.workflowsOps.triggerStatus, execution.status)}
                          </Badge>
                          <Badge variant="secondary">{execution.definition_id}</Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {labels.workflowsOps.eventPrefix} {execution.event_id} · {new Date(execution.created_at).toLocaleString(dateLocale)}
                        </p>
                        {(execution.reason || execution.error_message) && (
                          <p className="mt-1 text-sm text-muted-foreground">
                            {labels.workflowsOps.technicalDetailPrefix}: <span className="font-mono text-xs">{execution.reason || execution.error_message}</span>
                          </p>
                        )}
                      </div>
                      <Button variant="outline" size="sm" onClick={() => replayTriggerMutation.mutate(execution)} disabled={!canAuthor || replayTriggerMutation.isPending}>
                        <Play className="me-1.5 h-3.5 w-3.5" />{labels.workflowsOps.replay}
                      </Button>
                    </div>
                  </div>
                ))}
                {triggers.length === 0 && <EmptyLine text={labels.workflowsOps.noTriggers} />}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="sla" className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <Card>
              <CardHeader>
                <CardTitle>{policyForm.id ? labels.workflowsOps.editSlaPolicy : labels.workflowsOps.createSlaPolicy}</CardTitle>
                <CardDescription>{labels.workflowsOps.slaFormDescription}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field label={labels.workflowsOps.fieldName} value={policyForm.name} onChange={(value) => setPolicyForm((prev) => ({ ...prev, name: value }))} />
                <Field label={labels.workflowsOps.fieldDescription} value={policyForm.description} onChange={(value) => setPolicyForm((prev) => ({ ...prev, description: value }))} />
                <div className="grid gap-4 md:grid-cols-2">
                  <OptionalPickerField
                    label={pickerCopy.definitionLabel}
                    value={policyForm.definition_id}
                    onChange={(value) => setPolicyForm((prev) => ({ ...prev, definition_id: value }))}
                    options={definitions.map((definition) => ({
                      value: definition.id,
                      label: `${definition.name} · v${definition.version}`,
                    }))}
                    noneLabel={pickerCopy.definitionNone}
                    missingLabel={pickerCopy.definitionMissing}
                    loading={definitionsQuery.isLoading}
                  />
                  <OptionalPickerField
                    label={pickerCopy.calendarLabel}
                    value={policyForm.calendar_id}
                    onChange={(value) => setPolicyForm((prev) => ({ ...prev, calendar_id: value }))}
                    options={calendars.map((calendar) => ({
                      value: calendar.id,
                      label: `${calendar.name} · ${calendar.timezone}`,
                    }))}
                    noneLabel={pickerCopy.calendarNone}
                    missingLabel={pickerCopy.calendarMissing}
                    loading={calendarsQuery.isLoading}
                  />
                </div>
                <JsonField label={labels.workflowsOps.fieldTiers} value={policyForm.tiers} onChange={(value) => setPolicyForm((prev) => ({ ...prev, tiers: value }))} />
                <JsonField label={labels.workflowsOps.fieldRemindBefore} value={policyForm.remind_before} onChange={(value) => setPolicyForm((prev) => ({ ...prev, remind_before: value }))} />
                <div className="flex gap-2">
                  <Button type="button" onClick={() => savePolicyMutation.mutate()} disabled={!canAuthor || savePolicyMutation.isPending || !policyForm.name.trim()}>
                    {savePolicyMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : <Plus className="me-1.5 h-4 w-4" />}
                    {policyForm.id ? labels.workflowsOps.savePolicy : labels.workflowsOps.createPolicy}
                  </Button>
                  {policyForm.id && <Button type="button" variant="outline" onClick={resetPolicyForm}>{labels.workflowsOps.cancelEdit}</Button>}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{labels.workflowsOps.catalogTitle}</CardTitle>
                <CardDescription>{labels.workflowsOps.catalogDescription}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {policiesQuery.error ? (
                  <ErrorState error={policiesQuery.error} onRetry={() => void policiesQuery.refetch()} />
                ) : policies.map((policy) => (
                  <div key={policy.id} className="rounded-lg border p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <p className="font-medium">{policy.name}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{policy.description || labels.workflowsOps.noDescription} · {policy.tiers.length} {labels.workflowsOps.tiersSuffix}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setPolicyForm({
                          id: policy.id,
                          name: policy.name,
                          description: policy.description ?? '',
                          definition_id: policy.definition_id ?? '',
                          calendar_id: policy.calendar_id ?? '',
                          tiers: JSON.stringify(policy.tiers ?? [], null, 2),
                          remind_before: JSON.stringify(policy.remind_before ?? [], null, 2),
                        })}>{labels.workflowsOps.edit}</Button>
                        <Button variant="destructive" size="sm" onClick={() => deletePolicyMutation.mutate(policy)} disabled={!canAuthor || deletePolicyMutation.isPending}>
                          <Trash2 className="me-1.5 h-3.5 w-3.5" />{labels.workflowsOps.delete}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
                {policies.length === 0 && <EmptyLine text={labels.workflowsOps.noSlaPolicies} />}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="calendars" className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <Card>
              <CardHeader>
                <CardTitle>{calendarForm.id ? labels.workflowsOps.editCalendar : labels.workflowsOps.createCalendar}</CardTitle>
                <CardDescription>{labels.workflowsOps.calendarFormDescription}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field label={labels.workflowsOps.fieldName} value={calendarForm.name} onChange={(value) => setCalendarForm((prev) => ({ ...prev, name: value }))} />
                <Field label={labels.workflowsOps.fieldDescription} value={calendarForm.description} onChange={(value) => setCalendarForm((prev) => ({ ...prev, description: value }))} />
                <Field label={labels.workflowsOps.fieldTimezone} value={calendarForm.timezone} onChange={(value) => setCalendarForm((prev) => ({ ...prev, timezone: value }))} />
                <Toggle label={labels.workflowsOps.fieldDefaultCalendar} checked={calendarForm.is_default} onChange={(checked) => setCalendarForm((prev) => ({ ...prev, is_default: checked }))} />
                <JsonField label={labels.workflowsOps.fieldWorkingDays} value={calendarForm.working_days} onChange={(value) => setCalendarForm((prev) => ({ ...prev, working_days: value }))} />
                <JsonField label={labels.workflowsOps.fieldHolidays} value={calendarForm.holidays} onChange={(value) => setCalendarForm((prev) => ({ ...prev, holidays: value }))} />
                <div className="flex gap-2">
                  <Button type="button" onClick={() => saveCalendarMutation.mutate()} disabled={!canAuthor || saveCalendarMutation.isPending || !calendarForm.name.trim()}>
                    {saveCalendarMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : <Plus className="me-1.5 h-4 w-4" />}
                    {calendarForm.id ? labels.workflowsOps.saveCalendar : labels.workflowsOps.createCalendarBtn}
                  </Button>
                  {calendarForm.id && <Button type="button" variant="outline" onClick={resetCalendarForm}>{labels.workflowsOps.cancelEdit}</Button>}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{labels.workflowsOps.businessCalendarsTitle}</CardTitle>
                <CardDescription>{labels.workflowsOps.businessCalendarsDescription}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {calendarsQuery.error ? (
                  <ErrorState error={calendarsQuery.error} onRetry={() => void calendarsQuery.refetch()} />
                ) : calendars.map((calendar) => (
                  <div key={calendar.id} className="rounded-lg border p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{calendar.name}</p>
                          {calendar.is_default && <Badge>{labels.workflowsOps.defaultBadge}</Badge>}
                          <Badge variant="outline">{calendar.timezone}</Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{Object.keys(calendar.working_days ?? {}).length} {labels.workflowsOps.workingDaysSuffix} · {calendar.holidays?.length ?? 0} {labels.workflowsOps.holidaysSuffix}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => setCalendarForm({
                          id: calendar.id,
                          name: calendar.name,
                          description: calendar.description ?? '',
                          timezone: calendar.timezone,
                          working_days: JSON.stringify(calendar.working_days ?? {}, null, 2),
                          holidays: JSON.stringify(calendar.holidays ?? [], null, 2),
                          is_default: calendar.is_default,
                        })}>{labels.workflowsOps.edit}</Button>
                        <Button variant="destructive" size="sm" onClick={() => deleteCalendarMutation.mutate(calendar)} disabled={!canAuthor || deleteCalendarMutation.isPending}>
                          <Trash2 className="me-1.5 h-3.5 w-3.5" />{labels.workflowsOps.delete}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
                {calendars.length === 0 && <EmptyLine text={labels.workflowsOps.noCalendars} />}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="llm">
            <Card>
              <CardHeader>
                <CardTitle>{labels.workflowsOps.llmTitle}</CardTitle>
                <CardDescription>{labels.workflowsOps.llmDescription}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 md:grid-cols-4">
                  <MetricCard title={labels.workflowsOps.metricConfigured} value={credentialQuery.data?.configured ? labels.workflowsOps.yes : labels.workflowsOps.no} detail={credentialQuery.error ? labels.workflowsOps.metricConfiguredNoStatus : labels.workflowsOps.metricConfiguredDetail} />
                  <MetricCard title={labels.workflowsOps.metricEnabled} value={credentialQuery.data?.enabled ? labels.workflowsOps.yes : labels.workflowsOps.no} detail={credentialQuery.data?.provider ?? credentialForm.provider} />
                  <MetricCard title={labels.workflowsOps.metricModel} value={credentialQuery.data?.model ?? credentialForm.model} detail={`${labels.workflowsOps.versionPrefix} ${credentialQuery.data?.version ?? 0}`} />
                  <MetricCard title={labels.workflowsOps.metricLastRotated} value={credentialQuery.data?.last_rotated_at ? new Date(credentialQuery.data.last_rotated_at).toLocaleDateString(dateLocale) : labels.workflowsOps.never} detail={labels.workflowsOps.keyNeverReturned} />
                </div>
                {credentialQuery.error && (
                  <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                    {labels.workflowsOps.credentialNotConfigured}
                  </div>
                )}
                <div className="grid gap-4 md:grid-cols-3">
                  <Field label={labels.workflowsOps.fieldProvider} value={credentialForm.provider} onChange={(value) => setCredentialForm((prev) => ({ ...prev, provider: value }))} />
                  <Field label={labels.workflowsOps.fieldModel} value={credentialForm.model} onChange={(value) => setCredentialForm((prev) => ({ ...prev, model: value }))} />
                  <Field label={labels.workflowsOps.fieldApiKey} type="password" value={credentialForm.api_key} onChange={(value) => setCredentialForm((prev) => ({ ...prev, api_key: value }))} />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => setCredentialMutation.mutate()} disabled={!canAuthor || setCredentialMutation.isPending || !credentialForm.api_key.trim()}>
                    {setCredentialMutation.isPending && <Loader2 className="me-1.5 h-4 w-4 animate-spin" />}
                    {labels.workflowsOps.saveCredential}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => rotateCredentialMutation.mutate()} disabled={!canAuthor || rotateCredentialMutation.isPending || !credentialForm.api_key.trim() || !credentialQuery.data?.configured}>
                    <RotateCw className="me-1.5 h-4 w-4" />{labels.workflowsOps.rotateKey}
                  </Button>
                  <Button type="button" variant="destructive" onClick={() => deleteCredentialMutation.mutate()} disabled={!canAuthor || deleteCredentialMutation.isPending || !credentialQuery.data?.configured}>
                    <Trash2 className="me-1.5 h-4 w-4" />{labels.workflowsOps.removeCredential}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </PermissionRedirect>
  );
}

function MetricCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function Field({ label, value, onChange, type = 'text' }: { label: string; value: string; onChange: (value: string) => void; type?: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function OptionalPickerField({
  label,
  value,
  onChange,
  options,
  noneLabel,
  missingLabel,
  loading = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  noneLabel: string;
  missingLabel: string;
  loading?: boolean;
}) {
  const valueExists = options.some((option) => option.value === value);

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select
        value={value || OPTIONAL_SELECTION_NONE}
        onValueChange={(nextValue) =>
          onChange(nextValue === OPTIONAL_SELECTION_NONE ? '' : nextValue)
        }
        disabled={loading}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={OPTIONAL_SELECTION_NONE}>{noneLabel}</SelectItem>
          {value && !valueExists ? (
            <SelectItem value={value}>{missingLabel}</SelectItem>
          ) : null}
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function JsonField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Textarea value={value} onChange={(event) => onChange(event.target.value)} className="min-h-[150px] font-mono text-xs" />
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <span className="text-sm font-medium">{label}</span>
      <Switch checked={readBool(checked)} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">{text}</p>;
}
