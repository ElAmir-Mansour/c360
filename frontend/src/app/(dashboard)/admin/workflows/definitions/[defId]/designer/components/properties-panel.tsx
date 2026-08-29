'use client';

import { useCallback, useEffect, useState } from 'react';
import { Braces, Trash2, Users, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CodeEditor } from '@/components/shared/code-editor';
import { AsyncRecordPicker, type RecordPickerOption } from '@/components/shared/forms/async-record-picker';
import { TenantUserPicker } from '@/components/shared/forms/tenant-user-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ConditionBuilder } from './condition-builder';
import { FormSchemaBuilder } from './form-schema-builder';
import { ApprovalChainEditor } from './approval-chain-editor';
import { TriggerConfigEditor } from './trigger-config-editor';
import { VariablesEditor } from './variables-editor';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { useAdminT } from '../../../../../_lib/admin-i18n';
import { apiGet } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import type { PaginatedResponse } from '@/types/api';
import {
  formatChannelLabel,
  formatStepTypeLabel,
  getDefinitionLabels,
} from '../../../definition-i18n';
import type {
  WorkflowStep,
  WorkflowStepConfig,
  WorkflowTransition,
  WorkflowCondition,
  AssigneeStrategy,
  FormField,
  BackendTriggerConfig,
  BackendVariableDef,
  Role,
  WorkflowDefinition,
} from '@/types/models';

const PICKER_PAGE_SIZE = 50;

const PICKER_COPY = {
  en: {
    selectUser: 'Select a user',
    searchUsers: 'Search by name or email…',
    noUsers: 'No matching users.',
    useVariable: 'Use workflow variable',
    chooseUser: 'Choose a user',
    variablePlaceholder: '${variables.user_id}',
    selectRole: 'Select a role',
    searchRoles: 'Search roles…',
    noRoles: 'No matching roles.',
    selectWorkflow: 'Select a workflow',
    searchWorkflows: 'Search workflows…',
    noWorkflows: 'No matching workflows.',
  },
  ar: {
    selectUser: 'اختر مستخدمًا',
    searchUsers: 'ابحث بالاسم أو البريد الإلكتروني…',
    noUsers: 'لا يوجد مستخدمون مطابقون.',
    useVariable: 'استخدام متغير سير العمل',
    chooseUser: 'اختيار مستخدم',
    variablePlaceholder: '${variables.user_id}',
    selectRole: 'اختر دورًا',
    searchRoles: 'ابحث في الأدوار…',
    noRoles: 'لا توجد أدوار مطابقة.',
    selectWorkflow: 'اختر سير عمل',
    searchWorkflows: 'ابحث في مسارات العمل…',
    noWorkflows: 'لا توجد مسارات عمل مطابقة.',
  },
} as const;

async function loadRoleIdOptions(search: string): Promise<RecordPickerOption[]> {
  const roles = await apiGet<Role[]>(API_ENDPOINTS.ROLES);
  const needle = search.toLocaleLowerCase();
  return roles
    .filter((role) =>
      !needle || [role.name, role.slug, role.description].some((value) => value?.toLocaleLowerCase().includes(needle)),
    )
    .map((role) => ({
      value: role.id,
      label: role.name,
      description: role.slug,
      keywords: [role.slug, role.description],
    }));
}

async function loadWorkflowOptions(search: string): Promise<RecordPickerOption[]> {
  const response = await apiGet<PaginatedResponse<WorkflowDefinition>>(
    API_ENDPOINTS.WORKFLOWS_DEFINITIONS,
    {
      page: 1,
      per_page: PICKER_PAGE_SIZE,
      sort: 'name',
      order: 'asc',
      search: search || undefined,
    },
  );
  return response.data.map((definition) => ({
    value: definition.id,
    label: definition.name,
    description: `${definition.status} · v${definition.version}`,
    keywords: [definition.description, definition.status],
  }));
}

function isVariableReference(value: string): boolean {
  return value.trim().startsWith('${');
}

interface UserReferencePickerProps {
  value: string;
  onChange: (value: string) => void;
  readOnly: boolean;
  locale: string;
  ariaLabel: string;
}

/** Literal assignees come from the directory; dynamic workflow references remain editable. */
function UserReferencePicker({
  value,
  onChange,
  readOnly,
  locale,
  ariaLabel,
}: UserReferencePickerProps) {
  const copy = locale === 'ar' ? PICKER_COPY.ar : PICKER_COPY.en;
  const [variableMode, setVariableMode] = useState(() => isVariableReference(value));

  useEffect(() => {
    // Keep persisted dynamic references in variable mode. Literal selections
    // switch modes through the explicit directory button, so in-progress
    // variable typing (including a temporary "$" prefix) is never interrupted.
    if (isVariableReference(value)) setVariableMode(true);
  }, [value]);

  return (
    <div className="mt-1 flex min-w-0 items-center gap-1.5">
      {variableMode ? (
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={copy.variablePlaceholder}
          disabled={readOnly}
          aria-label={ariaLabel}
          className="h-8 min-w-0 flex-1 text-sm"
        />
      ) : (
        <TenantUserPicker
          ariaLabel={ariaLabel}
          value={value}
          onChange={onChange}
          disabled={readOnly}
          allowClear={!readOnly}
          labels={{
            select: copy.selectUser,
            search: copy.searchUsers,
            empty: copy.noUsers,
          }}
          className="min-w-0 flex-1 [&_button]:h-8 [&_button]:text-sm"
        />
      )}
      {!readOnly ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-8 w-8 shrink-0"
          title={variableMode ? copy.chooseUser : copy.useVariable}
          aria-label={variableMode ? copy.chooseUser : copy.useVariable}
          onClick={() => {
            setVariableMode(!variableMode);
            onChange('');
          }}
        >
          {variableMode ? <Users className="h-3.5 w-3.5" /> : <Braces className="h-3.5 w-3.5" />}
        </Button>
      ) : null}
    </div>
  );
}

// ── Step Properties ──

interface StepPropertiesPanelProps {
  mode: 'step';
  step: WorkflowStep;
  onUpdate: (updates: Partial<WorkflowStep>) => void;
  onRemove: () => void;
  onClose: () => void;
  readOnly: boolean;
}

// ── Transition Properties ──

interface TransitionPropertiesPanelProps {
  mode: 'transition';
  transition: WorkflowTransition;
  fromStepName: string;
  toStepName: string;
  onUpdateTransition: (updates: Partial<WorkflowTransition>) => void;
  onRemoveTransition: () => void;
  onClose: () => void;
  readOnly: boolean;
}

// ── Definition Settings Properties ──

interface DefinitionPropertiesPanelProps {
  mode: 'definition';
  triggerConfig: BackendTriggerConfig;
  variables: Record<string, BackendVariableDef>;
  onUpdateTrigger: (next: BackendTriggerConfig) => void;
  onUpdateVariables: (next: Record<string, BackendVariableDef>) => void;
  onClose: () => void;
  readOnly: boolean;
}

export type PropertiesPanelProps =
  | StepPropertiesPanelProps
  | TransitionPropertiesPanelProps
  | DefinitionPropertiesPanelProps;

export function PropertiesPanel(props: PropertiesPanelProps) {
  if (props.mode === 'transition') {
    return <TransitionPanel {...props} />;
  }
  if (props.mode === 'definition') {
    return <DefinitionPanel {...props} />;
  }
  return <StepPanel {...props} />;
}

// ── Definition Settings Panel ──

function DefinitionPanel({
  triggerConfig,
  variables,
  onUpdateTrigger,
  onUpdateVariables,
  onClose,
  readOnly,
}: DefinitionPropertiesPanelProps) {
  const { locale, direction } = useLocaleOrDefault();
  const localLabels = getDefinitionLabels(locale);

  return (
    <div className="w-80 border-s bg-background overflow-y-auto" dir={direction}>
      <div className="flex items-center justify-between p-3 border-b">
        <h3 className="text-sm font-semibold">
          {localLabels.designer.workflowSettings}
        </h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="p-3 space-y-5">
        <TriggerConfigEditor
          value={triggerConfig}
          onChange={onUpdateTrigger}
          readOnly={readOnly}
        />
        <div className="border-t pt-4">
          <VariablesEditor
            value={variables}
            onChange={onUpdateVariables}
            readOnly={readOnly}
          />
        </div>
      </div>
    </div>
  );
}

// ── Transition Panel ──

function TransitionPanel({
  transition,
  fromStepName,
  toStepName,
  onUpdateTransition,
  onRemoveTransition,
  onClose,
  readOnly,
}: TransitionPropertiesPanelProps) {
  const labels = useAdminT();
  const rawCondition =
    typeof transition.condition === 'string' ? transition.condition : null;
  const structuredCondition =
    transition.condition && typeof transition.condition !== 'string'
      ? transition.condition
      : undefined;

  return (
    <div className="w-72 border-s bg-background overflow-y-auto">
      <div className="flex items-center justify-between p-3 border-b">
        <h3 className="text-sm font-semibold">{labels.designer.transition}</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="p-3 space-y-4">
        {/* From → To */}
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{fromStepName}</span>
          {' → '}
          <span className="font-medium text-foreground">{toStepName}</span>
        </div>

        {/* Label */}
        <div className="space-y-1.5">
          <Label htmlFor="transition-label" className="text-xs">{labels.designer.label}</Label>
          <Input
            id="transition-label"
            value={transition.label}
            onChange={(e) => onUpdateTransition({ label: e.target.value })}
            placeholder={labels.designer.phTransitionLabel}
            disabled={readOnly}
            className="h-8 text-sm"
          />
        </div>

        {/* Condition */}
        {rawCondition !== null ? (
          <div className="space-y-1.5">
            <Label htmlFor="transition-condition" className="text-xs">
              {labels.designer.conditionExpression}
            </Label>
            <Input
              id="transition-condition"
              value={rawCondition}
              onChange={(e) =>
                onUpdateTransition({
                  condition: e.target.value || undefined,
                })
              }
              placeholder="variables.amount > 1000"
              disabled={readOnly}
              className="h-8 text-sm"
            />
          </div>
        ) : (
          <ConditionBuilder<WorkflowCondition>
            conditions={structuredCondition ? [structuredCondition] : []}
            onChange={(conditions) =>
              onUpdateTransition({ condition: conditions[0] ?? undefined })
            }
            readOnly={readOnly}
          />
        )}

        {/* Remove */}
        {!readOnly && (
          <Button
            variant="destructive"
            size="sm"
            className="w-full mt-4"
            onClick={onRemoveTransition}
          >
            <Trash2 className="me-1.5 h-3.5 w-3.5" />
            {labels.designer.removeTransition}
          </Button>
        )}
      </div>
    </div>
  );
}

// ── Step Panel ──

function parseWebhookHeaders(text: string): Record<string, string> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  if (!Object.values(parsed).every((v) => typeof v === 'string')) {
    return null;
  }
  return parsed as Record<string, string>;
}

function StepPanel({
  step,
  onUpdate,
  onRemove,
  onClose,
  readOnly,
}: StepPropertiesPanelProps) {
  const labels = useAdminT();
  const { locale } = useLocaleOrDefault();
  const updateConfig = useCallback(
    (configUpdates: Partial<WorkflowStepConfig>) => {
      onUpdate({ config: { ...step.config, ...configUpdates } });
    },
    [step.config, onUpdate],
  );

  // Local text state for webhook headers — only committed when it parses to a
  // valid JSON object of string values. Re-seeded when the selected step changes.
  const [headersText, setHeadersText] = useState(() =>
    JSON.stringify(step.config.webhook_headers ?? {}, null, 2),
  );
  const [headersError, setHeadersError] = useState<string | null>(null);

  useEffect(() => {
    setHeadersText(JSON.stringify(step.config.webhook_headers ?? {}, null, 2));
    setHeadersError(null);
    // Re-seed only on step selection change; depending on webhook_headers
    // would clobber in-progress edits after each committed parse.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.id]);

  const handleHeadersChange = useCallback(
    (text: string) => {
      setHeadersText(text);
      const parsed = parseWebhookHeaders(text);
      if (parsed) {
        updateConfig({ webhook_headers: parsed });
        setHeadersError(null);
      } else {
        setHeadersError(labels.designer.headersError);
      }
    },
    [labels.designer.headersError, updateConfig],
  );

  const updateAssignee = useCallback(
    (strategyType: string) => {
      const strategies: Record<string, AssigneeStrategy> = {
        specific_user: { type: 'specific_user', user_id: '' },
        role: { type: 'role', role_id: '' },
        manager_of: { type: 'manager_of', relative_to: 'initiator' },
        round_robin: { type: 'round_robin', user_pool: [] },
        least_loaded: { type: 'least_loaded', role_id: '' },
      };
      onUpdate({ assignee_strategy: strategies[strategyType] ?? strategies.role });
    },
    [onUpdate],
  );

  // `approval_chain` is a human step but carries its own approver model
  // (approvers/mode/quorum) — it must NOT show the single-assignee strategy or
  // the form-schema builder, so it is intentionally excluded from `isHuman`.
  const isHuman = ['approval', 'review', 'task'].includes(step.type);

  return (
    <div className="w-80 border-s bg-background overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b">
        <h3 className="text-sm font-semibold">{labels.designer.properties}</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="p-3 space-y-4">
        {/* Name */}
        <div className="space-y-1.5">
          <Label htmlFor="step-name" className="text-xs">{labels.designer.name}</Label>
          <Input
            id="step-name"
            value={step.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            disabled={readOnly}
            className="h-8 text-sm"
          />
        </div>

        {/* Type (read-only) */}
        <div className="space-y-1.5">
          <Label className="text-xs">{labels.designer.type}</Label>
          <div className="text-sm text-muted-foreground">
            {formatStepTypeLabel(step.type, locale)}
          </div>
        </div>

        {/* ── Type-specific config ── */}

        {/* Approval config */}
        {step.type === 'approval' && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="approval-type" className="text-xs">{labels.designer.approvalType}</Label>
              <Select
                value={step.config.approval_type ?? 'single'}
                onValueChange={(v) =>
                  updateConfig({ approval_type: v as 'single' | 'unanimous' | 'majority' })
                }
                disabled={readOnly}
              >
                <SelectTrigger id="approval-type" className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">{labels.designer.singleApprover}</SelectItem>
                  <SelectItem value="unanimous">{labels.designer.unanimous}</SelectItem>
                  <SelectItem value="majority">{labels.designer.majority}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(step.config.approval_type === 'majority' ||
              step.config.approval_type === 'unanimous') && (
              <div className="space-y-1.5">
                <Label htmlFor="min-approvers" className="text-xs">{labels.designer.minApprovers}</Label>
                <Input
                  id="min-approvers"
                  type="number"
                  min={1}
                  value={step.config.min_approvers ?? 1}
                  onChange={(e) =>
                    updateConfig({ min_approvers: parseInt(e.target.value, 10) || 1 })
                  }
                  disabled={readOnly}
                  className="h-8 text-sm"
                />
              </div>
            )}
          </>
        )}

        {/* Approval-chain config (multi-approver) */}
        {step.type === 'approval_chain' && (
          <ApprovalChainEditor
            value={step.config}
            onChange={(patch) => updateConfig(patch)}
            readOnly={readOnly}
          />
        )}

        {/* Notification config */}
        {step.type === 'notification' && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="notif-template" className="text-xs">{labels.designer.template}</Label>
              <Input
                id="notif-template"
                value={step.config.notification_template ?? ''}
                onChange={(e) =>
                  updateConfig({ notification_template: e.target.value })
                }
                placeholder={labels.designer.phTemplate}
                disabled={readOnly}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{labels.designer.channels}</Label>
              <div className="flex flex-wrap gap-1">
                {(['email', 'in_app', 'webhook'] as const).map((ch) => {
                  const active = step.config.notification_channels?.includes(ch);
                  return (
                    <button
                      key={ch}
                      type="button"
                      className={`px-2 py-0.5 text-xs rounded-full border ${
                        active
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground'
                      }`}
                      disabled={readOnly}
                      onClick={() => {
                        const current = step.config.notification_channels ?? [];
                        updateConfig({
                          notification_channels: active
                            ? current.filter((c) => c !== ch)
                            : [...current, ch],
                        });
                      }}
                    >
                      {formatChannelLabel(ch, locale)}
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* Delay config */}
        {step.type === 'delay' && (
          <div className="space-y-1.5">
            <Label htmlFor="delay-minutes" className="text-xs">{labels.designer.delayMinutes}</Label>
            <Input
              id="delay-minutes"
              type="number"
              min={1}
              value={step.config.delay_minutes ?? 60}
              onChange={(e) =>
                updateConfig({ delay_minutes: parseInt(e.target.value, 10) || 60 })
              }
              disabled={readOnly}
              className="h-8 text-sm"
            />
          </div>
        )}

        {/* Webhook config */}
        {step.type === 'webhook' && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="webhook-url" className="text-xs">{labels.designer.url}</Label>
              <Input
                id="webhook-url"
                value={step.config.webhook_url ?? ''}
                onChange={(e) => updateConfig({ webhook_url: e.target.value })}
                placeholder="https://..."
                disabled={readOnly}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="webhook-method" className="text-xs">{labels.designer.method}</Label>
              <Select
                value={step.config.webhook_method ?? 'POST'}
                onValueChange={(v) =>
                  updateConfig({ webhook_method: v as 'GET' | 'POST' | 'PUT' })
                }
                disabled={readOnly}
              >
                <SelectTrigger id="webhook-method" className="h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GET">GET</SelectItem>
                  <SelectItem value="POST">POST</SelectItem>
                  <SelectItem value="PUT">PUT</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{labels.designer.headersJson}</Label>
              <CodeEditor
                value={headersText}
                onChange={handleHeadersChange}
                language="json"
                height={120}
                readOnly={readOnly}
                ariaLabel={labels.designer.ariaHeaders}
              />
              {headersError && (
                <p role="alert" className="text-xs text-destructive">
                  {headersError}
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{labels.designer.bodyTemplate}</Label>
              <CodeEditor
                value={step.config.webhook_body_template ?? ''}
                onChange={(v) => updateConfig({ webhook_body_template: v })}
                language="json"
                height={160}
                readOnly={readOnly}
                ariaLabel={labels.designer.ariaBody}
              />
            </div>
          </>
        )}

        {/* Sub-workflow config */}
        {step.type === 'sub_workflow' && (
          <div className="space-y-1.5">
            <Label htmlFor="sub-workflow-id" className="text-xs">{labels.designer.subWorkflowId}</Label>
            <AsyncRecordPicker
              id="sub-workflow-id"
              ariaLabel={labels.designer.subWorkflowId}
              queryKey={['workflow-definition-picker']}
              loadOptions={loadWorkflowOptions}
              value={step.config.sub_workflow_id ?? ''}
              onChange={(definitionId) => updateConfig({ sub_workflow_id: definitionId })}
              disabled={readOnly}
              allowClear={!readOnly}
              labels={{
                select: (locale === 'ar' ? PICKER_COPY.ar : PICKER_COPY.en).selectWorkflow,
                search: (locale === 'ar' ? PICKER_COPY.ar : PICKER_COPY.en).searchWorkflows,
                empty: (locale === 'ar' ? PICKER_COPY.ar : PICKER_COPY.en).noWorkflows,
              }}
              className="[&_button]:h-8 [&_button]:text-sm"
            />
          </div>
        )}

        {/* Script config */}
        {step.type === 'script' && (
          <div className="space-y-1.5">
            <Label htmlFor="script-id" className="text-xs">{labels.designer.scriptId}</Label>
            <Input
              id="script-id"
              value={step.config.script_id ?? ''}
              onChange={(e) => updateConfig({ script_id: e.target.value })}
              disabled={readOnly}
              className="h-8 text-sm"
            />
          </div>
        )}

        {/* Condition step config */}
        {step.type === 'condition' && (
          <ConditionBuilder
            conditions={(step.config.conditions as WorkflowCondition[]) ?? []}
            onChange={(conditions) => updateConfig({ conditions })}
            readOnly={readOnly}
          />
        )}

        {/* ── Assignee Strategy (human steps only) ── */}
        {isHuman && step.assignee_strategy && (
          <div className="space-y-1.5">
            <Label htmlFor="assignee-strategy" className="text-xs">{labels.designer.assigneeStrategy}</Label>
            <Select
              value={step.assignee_strategy.type}
              onValueChange={updateAssignee}
              disabled={readOnly}
            >
              <SelectTrigger id="assignee-strategy" className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="specific_user">{labels.designer.specificUser}</SelectItem>
                <SelectItem value="role">{labels.designer.byRole}</SelectItem>
                <SelectItem value="manager_of">{labels.designer.managerOf}</SelectItem>
                <SelectItem value="round_robin">{labels.designer.roundRobin}</SelectItem>
                <SelectItem value="least_loaded">{labels.designer.leastLoaded}</SelectItem>
              </SelectContent>
            </Select>
            {step.assignee_strategy.type === 'specific_user' && (
              <UserReferencePicker
                value={step.assignee_strategy.user_id}
                onChange={(userId) =>
                  onUpdate({
                    assignee_strategy: {
                      type: 'specific_user',
                      user_id: userId,
                    },
                  })
                }
                readOnly={readOnly}
                locale={locale}
                ariaLabel={labels.designer.phUserId}
              />
            )}
            {(step.assignee_strategy.type === 'role' ||
              step.assignee_strategy.type === 'least_loaded') && (
              <AsyncRecordPicker
                ariaLabel={labels.designer.phRoleId}
                queryKey={['workflow-role-id-picker']}
                loadOptions={loadRoleIdOptions}
                value={step.assignee_strategy.role_id}
                onChange={(roleId) =>
                  onUpdate({
                    assignee_strategy: {
                      ...step.assignee_strategy,
                      role_id: roleId,
                    } as AssigneeStrategy,
                  })
                }
                disabled={readOnly}
                allowClear={!readOnly}
                labels={{
                  select: (locale === 'ar' ? PICKER_COPY.ar : PICKER_COPY.en).selectRole,
                  search: (locale === 'ar' ? PICKER_COPY.ar : PICKER_COPY.en).searchRoles,
                  empty: (locale === 'ar' ? PICKER_COPY.ar : PICKER_COPY.en).noRoles,
                }}
                className="mt-1 [&_button]:h-8 [&_button]:text-sm"
              />
            )}
          </div>
        )}

        {/* ── Form Schema Builder (human steps only) ── */}
        {isHuman && (
          <FormSchemaBuilder
            fields={(step.config.form_schema as FormField[]) ?? []}
            onChange={(fields) => updateConfig({ form_schema: fields })}
            readOnly={readOnly}
          />
        )}

        {/* ── Timeout ── */}
        <div className="space-y-1.5">
          <Label htmlFor="timeout" className="text-xs">{labels.designer.timeoutMinutes}</Label>
          <Input
            id="timeout"
            type="number"
            min={0}
            value={step.timeout_minutes ?? ''}
            onChange={(e) =>
              onUpdate({
                timeout_minutes: e.target.value ? parseInt(e.target.value, 10) : null,
              })
            }
            placeholder={labels.designer.phNoTimeout}
            disabled={readOnly}
            className="h-8 text-sm"
          />
        </div>

        {step.timeout_minutes && (
          <div className="space-y-1.5">
            <Label htmlFor="on-timeout" className="text-xs">{labels.designer.onTimeout}</Label>
            <Select
              value={step.on_timeout}
              onValueChange={(v) =>
                onUpdate({ on_timeout: v as 'skip' | 'escalate' | 'fail' })
              }
              disabled={readOnly}
            >
              <SelectTrigger id="on-timeout" className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="skip">{labels.designer.skip}</SelectItem>
                <SelectItem value="escalate">{labels.designer.escalate}</SelectItem>
                <SelectItem value="fail">{labels.designer.fail}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Delete button */}
        {!readOnly && (
          <Button
            variant="destructive"
            size="sm"
            className="w-full mt-4"
            onClick={onRemove}
          >
            <Trash2 className="me-1.5 h-3.5 w-3.5" />
            {labels.designer.removeStep}
          </Button>
        )}
      </div>
    </div>
  );
}
