import type {
  BackendStepDefinition,
  BackendTransition,
  WorkflowStep,
  WorkflowStepConfig,
  WorkflowStepType,
  WorkflowTransition,
} from '@/types/models';

const DESIGNER_META_KEY = '_designer';

const DESIGNER_STEP_TYPES = new Set<WorkflowStepType>([
  'approval',
  'approval_chain',
  'review',
  'task',
  'notification',
  'condition',
  'parallel_gateway',
  'join_gateway',
  'delay',
  'webhook',
  'script',
  'sub_workflow',
  'end',
]);

type DesignerMeta = {
  display_type?: unknown;
  position?: unknown;
  timeout_minutes?: unknown;
  on_timeout?: unknown;
  assignee_strategy?: unknown;
};

type TransitionLike = Partial<BackendTransition & WorkflowTransition> & Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function isWorkflowStepType(value: unknown): value is WorkflowStepType {
  return typeof value === 'string' && DESIGNER_STEP_TYPES.has(value as WorkflowStepType);
}

function normalizeConfig(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const { [DESIGNER_META_KEY]: _designer, ...config } = value;
  return config;
}

function designerMeta(value: unknown): DesignerMeta {
  if (!isRecord(value)) return {};
  const meta = value[DESIGNER_META_KEY];
  return isRecord(meta) ? meta : {};
}

function normalizePosition(value: unknown, index: number): WorkflowStep['position'] {
  if (isRecord(value) && typeof value.x === 'number' && typeof value.y === 'number') {
    return { x: value.x, y: value.y };
  }
  return { x: index * 280, y: 160 };
}

function normalizeStepType(rawType: unknown, config: Record<string, unknown>, meta: DesignerMeta): WorkflowStepType {
  if (isWorkflowStepType(meta.display_type)) return meta.display_type;
  if (isWorkflowStepType(rawType)) return rawType;

  switch (rawType) {
    case 'human_task':
      return config.approval_type ? 'approval' : 'task';
    case 'approval_chain':
      return 'approval_chain';
    case 'service_task':
      if (config.notification_template || config.notification_channels) return 'notification';
      if (config.webhook_url || config.webhook_method) return 'webhook';
      if (config.sub_workflow_id) return 'sub_workflow';
      return 'script';
    case 'event_task':
      return 'webhook';
    case 'timer':
      return 'delay';
    case 'condition':
    case 'parallel_gateway':
    case 'end':
      return rawType;
    default:
      return 'task';
  }
}

function normalizeAssigneeStrategy(value: unknown): WorkflowStep['assignee_strategy'] {
  if (isRecord(value) && typeof value.type === 'string') {
    return value as WorkflowStep['assignee_strategy'];
  }
  return { type: 'role', role_id: '' };
}

function normalizeTimeout(value: unknown): WorkflowStep['timeout_minutes'] {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeOnTimeout(value: unknown): WorkflowStep['on_timeout'] {
  return value === 'skip' || value === 'escalate' || value === 'fail' ? value : 'fail';
}

function normalizeTransition(stepId: string, transition: unknown, index: number): WorkflowTransition | null {
  if (!isRecord(transition)) return null;
  const t = transition as TransitionLike;
  const target = stringValue(t.target_step_id) ?? stringValue(t.target);
  if (!target) return null;

  return {
    id: stringValue(t.id) ?? `${stepId}-${target}-${index}`,
    target_step_id: target,
    label: stringValue(t.label) ?? '',
    ...(t.condition !== undefined
      ? { condition: t.condition as WorkflowTransition['condition'] }
      : {}),
  };
}

export function toDesignerSteps(steps: unknown): WorkflowStep[] {
  if (!Array.isArray(steps)) return [];

  return steps
    .filter(isRecord)
    .map((step, index) => {
      const rawConfig = step.config;
      const meta = designerMeta(rawConfig);
      const config = normalizeConfig(rawConfig);
      const id = stringValue(step.id) ?? `step_${index + 1}`;

      return {
        id,
        name: stringValue(step.name) ?? `Step ${index + 1}`,
        type: normalizeStepType(step.type, config, meta),
        config: config as WorkflowStepConfig,
        position: normalizePosition(step.position ?? meta.position, index),
        transitions: Array.isArray(step.transitions)
          ? step.transitions
              .map((transition, transitionIndex) =>
                normalizeTransition(id, transition, transitionIndex),
              )
              .filter((transition): transition is WorkflowTransition => transition !== null)
          : [],
        timeout_minutes: normalizeTimeout(step.timeout_minutes ?? meta.timeout_minutes),
        on_timeout: normalizeOnTimeout(step.on_timeout ?? meta.on_timeout),
        assignee_strategy: normalizeAssigneeStrategy(step.assignee_strategy ?? meta.assignee_strategy),
      };
    });
}

function backendStepType(type: WorkflowStepType): string {
  switch (type) {
    case 'approval':
    case 'review':
    case 'task':
      return 'human_task';
    case 'approval_chain':
      return 'approval_chain';
    case 'notification':
    case 'webhook':
    case 'script':
    case 'sub_workflow':
      return 'service_task';
    case 'delay':
      return 'timer';
    case 'join_gateway':
      return 'parallel_gateway';
    case 'condition':
    case 'parallel_gateway':
    case 'end':
      return type;
    default:
      return 'human_task';
  }
}

function quoteLiteral(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function expressionValue(value: unknown): string {
  if (typeof value === 'string') return quoteLiteral(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(expressionValue).join(', ')}]`;
  return quoteLiteral(JSON.stringify(value));
}

function conditionExpression(condition: WorkflowTransition['condition']): string | undefined {
  if (!condition) return undefined;
  if (typeof condition === 'string') return condition.trim() || undefined;

  const field = condition.field;
  if (!field) return undefined;

  switch (String(condition.operator)) {
    case 'eq':
      return `${field} == ${expressionValue(condition.value)}`;
    case 'neq':
      return `${field} != ${expressionValue(condition.value)}`;
    case 'gt':
      return `${field} > ${expressionValue(condition.value)}`;
    case 'gte':
      return `${field} >= ${expressionValue(condition.value)}`;
    case 'lt':
      return `${field} < ${expressionValue(condition.value)}`;
    case 'lte':
      return `${field} <= ${expressionValue(condition.value)}`;
    case 'in':
      return `${field} in ${expressionValue(condition.value)}`;
    case 'notIn':
    case 'not_in':
      return `!(${field} in ${expressionValue(condition.value)})`;
    case 'truthy':
    case 'isSet':
      return `${field} != null`;
    case 'falsy':
      return `${field} == false`;
    case 'isEmpty':
      return `${field} == ''`;
    case 'contains':
    case 'matches':
      return `${field} == ${expressionValue(condition.value)}`;
    default:
      return undefined;
  }
}

function backendTransition(transition: WorkflowTransition): BackendTransition {
  const condition = conditionExpression(transition.condition);
  return {
    target: transition.target_step_id,
    ...(condition ? { condition } : {}),
  };
}

export function toBackendSteps(steps: WorkflowStep[]): BackendStepDefinition[] {
  return steps.map((step) => ({
    id: step.id,
    name: step.name,
    type: backendStepType(step.type),
    config: {
      ...step.config,
      [DESIGNER_META_KEY]: {
        display_type: step.type,
        position: step.position,
        timeout_minutes: step.timeout_minutes,
        on_timeout: step.on_timeout,
        assignee_strategy: step.assignee_strategy,
      },
    },
    transitions: (Array.isArray(step.transitions) ? step.transitions : []).map(backendTransition),
  }));
}
