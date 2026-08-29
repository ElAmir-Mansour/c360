'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, GitBranch, Loader2, Play, Plus, RotateCcw, Trash2, Workflow, XCircle } from 'lucide-react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { ErrorState } from '@/components/common/error-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { parseApiError } from '@/lib/format';
import { prettyJson, unwrapData, unwrapList } from '@/lib/response-shape';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useAdminT } from '../_lib/admin-i18n';

type Automation = {
  id: string;
  name: string;
  enabled: boolean;
  trigger: Record<string, unknown>;
  rules?: unknown[];
  runbook_id: string;
  created_at: string;
  updated_at: string;
};

type AutomationRun = {
  id: string;
  automation_id: string;
  runbook_id: string;
  status: string;
  source_event_id: string;
  current_step: number;
  last_error?: string;
  started_at: string;
  completed_at?: string;
};

type Runbook = {
  id: string;
  name: string;
  steps?: unknown[];
  created_at: string;
  updated_at: string;
};

const DEFAULT_TRIGGER = '{\n  "type": "manual"\n}';
const DEFAULT_RULES = '[\n  {\n    "priority": 1,\n    "when": [],\n    "action_ref": {\n      "kind": "notification",\n      "config": {\n        "channel": "platform"\n      }\n    }\n  }\n]';

function defaultSteps(message: string): string {
  return JSON.stringify(
    [
      {
        index: 0,
        type: 'action',
        action: {
          kind: 'notification',
          config: {
            channel: 'platform',
            message,
          },
        },
      },
    ],
    null,
    2,
  );
}

type JsonValidationLabels = Pick<
  ReturnType<typeof useAdminT>['automation'],
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

function triggerTypeLabel(labels: ReturnType<typeof useAdminT>['automation'], type: unknown): string {
  return typeof type === 'string'
    ? (labels.triggerType as Record<string, string>)[type] ?? labels.triggerTypeFallback
    : labels.triggerTypeFallback;
}

export default function AutomationAdminPage() {
  const labels = useAdminT();
  const t = labels.automation;
  const { locale } = useLocaleOrDefault();
  const dateLocale = locale === 'ar' ? 'ar' : 'en-US';
  const queryClient = useQueryClient();
  const [automationForm, setAutomationForm] = useState({
    name: '',
    enabled: true,
    runbook_id: '',
    trigger: DEFAULT_TRIGGER,
    rules: DEFAULT_RULES,
  });
  const [runbookForm, setRunbookForm] = useState(() => ({
    name: '',
    steps: defaultSteps(t.defaultStepMessage),
  }));
  const [runbookLookupId, setRunbookLookupId] = useState('');
  const [invokePayload, setInvokePayload] = useState('{\n  "data": {}\n}');
  const [decisionComment, setDecisionComment] = useState('');

  const automationsQuery = useQuery({
    queryKey: ['automation-automations'],
    queryFn: async () => unwrapList<Automation>(await apiGet(API_ENDPOINTS.AUTOMATION_AUTOMATIONS)),
  });

  const runsQuery = useQuery({
    queryKey: ['automation-runs'],
    queryFn: async () => unwrapList<AutomationRun>(await apiGet(API_ENDPOINTS.AUTOMATION_RUNS, { page: 1, per_page: 50 })),
    refetchInterval: 30_000,
  });

  const runbookQuery = useQuery({
    queryKey: ['automation-runbook', runbookLookupId],
    queryFn: async () => unwrapData<Runbook>(await apiGet(API_ENDPOINTS.AUTOMATION_RUNBOOK_DETAIL(runbookLookupId.trim()))),
    enabled: Boolean(runbookLookupId.trim()),
  });

  const createRunbookMutation = useMutation({
    mutationFn: () => apiPost<{ data: Runbook }>(API_ENDPOINTS.AUTOMATION_RUNBOOKS, {
      name: runbookForm.name.trim(),
      steps: parseJsonArrayField(runbookForm.steps, t.fieldSteps, t),
    }),
    onSuccess: (response) => {
      const created = unwrapData<Runbook>(response);
      toast.success(t.toastRunbookCreated);
      if (created?.id) {
        setRunbookLookupId(created.id);
        setAutomationForm((prev) => ({ ...prev, runbook_id: created.id }));
      }
      setRunbookForm((prev) => ({ ...prev, name: '' }));
    },
    onError: (error) => toast.error(parseApiError(error)),
  });

  const createAutomationMutation = useMutation({
    mutationFn: () => apiPost<{ data: Automation }>(API_ENDPOINTS.AUTOMATION_AUTOMATIONS, {
      name: automationForm.name.trim(),
      enabled: automationForm.enabled,
      trigger: parseJsonObjectField(automationForm.trigger, t.fieldTrigger, t),
      rules: parseJsonArrayField(automationForm.rules, t.fieldRules, t),
      runbook_id: automationForm.runbook_id.trim(),
    }),
    onSuccess: () => {
      toast.success(t.toastAutomationCreated);
      setAutomationForm((prev) => ({ ...prev, name: '' }));
      void queryClient.invalidateQueries({ queryKey: ['automation-automations'] });
    },
    onError: (error) => toast.error(parseApiError(error)),
  });

  const updateAutomationMutation = useMutation({
    mutationFn: (automation: Automation) => apiPut<{ data: Automation }>(API_ENDPOINTS.AUTOMATION_AUTOMATION_DETAIL(automation.id), {
      name: automation.name,
      enabled: !automation.enabled,
      trigger: automation.trigger,
      rules: automation.rules ?? [],
      runbook_id: automation.runbook_id,
    }),
    onSuccess: () => {
      toast.success(t.toastAutomationUpdated);
      void queryClient.invalidateQueries({ queryKey: ['automation-automations'] });
    },
    onError: (error) => toast.error(parseApiError(error)),
  });

  const deleteAutomationMutation = useMutation({
    mutationFn: (automation: Automation) => apiDelete<void>(API_ENDPOINTS.AUTOMATION_AUTOMATION_DETAIL(automation.id)),
    onSuccess: () => {
      toast.success(t.toastAutomationDeleted);
      void queryClient.invalidateQueries({ queryKey: ['automation-automations'] });
    },
    onError: (error) => toast.error(parseApiError(error)),
  });

  const invokeMutation = useMutation({
    mutationFn: (automation: Automation) => apiPost(API_ENDPOINTS.AUTOMATION_AUTOMATION_INVOKE(automation.id), parseJsonObjectField(invokePayload, t.fieldInvokePayload, t)),
    onSuccess: () => {
      toast.success(t.toastManualInvocation);
      void queryClient.invalidateQueries({ queryKey: ['automation-runs'] });
    },
    onError: (error) => toast.error(parseApiError(error)),
  });

  const runActionMutation = useMutation({
    mutationFn: ({ run, action }: { run: AutomationRun; action: 'approve' | 'reject' | 'replay' }) => {
      if (action === 'approve') {
        return apiPost(API_ENDPOINTS.AUTOMATION_RUN_APPROVE(run.id), { comment: decisionComment.trim() });
      }
      if (action === 'reject') {
        return apiPost(API_ENDPOINTS.AUTOMATION_RUN_REJECT(run.id), { comment: decisionComment.trim() });
      }
      return apiPost(API_ENDPOINTS.AUTOMATION_RUN_REPLAY(run.id), {});
    },
    onSuccess: (_, variables) => {
      toast.success(variables.action === 'replay' ? t.toastReplayQueued : t.toastDecisionRecorded);
      setDecisionComment('');
      void queryClient.invalidateQueries({ queryKey: ['automation-runs'] });
    },
    onError: (error) => toast.error(parseApiError(error)),
  });

  const automations = automationsQuery.data ?? [];
  const runs = runsQuery.data ?? [];
  const awaitingApproval = runs.filter((run) => run.status === 'AWAITING_APPROVAL').length;

  return (
    <PermissionRedirect permission="automation:read">
      <div className="space-y-6">
        <PageHeader
          eyebrow={labels.automation.eyebrow}
          title={labels.automation.title}
          description={labels.automation.description}
        />

        <div className="grid gap-4 md:grid-cols-4">
          <MetricCard title={labels.automation.metricAutomations} value={String(automations.length)} detail={`${automations.filter((a) => a.enabled).length} ${labels.automation.enabledSuffix}`} />
          <MetricCard title={labels.automation.metricRuns} value={String(runs.length)} detail={labels.automation.metricRunsDetail} />
          <MetricCard title={labels.automation.metricAwaiting} value={String(awaitingApproval)} detail={labels.automation.metricAwaitingDetail} />
          <MetricCard title={labels.automation.metricFailed} value={String(runs.filter((r) => r.status === 'FAILED' || r.status === 'ABORTED').length)} detail={labels.automation.metricFailedDetail} />
        </div>

        <Tabs defaultValue="automations">
          <TabsList>
            <TabsTrigger value="automations"><Workflow className="me-1.5 h-4 w-4" />{labels.automation.tabAutomations}</TabsTrigger>
            <TabsTrigger value="runs"><Play className="me-1.5 h-4 w-4" />{labels.automation.tabRuns}</TabsTrigger>
            <TabsTrigger value="runbooks"><GitBranch className="me-1.5 h-4 w-4" />{labels.automation.tabRunbooks}</TabsTrigger>
          </TabsList>

          <TabsContent value="automations" className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
            <Card>
              <CardHeader>
                <CardTitle>{labels.automation.createAutomation}</CardTitle>
                <CardDescription>{labels.automation.createAutomationDesc}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field label={labels.automation.fieldName} value={automationForm.name} onChange={(value) => setAutomationForm((prev) => ({ ...prev, name: value }))} />
                <Field label={labels.automation.fieldRunbookId} value={automationForm.runbook_id} onChange={(value) => setAutomationForm((prev) => ({ ...prev, runbook_id: value }))} />
                <Toggle label={labels.automation.fieldEnabled} checked={automationForm.enabled} onChange={(checked) => setAutomationForm((prev) => ({ ...prev, enabled: checked }))} />
                <JsonField label={labels.automation.fieldTrigger} value={automationForm.trigger} onChange={(value) => setAutomationForm((prev) => ({ ...prev, trigger: value }))} />
                <JsonField label={labels.automation.fieldRules} value={automationForm.rules} onChange={(value) => setAutomationForm((prev) => ({ ...prev, rules: value }))} />
                <Button
                  type="button"
                  disabled={createAutomationMutation.isPending || !automationForm.name.trim() || !automationForm.runbook_id.trim()}
                  onClick={() => createAutomationMutation.mutate()}
                >
                  {createAutomationMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : <Plus className="me-1.5 h-4 w-4" />}
                  {labels.automation.createAutomationBtn}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{labels.automation.catalogTitle}</CardTitle>
                <CardDescription>{labels.automation.catalogDesc}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <JsonField label={labels.automation.fieldInvokePayload} value={invokePayload} onChange={setInvokePayload} />
                {automationsQuery.error ? (
                  <ErrorState error={automationsQuery.error} onRetry={() => void automationsQuery.refetch()} />
                ) : automations.map((automation) => (
                  <div key={automation.id} className="rounded-lg border p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{automation.name}</p>
                          <Badge variant={automation.enabled ? 'default' : 'outline'}>{automation.enabled ? labels.automation.enabledBadge : labels.automation.disabledBadge}</Badge>
                          <Badge variant="secondary" title={typeof automation.trigger?.type === 'string' ? `${labels.automation.triggerTypeCodeLabel}: ${automation.trigger.type}` : undefined}>
                            {triggerTypeLabel(labels.automation, automation.trigger?.type)}
                          </Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{labels.automation.runbookPrefix} {automation.runbook_id}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={() => invokeMutation.mutate(automation)} disabled={invokeMutation.isPending}>
                          <Play className="me-1.5 h-3.5 w-3.5" />{labels.automation.invoke}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => updateAutomationMutation.mutate(automation)} disabled={updateAutomationMutation.isPending}>
                          {automation.enabled ? labels.automation.disable : labels.automation.enable}
                        </Button>
                        <Button variant="destructive" size="sm" onClick={() => deleteAutomationMutation.mutate(automation)} disabled={deleteAutomationMutation.isPending}>
                          <Trash2 className="me-1.5 h-3.5 w-3.5" />{labels.automation.delete}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
                {automations.length === 0 && <EmptyLine text={labels.automation.noAutomations} />}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="runs">
            <Card>
              <CardHeader>
                <CardTitle>{labels.automation.runHistoryTitle}</CardTitle>
                <CardDescription>{labels.automation.runHistoryDesc}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field label={labels.automation.fieldApprovalComment} value={decisionComment} onChange={setDecisionComment} />
                {runsQuery.error ? (
                  <ErrorState error={runsQuery.error} onRetry={() => void runsQuery.refetch()} />
                ) : runs.map((run) => (
                  <div key={run.id} className="rounded-lg border p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{run.id}</p>
                          <Badge variant="outline" title={`${labels.automation.statusCodeLabel}: ${run.status}`}>
                            {labelFromCode(labels.automation.runStatus, run.status)}
                          </Badge>
                          <Badge variant="secondary">{labels.automation.stepPrefix} {run.current_step}</Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {labels.automation.automationPrefix} {run.automation_id} · {labels.automation.startedPrefix} {new Date(run.started_at).toLocaleString(dateLocale)}
                        </p>
                        {run.last_error && (
                          <p className="mt-1 text-sm text-destructive">
                            {labels.automation.technicalDetailPrefix}: <span className="font-mono text-xs">{run.last_error}</span>
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {run.status === 'AWAITING_APPROVAL' && (
                          <>
                            <Button variant="outline" size="sm" onClick={() => runActionMutation.mutate({ run, action: 'approve' })}>
                              <CheckCircle2 className="me-1.5 h-3.5 w-3.5" />{labels.automation.approve}
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => runActionMutation.mutate({ run, action: 'reject' })}>
                              <XCircle className="me-1.5 h-3.5 w-3.5" />{labels.automation.reject}
                            </Button>
                          </>
                        )}
                        {['COMPLETED', 'FAILED', 'ABORTED'].includes(run.status) && (
                          <Button variant="outline" size="sm" onClick={() => runActionMutation.mutate({ run, action: 'replay' })}>
                            <RotateCcw className="me-1.5 h-3.5 w-3.5" />{labels.automation.replay}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {runs.length === 0 && <EmptyLine text={labels.automation.noRuns} />}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="runbooks" className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
            <Card>
              <CardHeader>
                <CardTitle>{labels.automation.createRunbook}</CardTitle>
                <CardDescription>{labels.automation.createRunbookDesc}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field label={labels.automation.fieldName} value={runbookForm.name} onChange={(value) => setRunbookForm((prev) => ({ ...prev, name: value }))} />
                <JsonField label={labels.automation.fieldSteps} value={runbookForm.steps} onChange={(value) => setRunbookForm((prev) => ({ ...prev, steps: value }))} />
                <Button type="button" onClick={() => createRunbookMutation.mutate()} disabled={createRunbookMutation.isPending || !runbookForm.name.trim()}>
                  {createRunbookMutation.isPending ? <Loader2 className="me-1.5 h-4 w-4 animate-spin" /> : <Plus className="me-1.5 h-4 w-4" />}
                  {labels.automation.createRunbookBtn}
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{labels.automation.runbookLookupTitle}</CardTitle>
                <CardDescription>{labels.automation.runbookLookupDesc}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field label={labels.automation.fieldRunbookId} value={runbookLookupId} onChange={setRunbookLookupId} />
                {runbookQuery.error ? (
                  <ErrorState error={runbookQuery.error} onRetry={() => void runbookQuery.refetch()} />
                ) : runbookQuery.isFetching ? (
                  <p className="text-sm text-muted-foreground">{labels.automation.loadingRunbook}</p>
                ) : runbookQuery.data ? (
                  <div className="space-y-3 rounded-lg border p-4">
                    <div>
                      <p className="font-medium">{runbookQuery.data.name}</p>
                      <p className="text-sm text-muted-foreground">{runbookQuery.data.id}</p>
                    </div>
                    <Textarea value={prettyJson(runbookQuery.data.steps ?? [])} readOnly className="min-h-[220px] font-mono text-xs" />
                  </div>
                ) : (
                  <EmptyLine text={labels.automation.enterRunbookId} />
                )}
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

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
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
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  );
}

function EmptyLine({ text }: { text: string }) {
  return <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">{text}</p>;
}
