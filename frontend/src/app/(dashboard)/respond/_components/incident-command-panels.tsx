'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Activity,
  CheckCircle2,
  ClipboardCheck,
  ExternalLink,
  FileArchive,
  FileText,
  GitPullRequest,
  Megaphone,
  RefreshCw,
  Send,
  Settings2,
  ShieldCheck,
  UserMinus,
  Users,
} from 'lucide-react';
import { DetailStatCard } from '@/components/shared/detail-stat-card';
import { TenantUserPicker } from '@/components/shared/forms/tenant-user-picker';
import { ListRow } from '@/components/shared/list-row';
import { EmptyState } from '@/components/common/empty-state';
import { StatusBadge } from '@/components/shared/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  assignRespondRole,
  createRespondEvidenceExport,
  createRespondStakeholderToken,
  createRespondTask,
  decideRespondApproval,
  executeRespondQuickAction,
  mobilizeRespondRole,
  parseRespondFieldMappingText,
  releaseRespondRole,
  reorderRespondTasks,
  requestRespondApproval,
  saveRespondIntegrationConfig,
  sendRespondStakeholderUpdate,
  signOffRespondPIR,
  syncRespondIntegration,
  updateRespondPIR,
  updateRespondTaskStatus,
} from '@/lib/respond';
import { showApiError, showSuccess } from '@/lib/toast';
import type {
  RespondApprovalDecision,
  RespondCockpit,
  RespondCockpitQuickAction,
  RespondEvidenceExportFormat,
  RespondIncidentRole,
  RespondIntegrationConnectorType,
  RespondIntegrationProvider,
  RespondProduct,
  RespondRoleAssignment,
  RespondTaskCard,
  RespondTaskStatus,
} from '@/types/respond';
import {
  isRespondCapabilityEnabled,
  respondCapabilityDisabledReason,
} from './respond-capabilities';
import {
  useRespondCapabilityReasonLabels,
  useRespondCommandLabels,
  useRespondCommonLabels,
} from '../_lib/respond-i18n';

const roleValues: RespondIncidentRole[] = [
  'incident_commander',
  'communications_lead',
  'technical_lead',
  'subject_matter_expert',
  'scribe',
  'stakeholder_liaison',
  'resolver',
];

const taskStatusOptions: RespondTaskStatus[] = [
  'running',
  'complete',
  'skipped',
  'failed',
];

const taskColumnKeys: string[] = ['pending', 'runnable', 'running', 'blocked', 'complete'];

const integrationProviderOptions: Array<{
  provider: RespondIntegrationProvider;
  connectorType: RespondIntegrationConnectorType;
}> = [
  { provider: 'servicenow', connectorType: 'itsm' },
  { provider: 'slack', connectorType: 'comms' },
];

function formatDateTime(value: string | null | undefined, unrecorded: string) {
  if (!value) return unrecorded;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function toISODateTime(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function taskProgress(tasks: RespondTaskCard[]) {
  if (!tasks.length) return 0;
  const done = tasks.filter((task) =>
    ['complete', 'completed', 'done', 'skipped', 'cancelled', 'canceled'].includes(task.status.toLowerCase()),
  ).length;
  return Math.round((done / tasks.length) * 100);
}

function capabilityBadge(enabled: boolean, enabledLabel: string, disabledLabel: string) {
  return <Badge variant={enabled ? 'default' : 'outline'}>{enabled ? enabledLabel : disabledLabel}</Badge>;
}

function DisabledReason({ reason }: { reason?: string }) {
  if (!reason) return null;
  return <p className="text-xs leading-5 text-muted-foreground">{reason}</p>;
}

interface PromptPanelProps {
  cockpit: RespondCockpit;
  incidentID: string;
  product?: RespondProduct;
  onRefresh: () => Promise<void>;
}

function QuickActionsPanel({
  actions,
  incidentID,
  onRefresh,
}: {
  actions: RespondCockpitQuickAction[];
  incidentID: string;
  onRefresh: () => Promise<void>;
}) {
  const { quickActions: t } = useRespondCommandLabels();
  const actionMutation = useMutation({
    mutationFn: executeRespondQuickAction,
    onSuccess: async () => {
      showSuccess(t.toastTitle, t.toastBody);
      await onRefresh();
    },
    onError: showApiError,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.title}</CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {actions.length ? (
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <Button
                key={action.id}
                type="button"
                variant="outline"
                disabled={!action.enabled || actionMutation.isPending}
                title={action.disabled_reason ?? undefined}
                onClick={() => actionMutation.mutate(action)}
              >
                <Send className="me-2 h-4 w-4" aria-hidden />
                {action.label}
              </Button>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Send}
            title={t.emptyTitle}
            description={t.emptyDescription(incidentID)}
            size="compact"
          />
        )}
      </CardContent>
    </Card>
  );
}

function RoleMobilizationPanel({ cockpit, incidentID, product, onRefresh }: PromptPanelProps) {
  const command = useRespondCommandLabels();
  const t = command.mobilization;
  const common = useRespondCommonLabels();
  const capReasons = useRespondCapabilityReasonLabels();
  const [role, setRole] = useState<RespondIncidentRole>('resolver');
  const [userID, setUserID] = useState('');
  const [selectedAssignmentID, setSelectedAssignmentID] = useState('');
  const [escalationWindow, setEscalationWindow] = useState('15');
  const roleAssignmentEnabled = Boolean(
    product?.capabilities.find((capability) => capability.id === 'roles')?.enabled,
  );
  const mobilizationEnabled = Boolean(
    product?.capabilities.find((capability) => capability.id === 'mobilization')?.enabled,
  );
  const roleDisabledReason =
    roleAssignmentEnabled
      ? undefined
      : respondCapabilityDisabledReason(
          product,
          'mobilization',
          command.capabilityLabels.roleAssignment,
          capReasons,
        );
  const mobilizationDisabledReason =
    mobilizationEnabled
      ? undefined
      : (
          product?.capabilities.find((capability) => capability.id === 'mobilization')
            ?.description ??
          respondCapabilityDisabledReason(
            product,
            'mobilization',
            command.capabilityLabels.responderMobilization,
            capReasons,
          )
        );
  const assignmentPrerequisiteReason = userID.trim() ? undefined : t.responderIdReason;
  const mobilizationPrerequisiteReason =
    mobilizationDisabledReason ??
    (!cockpit.roles.length
      ? t.assignFirstReason
      : !selectedAssignmentID
        ? t.selectResponderReason
        : undefined);

  const assignMutation = useMutation({
    mutationFn: () =>
      assignRespondRole(incidentID, {
        role,
        user_id: userID.trim(),
        responder_source: 'role',
      }),
    onSuccess: async () => {
      showSuccess(t.toastAssignTitle, t.toastAssignBody);
      setUserID('');
      await onRefresh();
    },
    onError: showApiError,
  });

  const releaseMutation = useMutation({
    mutationFn: (assignmentID: string) => releaseRespondRole(incidentID, assignmentID),
    onSuccess: async () => {
      showSuccess(t.toastReleaseTitle, t.toastReleaseBody);
      setSelectedAssignmentID('');
      await onRefresh();
    },
    onError: showApiError,
  });

  const mobilizeMutation = useMutation({
    mutationFn: () =>
      mobilizeRespondRole(incidentID, {
        role_assignment_id: selectedAssignmentID,
        channels: ['email', 'chat'],
        escalation_window_minutes: Number(escalationWindow) || 15,
      }),
    onSuccess: async () => {
      showSuccess(t.toastMobilizeTitle, t.toastMobilizeBody);
      await onRefresh();
    },
    onError: showApiError,
  });

  const submitAssignment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (roleAssignmentEnabled && userID.trim() && !assignMutation.isPending) {
      assignMutation.mutate();
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{t.title()}</CardTitle>
            <CardDescription>{t.description}</CardDescription>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {capabilityBadge(roleAssignmentEnabled, t.badgeRolesEnabled, t.badgeRolesGated)}
            {capabilityBadge(
              mobilizationEnabled,
              t.badgeMobilizationEnabled,
              t.badgeMobilizationGated,
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {cockpit.roles.length ? (
          <div className="space-y-2">
            {cockpit.roles.map((assignment) => (
              <ListRow
                key={assignment.id}
                leading={<Users className="h-4 w-4" aria-hidden />}
                title={command.roleLabel(assignment.role)}
                subtitle={assignment.display_name}
                trailing={
                  assignment.acknowledgement_state ? (
                    <StatusBadge status={assignment.acknowledgement_state} size="sm" />
                  ) : null
                }
                selected={selectedAssignmentID === assignment.id}
                onClick={() => setSelectedAssignmentID(assignment.id)}
              >
                <div className="mt-2 text-xs text-muted-foreground">
                  {t.assignedAt(formatDateTime(assignment.assigned_at, common.unrecorded))}
                  {assignment.escalation_state
                    ? t.escalationInline(assignment.escalation_state)
                    : ''}
                </div>
                <div className="mt-3 flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!roleAssignmentEnabled || releaseMutation.isPending}
                    title={roleDisabledReason}
                    onClick={(event) => {
                      event.stopPropagation();
                      releaseMutation.mutate(assignment.id);
                    }}
                  >
                    <UserMinus className="me-2 h-4 w-4" aria-hidden />
                    {t.releaseButton}
                  </Button>
                </div>
              </ListRow>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Users}
            title={t.emptyTitle}
            description={t.emptyDescription}
            size="compact"
          />
        )}

        <form className="grid gap-3 md:grid-cols-[1fr_1fr_auto]" onSubmit={submitAssignment}>
          <div className="space-y-2">
            <Label htmlFor="respond-role-select">{t.roleLabel}</Label>
            <Select
              value={role}
              onValueChange={(value) => setRole(value as RespondIncidentRole)}
              disabled={!roleAssignmentEnabled || assignMutation.isPending}
            >
              <SelectTrigger id="respond-role-select" title={roleDisabledReason}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roleValues.map((value) => (
                  <SelectItem key={value} value={value}>
                    {command.roleLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="respond-role-user">{t.userIdLabel}</Label>
            <TenantUserPicker
              id="respond-role-user"
              ariaLabel={t.userIdLabel}
              value={userID}
              onChange={setUserID}
              enabled={roleAssignmentEnabled}
              disabled={!roleAssignmentEnabled || assignMutation.isPending}
              required
              className="w-full"
            />
          </div>
          <div className="flex items-end">
            <Button
              type="submit"
              disabled={!roleAssignmentEnabled || !userID.trim() || assignMutation.isPending}
              title={roleDisabledReason ?? assignmentPrerequisiteReason}
            >
              {t.assignButton}
            </Button>
          </div>
        </form>

        <div className="grid gap-3 md:grid-cols-[1fr_160px_auto]">
          <div className="space-y-2">
            <Label htmlFor="respond-mobilize-assignment">{t.assignmentLabel}</Label>
            <Select
              value={selectedAssignmentID}
              onValueChange={setSelectedAssignmentID}
              disabled={!mobilizationEnabled || !cockpit.roles.length || mobilizeMutation.isPending}
            >
              <SelectTrigger id="respond-mobilize-assignment" title={mobilizationPrerequisiteReason}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {cockpit.roles.map((assignment: RespondRoleAssignment) => (
                  <SelectItem key={assignment.id} value={assignment.id}>
                    {command.roleLabel(assignment.role)} · {assignment.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="respond-escalation-window">{t.escalationMinutesLabel()}</Label>
            <Input
              id="respond-escalation-window"
              type="number"
              min={1}
              value={escalationWindow}
              onChange={(event) => setEscalationWindow(event.target.value)}
              disabled={!mobilizationEnabled || !selectedAssignmentID || mobilizeMutation.isPending}
            />
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              variant="outline"
              disabled={!mobilizationEnabled || !selectedAssignmentID || mobilizeMutation.isPending}
              title={mobilizationPrerequisiteReason}
              onClick={() => mobilizeMutation.mutate()}
            >
              <Megaphone className="me-2 h-4 w-4" aria-hidden />
              {t.mobilizeButton}
            </Button>
          </div>
        </div>
        <DisabledReason reason={roleDisabledReason ?? mobilizationPrerequisiteReason} />
      </CardContent>
    </Card>
  );
}

function TaskBoardPanel({ cockpit, incidentID, product, onRefresh }: PromptPanelProps) {
  const command = useRespondCommandLabels();
  const t = command.taskBoard;
  const common = useRespondCommonLabels();
  const capReasons = useRespondCapabilityReasonLabels();
  const [title, setTitle] = useState('');
  const [ownerID, setOwnerID] = useState('');
  const [dueAt, setDueAt] = useState('');
  const enabled = isRespondCapabilityEnabled(product, 'tasks');
  const disabledReason = respondCapabilityDisabledReason(
    product,
    'tasks',
    command.capabilityLabels.taskLedResponse,
    capReasons,
  );
  const progress = taskProgress(cockpit.tasks);
  const groupedTasks = useMemo(() => {
    const groups = new Map<string, RespondTaskCard[]>();
    for (const key of taskColumnKeys) groups.set(key, []);
    for (const task of cockpit.tasks) {
      const key = groups.has(task.status) ? task.status : 'pending';
      groups.get(key)?.push(task);
    }
    return groups;
  }, [cockpit.tasks]);

  const createMutation = useMutation({
    mutationFn: () =>
      createRespondTask(incidentID, {
        title: title.trim(),
        owner_id: ownerID.trim() || null,
        due_at: toISODateTime(dueAt),
      }),
    onSuccess: async () => {
      showSuccess(t.toastCreatedTitle, t.toastCreatedBody);
      setTitle('');
      setOwnerID('');
      setDueAt('');
      await onRefresh();
    },
    onError: showApiError,
  });

  const statusMutation = useMutation({
    mutationFn: ({ taskID, status }: { taskID: string; status: RespondTaskStatus }) =>
      updateRespondTaskStatus(incidentID, taskID, { status }),
    onSuccess: async () => {
      showSuccess(t.toastStatusTitle, t.toastStatusBody);
      await onRefresh();
    },
    onError: showApiError,
  });

  const reorderMutation = useMutation({
    mutationFn: () => reorderRespondTasks(incidentID, { task_ids: cockpit.tasks.map((task) => task.id) }),
    onSuccess: async () => {
      showSuccess(t.toastOrderTitle(), t.toastOrderBody());
      await onRefresh();
    },
    onError: showApiError,
  });

  const submitTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (enabled && title.trim() && !createMutation.isPending) {
      createMutation.mutate();
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{t.title()}</CardTitle>
            <CardDescription>{t.description()}</CardDescription>
          </div>
          {capabilityBadge(enabled, t.badgeEnabled, t.badgeGated)}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-[1fr_160px]">
          <div>
            <Progress value={progress} />
            <p className="mt-2 text-xs text-muted-foreground">
              {t.progressSummary(progress, cockpit.tasks.length)}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!enabled || !cockpit.tasks.length || reorderMutation.isPending}
            title={disabledReason}
            onClick={() => reorderMutation.mutate()}
          >
            <GitPullRequest className="me-2 h-4 w-4" aria-hidden />
            {t.saveOrderButton}
          </Button>
        </div>

        <div className="grid gap-3 xl:grid-cols-5">
          {taskColumnKeys.map((columnKey) => {
            const tasks = groupedTasks.get(columnKey) ?? [];
            return (
              <div key={columnKey} className="rounded-md border bg-muted/20 p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{command.taskColumnLabels[columnKey]}</p>
                  <Badge variant="outline">{tasks.length}</Badge>
                </div>
                {tasks.length ? (
                  <div className="space-y-2">
                    {tasks.map((task) => (
                      <div key={task.id} className="rounded-md border bg-background p-3">
                        <div className="text-sm font-medium">{task.title}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {t.taskOwnerDue(
                            task.owner_name ?? common.unassigned,
                            formatDateTime(task.due_at, common.unrecorded),
                          )}
                        </div>
                        {task.blocked_by?.length ? (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {t.blockedBy(task.blocked_by.join(', '))}
                          </div>
                        ) : null}
                        <div className="mt-3">
                          <Select
                            value={task.status}
                            onValueChange={(status) =>
                              statusMutation.mutate({
                                taskID: task.id,
                                status: status as RespondTaskStatus,
                              })
                            }
                            disabled={!enabled || statusMutation.isPending}
                          >
                            <SelectTrigger title={disabledReason}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {taskStatusOptions.map((status) => (
                                <SelectItem key={status} value={status}>
                                  {command.taskStatusLabels[status] ?? status.replaceAll('_', ' ')}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs leading-5 text-muted-foreground">{t.noTasksInLane}</p>
                )}
              </div>
            );
          })}
        </div>

        <form className="grid gap-3 md:grid-cols-[1fr_180px_220px_auto]" onSubmit={submitTask}>
          <div className="space-y-2">
            <Label htmlFor="respond-task-title">{t.taskTitleLabel}</Label>
            <Input
              id="respond-task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={!enabled || createMutation.isPending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="respond-task-owner">{t.ownerIdLabel}</Label>
            <TenantUserPicker
              id="respond-task-owner"
              ariaLabel={t.ownerIdLabel}
              value={ownerID}
              onChange={setOwnerID}
              enabled={enabled}
              disabled={!enabled || createMutation.isPending}
              allowClear
              className="w-full"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="respond-task-due">{t.dueAtLabel}</Label>
            <Input
              id="respond-task-due"
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
              disabled={!enabled || createMutation.isPending}
            />
          </div>
          <div className="flex items-end">
            <Button
              type="submit"
              disabled={!enabled || !title.trim() || createMutation.isPending}
              title={disabledReason}
            >
              {t.addTaskButton}
            </Button>
          </div>
        </form>
        <DisabledReason reason={disabledReason} />
      </CardContent>
    </Card>
  );
}

export function IncidentResponseExecutionPanels(props: PromptPanelProps) {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <RoleMobilizationPanel {...props} />
        <QuickActionsPanel
          actions={props.cockpit.quick_actions}
          incidentID={props.incidentID}
          onRefresh={props.onRefresh}
        />
      </div>
      <TaskBoardPanel {...props} />
    </div>
  );
}

function IntegrationConfigPanel({ cockpit, incidentID, product, onRefresh }: PromptPanelProps) {
  const command = useRespondCommandLabels();
  const t = command.integrations;
  const common = useRespondCommonLabels();
  const capReasons = useRespondCapabilityReasonLabels();
  const [provider, setProvider] = useState<RespondIntegrationProvider>('servicenow');
  const [connectorType, setConnectorType] = useState<RespondIntegrationConnectorType>('itsm');
  const [connectorName, setConnectorName] = useState(t.defaultConnectorNameServicenow);
  const [endpointURL, setEndpointURL] = useState('');
  const [username, setUsername] = useState('');
  const [secretRef, setSecretRef] = useState('');
  const [webhookSecretName, setWebhookSecretName] = useState('');
  const [fieldMapping, setFieldMapping] = useState('incident_number=reference\nshort_description=title');
  const enabled = isRespondCapabilityEnabled(product, 'integrations');
  const disabledReason = respondCapabilityDisabledReason(
    product,
    'integrations',
    command.capabilityLabels.integrationConfiguration,
    capReasons,
  );
  const selectedConnector = integrationProviderOptions.find((option) => option.provider === provider);
  const configPrerequisiteReason = !connectorName.trim()
    ? t.configPrereqName
    : provider === 'servicenow' && !username.trim()
      ? t.configPrereqUsername
      : undefined;

  const saveMutation = useMutation({
    mutationFn: () =>
      saveRespondIntegrationConfig({
        name: connectorName.trim(),
        provider,
        connector_type: connectorType,
        enabled: true,
        endpoint_url: endpointURL.trim() || null,
        config:
          provider === 'servicenow'
            ? { username: username.trim(), auth_type: 'basic' }
            : {},
        field_mapping: parseRespondFieldMappingText(fieldMapping),
        webhook_auth_type: webhookSecretName.trim() ? 'hmac_sha256' : null,
        webhook_secret_name: webhookSecretName.trim() || null,
        secrets: secretRef.trim()
          ? [{ name: provider === 'servicenow' ? 'password' : 'bot_token', secret_ref: secretRef.trim() }]
          : [],
      }),
    onSuccess: async () => {
      showSuccess(t.toastConfigSavedTitle, t.toastConfigSavedBody);
      await onRefresh();
    },
    onError: showApiError,
  });

  const submitConfig = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (enabled && connectorName.trim() && !configPrerequisiteReason && !saveMutation.isPending) {
      saveMutation.mutate();
    }
  };

  const syncMutation = useMutation({
    mutationFn: (connectorID: string) =>
      syncRespondIntegration(incidentID, {
        connector_id: connectorID,
        action: 'sync',
      }),
    onSuccess: async () => {
      showSuccess(t.toastSyncTitle, t.toastSyncBody);
      await onRefresh();
    },
    onError: showApiError,
  });

  const onProviderChange = (nextProvider: string) => {
    const option = integrationProviderOptions.find((item) => item.provider === nextProvider);
    if (!option) return;
    setProvider(option.provider);
    setConnectorType(option.connectorType);
    setConnectorName(
      option.provider === 'servicenow'
        ? t.defaultConnectorNameServicenow
        : t.defaultConnectorNameSlack,
    );
    setUsername('');
  };

  const onConnectorTypeChange = (nextType: string) => {
    const option = integrationProviderOptions.find((item) => item.connectorType === nextType);
    if (!option) return;
    setConnectorType(option.connectorType);
    setProvider(option.provider);
    setConnectorName(
      option.provider === 'servicenow'
        ? t.defaultConnectorNameServicenow
        : t.defaultConnectorNameSlack,
    );
    setUsername('');
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{t.title}</CardTitle>
            <CardDescription>{t.description}</CardDescription>
          </div>
          {capabilityBadge(enabled, t.badgeEnabled, t.badgeGated)}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {cockpit.integrations.length ? (
          <div className="space-y-2">
            {cockpit.integrations.map((integration) => (
              <ListRow
                key={`${integration.provider}:${integration.external_reference ?? integration.sync_state}`}
                leading={<ExternalLink className="h-4 w-4" aria-hidden />}
                title={integration.connector_name ?? integration.provider}
                subtitle={integration.external_reference ?? t.noExternalReference}
                trailing={<StatusBadge status={integration.sync_state} size="sm" />}
              >
                <div className="mt-2 text-xs text-muted-foreground">
                  {t.lastSync(formatDateTime(integration.last_synced_at, common.unrecorded))}
                  {integration.last_error ? ` · ${integration.last_error}` : ''}
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-2">
                    {integration.ticket_url ? (
                      <Button type="button" size="sm" variant="outline" asChild>
                        <a href={integration.ticket_url} target="_blank" rel="noreferrer">
                          <ExternalLink className="me-2 h-4 w-4" aria-hidden />
                          {t.ticketButton}
                        </a>
                      </Button>
                    ) : null}
                    {integration.channel_url ? (
                      <Button type="button" size="sm" variant="outline" asChild>
                        <a href={integration.channel_url} target="_blank" rel="noreferrer">
                          <ExternalLink className="me-2 h-4 w-4" aria-hidden />
                          {t.channelButton}
                        </a>
                      </Button>
                    ) : null}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!enabled || !integration.connector_id || syncMutation.isPending}
                    title={
                      disabledReason ??
                      (!integration.connector_id ? t.missingConnectorReason() : undefined)
                    }
                    onClick={() => {
                      if (integration.connector_id) syncMutation.mutate(integration.connector_id);
                    }}
                  >
                    <RefreshCw className="me-2 h-4 w-4" aria-hidden />
                    {t.syncButton}
                  </Button>
                </div>
              </ListRow>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={ExternalLink}
            title={t.emptyTitle}
            description={t.emptyDescription}
            size="compact"
          />
        )}

        <form className="space-y-3" onSubmit={submitConfig}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-2">
              <Label htmlFor="respond-integration-name">{t.connectorNameLabel}</Label>
              <Input
                id="respond-integration-name"
                value={connectorName}
                onChange={(event) => setConnectorName(event.target.value)}
                disabled={!enabled || saveMutation.isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="respond-integration-provider">{t.providerLabel}</Label>
              <Select value={provider} onValueChange={onProviderChange} disabled={!enabled || saveMutation.isPending}>
                <SelectTrigger id="respond-integration-provider" title={disabledReason}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {integrationProviderOptions.map((option) => (
                    <SelectItem key={option.provider} value={option.provider}>
                      {command.integrationProviderLabels[option.provider]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="respond-integration-type">{t.connectorTypeLabel}</Label>
              <Select
                value={connectorType}
                onValueChange={onConnectorTypeChange}
                disabled={!enabled || saveMutation.isPending}
              >
                <SelectTrigger id="respond-integration-type" title={disabledReason}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="itsm">{t.connectorTypeItsm}</SelectItem>
                  <SelectItem value="comms">{t.connectorTypeComms}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="respond-integration-endpoint">{t.endpointUrlLabel}</Label>
              <Input
                id="respond-integration-endpoint"
                value={endpointURL}
                onChange={(event) => setEndpointURL(event.target.value)}
                disabled={!enabled || saveMutation.isPending}
              />
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {provider === 'servicenow' ? (
              <div className="space-y-2">
                <Label htmlFor="respond-integration-username">{t.usernameLabel}</Label>
                <Input
                  id="respond-integration-username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  disabled={!enabled || saveMutation.isPending}
                />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="respond-integration-secret">{t.secretRefLabel}</Label>
              <Input
                id="respond-integration-secret"
                value={secretRef}
                onChange={(event) => setSecretRef(event.target.value)}
                placeholder={selectedConnector?.provider === 'slack' ? 'env://SLACK_BOT_TOKEN' : 'env://SERVICENOW_PASSWORD'}
                disabled={!enabled || saveMutation.isPending}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="respond-integration-webhook-secret">{t.webhookSecretLabel}</Label>
              <Input
                id="respond-integration-webhook-secret"
                value={webhookSecretName}
                onChange={(event) => setWebhookSecretName(event.target.value)}
                placeholder="respond-servicenow-webhook"
                disabled={!enabled || saveMutation.isPending}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="respond-integration-mapping">{t.fieldMappingLabel}</Label>
            <Textarea
              id="respond-integration-mapping"
              value={fieldMapping}
              onChange={(event) => setFieldMapping(event.target.value)}
              disabled={!enabled || saveMutation.isPending}
              rows={3}
            />
          </div>
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={!enabled || !connectorName.trim() || Boolean(configPrerequisiteReason) || saveMutation.isPending}
              title={disabledReason ?? configPrerequisiteReason}
            >
              <Settings2 className="me-2 h-4 w-4" aria-hidden />
              {t.saveConfigButton}
            </Button>
          </div>
        </form>
        <DisabledReason reason={disabledReason} />
      </CardContent>
    </Card>
  );
}

function StakeholderUpdatePanel({ cockpit, incidentID, product, onRefresh }: PromptPanelProps) {
  const command = useRespondCommandLabels();
  const t = command.stakeholder;
  const common = useRespondCommonLabels();
  const capReasons = useRespondCapabilityReasonLabels();
  const [expiresAt, setExpiresAt] = useState('');
  const [nextUpdateAt, setNextUpdateAt] = useState('');
  const [tokenURL, setTokenURL] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const updatesEnabled = isRespondCapabilityEnabled(product, 'stakeholderUpdates');
  const updateDisabledReason = respondCapabilityDisabledReason(
    product,
    'stakeholderUpdates',
    command.capabilityLabels.stakeholderUpdates,
    capReasons,
  );

  const tokenMutation = useMutation({
    mutationFn: () =>
      createRespondStakeholderToken(incidentID, {
        expires_at: toISODateTime(expiresAt),
        next_update_at: toISODateTime(nextUpdateAt),
      }),
    onSuccess: async (token) => {
      setTokenURL(token.url_path);
      showSuccess(t.toastTokenTitle, t.toastTokenBody);
      await onRefresh();
    },
    onError: showApiError,
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      sendRespondStakeholderUpdate(incidentID, {
        subject: subject.trim(),
        body: body.trim(),
        channels: ['status_page', 'email'],
        next_update_at: toISODateTime(nextUpdateAt),
      }),
    onSuccess: async () => {
      showSuccess(t.toastUpdateTitle, t.toastUpdateBody);
      setSubject('');
      setBody('');
      await onRefresh();
    },
    onError: showApiError,
  });

  const submitUpdate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (updatesEnabled && subject.trim() && body.trim() && !updateMutation.isPending) {
      updateMutation.mutate();
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{t.title}</CardTitle>
            <CardDescription>{t.description}</CardDescription>
          </div>
          {capabilityBadge(updatesEnabled, t.badgeEnabled, t.badgeGated)}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-2">
            <Label htmlFor="respond-token-expires">{t.tokenExpiresLabel}</Label>
            <Input
              id="respond-token-expires"
              type="datetime-local"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
              disabled={!updatesEnabled || tokenMutation.isPending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="respond-next-update">{t.nextUpdateLabel}</Label>
            <Input
              id="respond-next-update"
              type="datetime-local"
              value={nextUpdateAt}
              onChange={(event) => setNextUpdateAt(event.target.value)}
              disabled={!updatesEnabled || tokenMutation.isPending}
            />
          </div>
          <div className="flex items-end">
            <Button
              type="button"
              variant="outline"
              disabled={!updatesEnabled || tokenMutation.isPending}
              title={updateDisabledReason}
              onClick={() => tokenMutation.mutate()}
            >
              <ShieldCheck className="me-2 h-4 w-4" aria-hidden />
              {t.createTokenButton}
            </Button>
          </div>
        </div>
        {tokenURL ? (
          <div className="rounded-md border bg-muted/20 p-3">
            <Label htmlFor="respond-token-url">{t.statusUrlLabel}</Label>
            <Input id="respond-token-url" value={tokenURL} readOnly className="mt-2" />
          </div>
        ) : null}

        {cockpit.stakeholder_updates?.length ? (
          <div className="space-y-2">
            {cockpit.stakeholder_updates.map((update) => (
              <ListRow
                key={update.id}
                leading={<Megaphone className="h-4 w-4" aria-hidden />}
                title={update.subject}
                subtitle={update.channel ?? t.updateChannelFallback}
                trailing={<StatusBadge status={update.status} size="sm" />}
              >
                <div className="mt-2 text-xs text-muted-foreground">
                  {t.dispatched(formatDateTime(update.dispatched_at, common.unrecorded))}
                </div>
              </ListRow>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Megaphone}
            title={t.emptyTitle}
            description={t.emptyDescription}
            size="compact"
          />
        )}

        <form className="space-y-3" onSubmit={submitUpdate}>
          <div className="space-y-2">
            <Label htmlFor="respond-update-subject">{t.updateSubjectLabel}</Label>
            <Input
              id="respond-update-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              disabled={!updatesEnabled || updateMutation.isPending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="respond-update-body">{t.updateBodyLabel}</Label>
            <Textarea
              id="respond-update-body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              disabled={!updatesEnabled || updateMutation.isPending}
              rows={4}
            />
          </div>
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={!updatesEnabled || !subject.trim() || !body.trim() || updateMutation.isPending}
              title={updateDisabledReason}
            >
              <Send className="me-2 h-4 w-4" aria-hidden />
              {t.sendUpdateButton}
            </Button>
          </div>
        </form>
        <DisabledReason reason={updateDisabledReason} />
      </CardContent>
    </Card>
  );
}

function ApprovalGatePanel({ cockpit, incidentID, product, onRefresh }: PromptPanelProps) {
  const command = useRespondCommandLabels();
  const t = command.approvals;
  const common = useRespondCommonLabels();
  const capReasons = useRespondCapabilityReasonLabels();
  const [actionKey, setActionKey] = useState('authorize_failover');
  const [title, setTitle] = useState('');
  const [reason, setReason] = useState('');
  const enabled = isRespondCapabilityEnabled(product, 'approvals');
  const disabledReason = respondCapabilityDisabledReason(
    product,
    'approvals',
    command.capabilityLabels.approvalGates,
    capReasons,
  );

  const requestMutation = useMutation({
    mutationFn: () =>
      requestRespondApproval(incidentID, {
        action_key: actionKey,
        title: title.trim(),
        reason: reason.trim(),
        approver_role: 'incident_commander',
      }),
    onSuccess: async () => {
      showSuccess(t.toastRequestedTitle, t.toastRequestedBody);
      setTitle('');
      setReason('');
      await onRefresh();
    },
    onError: showApiError,
  });

  const decisionMutation = useMutation({
    mutationFn: ({ approvalID, decision }: { approvalID: string; decision: RespondApprovalDecision }) =>
      decideRespondApproval(incidentID, approvalID, { decision }),
    onSuccess: async () => {
      showSuccess(t.toastDecisionTitle, t.toastDecisionBody);
      await onRefresh();
    },
    onError: showApiError,
  });

  const submitRequest = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (enabled && title.trim() && reason.trim() && !requestMutation.isPending) {
      requestMutation.mutate();
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{t.title}</CardTitle>
            <CardDescription>{t.description}</CardDescription>
          </div>
          {capabilityBadge(enabled, t.badgeEnabled, t.badgeGated)}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {cockpit.approvals?.length ? (
          <div className="space-y-2">
            {cockpit.approvals.map((approval) => (
              <ListRow
                key={approval.id}
                leading={<ClipboardCheck className="h-4 w-4" aria-hidden />}
                title={approval.title}
                subtitle={t.subtitle(
                  approval.action_key,
                  formatDateTime(approval.requested_at, common.unrecorded),
                )}
                trailing={<StatusBadge status={approval.status} size="sm" />}
              >
                {approval.status === 'pending' ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!enabled || decisionMutation.isPending}
                      title={disabledReason}
                      onClick={() =>
                        decisionMutation.mutate({ approvalID: approval.id, decision: 'approved' })
                      }
                    >
                      {t.approveButton}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!enabled || decisionMutation.isPending}
                      title={disabledReason}
                      onClick={() =>
                        decisionMutation.mutate({ approvalID: approval.id, decision: 'rejected' })
                      }
                    >
                      {t.rejectButton}
                    </Button>
                  </div>
                ) : null}
              </ListRow>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={ClipboardCheck}
            title={t.emptyTitle}
            description={t.emptyDescription}
            size="compact"
          />
        )}

        <form className="space-y-3" onSubmit={submitRequest}>
          <div className="grid gap-3 md:grid-cols-[220px_1fr]">
            <div className="space-y-2">
              <Label htmlFor="respond-approval-action">{t.actionLabel}</Label>
              <Select value={actionKey} onValueChange={setActionKey} disabled={!enabled || requestMutation.isPending}>
                <SelectTrigger id="respond-approval-action" title={disabledReason}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="authorize_failover">
                    {command.actionOptionLabels.authorize_failover}
                  </SelectItem>
                  <SelectItem value="major_business_impact">
                    {command.actionOptionLabels.major_business_impact}
                  </SelectItem>
                  <SelectItem value="close_incident">
                    {command.actionOptionLabels.close_incident}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="respond-approval-title">{t.titleLabel}</Label>
              <Input
                id="respond-approval-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                disabled={!enabled || requestMutation.isPending}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="respond-approval-reason">{t.reasonLabel}</Label>
            <Textarea
              id="respond-approval-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={!enabled || requestMutation.isPending}
              rows={3}
            />
          </div>
          <div className="flex justify-end">
            <Button
              type="submit"
              disabled={!enabled || !title.trim() || !reason.trim() || requestMutation.isPending}
              title={disabledReason}
            >
              {t.requestButton}
            </Button>
          </div>
        </form>
        <DisabledReason reason={disabledReason} />
      </CardContent>
    </Card>
  );
}

export function IncidentCoordinationPanels(props: PromptPanelProps) {
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <IntegrationConfigPanel {...props} />
      <div className="space-y-6">
        <StakeholderUpdatePanel {...props} />
        <ApprovalGatePanel {...props} />
      </div>
    </div>
  );
}

function PirEvidencePanel({ cockpit, incidentID, product, onRefresh }: PromptPanelProps) {
  const command = useRespondCommandLabels();
  const t = command.pir;
  const common = useRespondCommonLabels();
  const capReasons = useRespondCapabilityReasonLabels();
  const [contributingFactors, setContributingFactors] = useState(cockpit.pir?.contributing_factors ?? '');
  const [lessonsLearned, setLessonsLearned] = useState(cockpit.pir?.lessons_learned ?? '');
  const enabled = isRespondCapabilityEnabled(product, 'pirEvidence');
  const disabledReason = respondCapabilityDisabledReason(
    product,
    'pirEvidence',
    command.capabilityLabels.pirEvidenceExport,
    capReasons,
  );
  const incidentReviewReady = ['Resolved', 'Closed'].includes(cockpit.incident.status);
  const pirPrerequisiteReason =
    disabledReason ?? (!incidentReviewReady ? t.reviewNotReadyReason : undefined);

  useEffect(() => {
    setContributingFactors(cockpit.pir?.contributing_factors ?? '');
    setLessonsLearned(cockpit.pir?.lessons_learned ?? '');
  }, [cockpit.pir?.id, cockpit.pir?.contributing_factors, cockpit.pir?.lessons_learned]);

  const updateMutation = useMutation({
    mutationFn: () =>
      updateRespondPIR(incidentID, {
        contributing_factors: contributingFactors.trim() || null,
        lessons_learned: lessonsLearned.trim() || null,
      }),
    onSuccess: async () => {
      showSuccess(t.toastPirUpdatedTitle, t.toastPirUpdatedBody);
      await onRefresh();
    },
    onError: showApiError,
  });

  const signOffMutation = useMutation({
    mutationFn: () => signOffRespondPIR(incidentID),
    onSuccess: async () => {
      showSuccess(t.toastSignOffTitle, t.toastSignOffBody);
      await onRefresh();
    },
    onError: showApiError,
  });

  const exportMutation = useMutation({
    mutationFn: (format: RespondEvidenceExportFormat) =>
      createRespondEvidenceExport(incidentID, { format }),
    onSuccess: async () => {
      showSuccess(t.toastExportTitle, t.toastExportBody);
      await onRefresh();
    },
    onError: showApiError,
  });

  const submitPIR = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (enabled && incidentReviewReady && !updateMutation.isPending) {
      updateMutation.mutate();
    }
  };

  const pir = cockpit.pir;
  const exports = cockpit.evidence_exports ?? [];
  const signOffPrerequisiteReason =
    pirPrerequisiteReason ?? (!pir ? t.signOffPrereq : undefined);
  const exportPrerequisiteReason =
    pirPrerequisiteReason ?? (!pir ? t.exportPrereq : undefined);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{t.title}</CardTitle>
            <CardDescription>{t.description}</CardDescription>
          </div>
          {capabilityBadge(enabled, t.badgeEnabled, t.badgeGated)}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <DetailStatCard
            label={t.statusLabel()}
            value={pir?.status ?? t.statusNoPir}
            tone={pir?.status === 'signed_off' ? 'emerald' : 'neutral'}
            icon={FileText}
          />
          <DetailStatCard
            label={t.generatedLabel}
            value={formatDateTime(pir?.generated_at, common.unrecorded)}
            tone="neutral"
          />
          <DetailStatCard
            label={t.signedOffLabel}
            value={formatDateTime(pir?.signed_off_at, common.unrecorded)}
            tone={pir?.signed_off_at ? 'emerald' : 'gold'}
            icon={ShieldCheck}
          />
        </div>

        {pir ? (
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-sm font-medium">{t.summaryTitle}</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {pir.summary ?? t.summaryEmpty}
            </p>
            {pir.action_items?.length ? (
              <div className="mt-3 space-y-2">
                {pir.action_items.map((item) => (
                  <ListRow
                    key={item.id}
                    leading={<CheckCircle2 className="h-4 w-4" aria-hidden />}
                    title={item.title}
                    subtitle={t.actionItemSubtitle(
                      item.owner_name ?? common.unassigned,
                      formatDateTime(item.due_at, common.unrecorded),
                    )}
                    trailing={<StatusBadge status={item.status} size="sm" />}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <EmptyState
            icon={FileText}
            title={t.emptyPirTitle}
            description={t.emptyPirDescription()}
            size="compact"
          />
        )}

        <form className="space-y-3" onSubmit={submitPIR}>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="respond-pir-factors">{t.factorsLabel}</Label>
              <Textarea
                id="respond-pir-factors"
                value={contributingFactors}
                onChange={(event) => setContributingFactors(event.target.value)}
                disabled={!enabled || !incidentReviewReady || updateMutation.isPending}
                rows={4}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="respond-pir-lessons">{t.lessonsLabel}</Label>
              <Textarea
                id="respond-pir-lessons"
                value={lessonsLearned}
                onChange={(event) => setLessonsLearned(event.target.value)}
                disabled={!enabled || !incidentReviewReady || updateMutation.isPending}
                rows={4}
              />
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="submit"
              disabled={!enabled || !incidentReviewReady || updateMutation.isPending}
              title={pirPrerequisiteReason}
            >
              {t.savePirButton}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!enabled || !pir || signOffMutation.isPending || pir?.status === 'signed_off'}
              title={signOffPrerequisiteReason}
              onClick={() => signOffMutation.mutate()}
            >
              {t.signOffButton}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!enabled || !pir || exportMutation.isPending}
              title={exportPrerequisiteReason}
              onClick={() => exportMutation.mutate('csv')}
            >
              <FileArchive className="me-2 h-4 w-4" aria-hidden />
              CSV
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!enabled || !pir || exportMutation.isPending}
              title={exportPrerequisiteReason}
              onClick={() => exportMutation.mutate('pdf')}
            >
              <FileArchive className="me-2 h-4 w-4" aria-hidden />
              PDF
            </Button>
          </div>
        </form>

        {exports.length ? (
          <div className="space-y-2">
            {exports.map((record) => (
              <ListRow
                key={record.id}
                leading={<FileArchive className="h-4 w-4" aria-hidden />}
                title={t.exportRecordTitle(record.format)}
                subtitle={t.exportRecordSubtitle(
                  formatDateTime(record.generated_at, common.unrecorded),
                )}
                trailing={<StatusBadge status={record.status} size="sm" />}
              >
                {record.download_url ? (
                  <a className="mt-2 inline-flex text-xs text-primary" href={record.download_url}>
                    {common.download}
                  </a>
                ) : null}
              </ListRow>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={FileArchive}
            title={t.emptyExportsTitle}
            description={t.emptyExportsDescription}
            size="compact"
          />
        )}
        <DisabledReason reason={pirPrerequisiteReason} />
      </CardContent>
    </Card>
  );
}

export function TimelinePanel({ cockpit }: { cockpit: RespondCockpit }) {
  const { timeline: t } = useRespondCommandLabels();
  const common = useRespondCommonLabels();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.title}</CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent>
        {cockpit.timeline.length ? (
          <div className="space-y-2">
            {cockpit.timeline.map((event) => (
              <ListRow
                key={event.id}
                leading={<Activity className="h-4 w-4" aria-hidden />}
                title={event.summary ?? event.event_type}
                subtitle={t.eventSubtitle(
                  event.event_type,
                  formatDateTime(event.occurred_at, common.unrecorded),
                )}
                trailing={
                  <span className="text-xs">
                    {event.actor_name ?? event.actor_id ?? common.system}
                  </span>
                }
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Activity}
            title={t.emptyTitle}
            description={t.emptyDescription}
            size="compact"
          />
        )}
      </CardContent>
    </Card>
  );
}

export function IncidentEvidencePanels(props: PromptPanelProps) {
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_0.9fr]">
      <PirEvidencePanel {...props} />
      <TimelinePanel cockpit={props.cockpit} />
    </div>
  );
}
