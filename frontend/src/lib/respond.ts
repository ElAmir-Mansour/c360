import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/lib/api';
import type { ApiResponse as DataEnvelope } from '@/types/api';
import type {
  AssignRespondRoleInput,
  ChangeRespondSeverityInput,
  ConfirmRespondTriageInput,
  CreateRespondEvidenceExportInput,
  CreateRespondStakeholderTokenInput,
  CreateRespondTaskInput,
  DeclareRespondIncidentInput,
  DecideRespondApprovalInput,
  IngestRespondIntegrationWebhookInput,
  MobilizeRespondRoleInput,
  RecordRespondTimelineEventInput,
  ReorderRespondTasksInput,
  RequestRespondApprovalInput,
  RespondApprovalGate,
  RespondCockpit,
  RespondCockpitQuickAction,
  RespondEvidenceExport,
  RespondIncident,
  RespondIncidentList,
  RespondIntegrationConnector,
  RespondIntegrationSyncResult,
  RespondPIR,
  RespondProduct,
  RespondRoleAssignment,
  RespondSeverityRecommendation,
  RespondStakeholderStatus,
  RespondStakeholderTokenResponse,
  RespondStakeholderUpdate,
  RespondTaskCard,
  RespondTaskGraph,
  SaveRespondIntegrationConfigInput,
  SendRespondStakeholderUpdateInput,
  SyncRespondIntegrationInput,
  TransitionRespondIncidentInput,
  UpdateRespondIncidentInput,
  UpdateRespondPIRInput,
  UpdateRespondTaskStatusInput,
} from '@/types/respond';

export type * from '@/types/respond';

const RESPOND_API_BASE = '/api/v1/respond';

const pathID = (value: string | number) => {
  const normalized = String(value).trim();
  if (!normalized || normalized === 'null' || normalized === 'undefined') {
    throw new Error('A valid Respond resource identifier is required.');
  }
  return encodeURIComponent(normalized);
};

export const RESPOND_ENDPOINTS = {
  product: `${RESPOND_API_BASE}/product`,
  incidents: `${RESPOND_API_BASE}/incidents`,
  incident: (incidentID: string) =>
    `${RESPOND_API_BASE}/incidents/${pathID(incidentID)}`,
  cockpit: (incidentID: string) =>
    `${RESPOND_API_BASE}/incidents/${pathID(incidentID)}/cockpit`,
  severity: (incidentID: string) =>
    `${RESPOND_API_BASE}/incidents/${pathID(incidentID)}/severity`,
  transitions: (incidentID: string) =>
    `${RESPOND_API_BASE}/incidents/${pathID(incidentID)}/transitions`,
  timeline: (incidentID: string) =>
    `${RESPOND_API_BASE}/incidents/${pathID(incidentID)}/timeline`,
  timelineStream: (incidentID: string) =>
    `${RESPOND_API_BASE}/incidents/${pathID(incidentID)}/timeline/stream`,
  stakeholderTokens: (incidentID: string) =>
    `${RESPOND_API_BASE}/incidents/${pathID(incidentID)}/stakeholder-tokens`,
  stakeholderStatus: (token: string) =>
    `${RESPOND_API_BASE}/stakeholder/${pathID(token)}`,
  severityRecommendation: (incidentID: string) =>
    `${RESPOND_API_BASE}/incidents/${pathID(incidentID)}/triage/recommendation`,
  triage: (incidentID: string) =>
    `${RESPOND_API_BASE}/incidents/${pathID(incidentID)}/triage`,
  serviceLinks: (incidentID: string) =>
    `${RESPOND_API_BASE}/incidents/${pathID(incidentID)}/services`,
  roleAssignments: (incidentID: string) =>
    `${RESPOND_API_BASE}/incidents/${pathID(incidentID)}/roles`,
  roleAssignment: (incidentID: string, assignmentID: string) =>
    `${RESPOND_API_BASE}/incidents/${pathID(incidentID)}/roles/${pathID(assignmentID)}`,
  roleMobilization: (incidentID: string, assignmentID: string) =>
    `${RESPOND_API_BASE}/incidents/${pathID(incidentID)}/roles/${pathID(assignmentID)}/mobilize`,
  taskTemplates: `${RESPOND_API_BASE}/task-templates`,
  tasks: (incidentID: string) =>
    `${RESPOND_API_BASE}/incidents/${pathID(incidentID)}/tasks`,
  task: (incidentID: string, taskID: string) =>
    `${RESPOND_API_BASE}/incidents/${pathID(incidentID)}/tasks/${pathID(taskID)}`,
  taskStatus: (incidentID: string, taskID: string) =>
    `${RESPOND_API_BASE}/incidents/${pathID(incidentID)}/tasks/${pathID(taskID)}/status`,
  taskOrder: (incidentID: string) =>
    `${RESPOND_API_BASE}/incidents/${pathID(incidentID)}/tasks/order`,
  integrationConfigs: `${RESPOND_API_BASE}/integrations/connectors`,
  integrationConfig: (connectorID: string) =>
    `${RESPOND_API_BASE}/integrations/connectors/${pathID(connectorID)}`,
  incidentIntegrations: (incidentID: string) =>
    `${RESPOND_API_BASE}/incidents/${pathID(incidentID)}/integrations`,
  incidentIntegrationSync: (incidentID: string, connectorID: string) =>
    `${RESPOND_API_BASE}/incidents/${pathID(incidentID)}/integrations/${pathID(connectorID)}/sync`,
  integrationWebhook: (tenantID: string, connectorID: string) =>
    `${RESPOND_API_BASE}/integrations/webhooks/${pathID(tenantID)}/${pathID(connectorID)}`,
  stakeholderUpdates: (incidentID: string) =>
    `${RESPOND_API_BASE}/incidents/${pathID(incidentID)}/stakeholder-updates`,
  approvals: (incidentID: string) =>
    `${RESPOND_API_BASE}/incidents/${pathID(incidentID)}/approvals`,
  approval: (incidentID: string, approvalID: string) =>
    `${RESPOND_API_BASE}/incidents/${pathID(incidentID)}/approvals/${pathID(approvalID)}`,
  approvalDecision: (incidentID: string, approvalID: string) =>
    `${RESPOND_API_BASE}/incidents/${pathID(incidentID)}/approvals/${pathID(approvalID)}/decision`,
  pir: (incidentID: string) =>
    `${RESPOND_API_BASE}/incidents/${pathID(incidentID)}/pir`,
  pirSignOff: (incidentID: string) =>
    `${RESPOND_API_BASE}/incidents/${pathID(incidentID)}/pir/sign-off`,
  evidenceExports: (incidentID: string) =>
    `${RESPOND_API_BASE}/incidents/${pathID(incidentID)}/evidence-exports`,
};

async function fetchRespondData<T>(
  url: string,
  params?: Record<string, unknown> | object,
): Promise<T> {
  const envelope = await apiGet<DataEnvelope<T>>(url, params);
  return envelope.data;
}

async function postRespondData<T>(url: string, data?: unknown): Promise<T> {
  const envelope = await apiPost<DataEnvelope<T>>(url, data);
  return envelope.data;
}

async function putRespondData<T>(url: string, data?: unknown): Promise<T> {
  const envelope = await apiPut<DataEnvelope<T>>(url, data);
  return envelope.data;
}

async function patchRespondData<T>(url: string, data?: unknown): Promise<T> {
  const envelope = await apiPatch<DataEnvelope<T>>(url, data);
  return envelope.data;
}

function graphTasks(graph: RespondTaskGraph): RespondTaskCard[] {
  return Array.isArray(graph.tasks) ? graph.tasks : [];
}

export function parseRespondFieldMappingText(value: string): Record<string, string> {
  return Object.fromEntries(
    value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [externalField, ...respondFieldParts] = line.split('=');
        return [externalField?.trim(), respondFieldParts.join('=').trim()];
      })
      .filter(([externalField, respondField]) => externalField && respondField),
  );
}

export function fetchRespondProduct(): Promise<RespondProduct> {
  return fetchRespondData<RespondProduct>(RESPOND_ENDPOINTS.product);
}

export function fetchRespondIncidents(params?: {
  page?: number;
  per_page?: number;
  status?: string;
  severity?: string;
}): Promise<RespondIncidentList> {
  return fetchRespondData<RespondIncidentList>(RESPOND_ENDPOINTS.incidents, params);
}

export function fetchRespondCockpit(incidentID: string): Promise<RespondCockpit> {
  return fetchRespondData<RespondCockpit>(RESPOND_ENDPOINTS.cockpit(incidentID));
}

export function fetchRespondIncident(incidentID: string): Promise<RespondIncident> {
  return fetchRespondData<RespondIncident>(RESPOND_ENDPOINTS.incident(incidentID));
}

export function declareRespondIncident(
  input: DeclareRespondIncidentInput,
): Promise<RespondIncident> {
  return postRespondData<RespondIncident>(RESPOND_ENDPOINTS.incidents, input);
}

export function updateRespondIncident(
  incidentID: string,
  input: UpdateRespondIncidentInput,
): Promise<RespondIncident> {
  return patchRespondData<RespondIncident>(RESPOND_ENDPOINTS.incident(incidentID), input);
}

export function changeRespondSeverity(
  incidentID: string,
  input: ChangeRespondSeverityInput,
): Promise<RespondIncident> {
  return postRespondData<RespondIncident>(RESPOND_ENDPOINTS.severity(incidentID), input);
}

export function transitionRespondIncident(
  incidentID: string,
  input: TransitionRespondIncidentInput,
): Promise<RespondIncident> {
  return postRespondData<RespondIncident>(RESPOND_ENDPOINTS.transitions(incidentID), input);
}

export function fetchRespondTimeline(
  incidentID: string,
  params?: { type?: string | string[]; limit?: number; page?: number; per_page?: number },
) {
  return fetchRespondData<RespondCockpit['timeline']>(
    RESPOND_ENDPOINTS.timeline(incidentID),
    params,
  );
}

export function recordRespondTimelineEvent(
  incidentID: string,
  input: RecordRespondTimelineEventInput,
) {
  return postRespondData<RespondCockpit['timeline'][number]>(
    RESPOND_ENDPOINTS.timeline(incidentID),
    input,
  );
}

export function fetchRespondStakeholderStatus(
  token: string,
): Promise<RespondStakeholderStatus> {
  return fetchRespondData<RespondStakeholderStatus>(
    RESPOND_ENDPOINTS.stakeholderStatus(token),
  );
}

export function createRespondStakeholderToken(
  incidentID: string,
  input: CreateRespondStakeholderTokenInput,
): Promise<RespondStakeholderTokenResponse> {
  return postRespondData<RespondStakeholderTokenResponse>(
    RESPOND_ENDPOINTS.stakeholderTokens(incidentID),
    input,
  );
}

export function requestRespondSeverityRecommendation(
  incidentID: string,
  input: ConfirmRespondTriageInput['impact_assessment'],
): Promise<RespondSeverityRecommendation> {
  return postRespondData<RespondSeverityRecommendation>(
    RESPOND_ENDPOINTS.severityRecommendation(incidentID),
    input,
  );
}

export function confirmRespondTriage(
  incidentID: string,
  input: ConfirmRespondTriageInput,
): Promise<RespondIncident> {
  return postRespondData<RespondIncident>(RESPOND_ENDPOINTS.triage(incidentID), input);
}

export function assignRespondRole(
  incidentID: string,
  input: AssignRespondRoleInput,
): Promise<RespondRoleAssignment> {
  return postRespondData<RespondRoleAssignment>(
    RESPOND_ENDPOINTS.roleAssignments(incidentID),
    input,
  );
}

export function releaseRespondRole(
  incidentID: string,
  assignmentID: string,
): Promise<RespondRoleAssignment> {
  return apiDelete<DataEnvelope<RespondRoleAssignment>>(
    RESPOND_ENDPOINTS.roleAssignment(incidentID, assignmentID),
  ).then((envelope) => envelope.data);
}

export function mobilizeRespondRole(
  incidentID: string,
  input: MobilizeRespondRoleInput,
): Promise<RespondRoleAssignment> {
  return postRespondData<RespondRoleAssignment>(
    RESPOND_ENDPOINTS.roleMobilization(incidentID, input.role_assignment_id),
    input,
  );
}

export function createRespondTask(
  incidentID: string,
  input: CreateRespondTaskInput,
): Promise<RespondTaskGraph> {
  return postRespondData<RespondTaskGraph>(RESPOND_ENDPOINTS.tasks(incidentID), input);
}

export function updateRespondTaskStatus(
  incidentID: string,
  taskID: string,
  input: UpdateRespondTaskStatusInput,
): Promise<RespondTaskGraph> {
  return patchRespondData<RespondTaskGraph>(
    RESPOND_ENDPOINTS.taskStatus(incidentID, taskID),
    input,
  );
}

export function reorderRespondTasks(
  incidentID: string,
  input: ReorderRespondTasksInput,
): Promise<RespondTaskCard[]> {
  return putRespondData<RespondTaskGraph>(RESPOND_ENDPOINTS.taskOrder(incidentID), input).then(
    graphTasks,
  );
}

export function saveRespondIntegrationConfig(
  input: SaveRespondIntegrationConfigInput,
): Promise<RespondIntegrationConnector> {
  const { connector_type, ...rest } = input;
  return postRespondData<RespondIntegrationConnector>(
    RESPOND_ENDPOINTS.integrationConfigs,
    {
      ...rest,
      kind: connector_type,
    },
  );
}

export function syncRespondIntegration(
  incidentID: string,
  input: SyncRespondIntegrationInput,
): Promise<RespondIntegrationSyncResult> {
  return postRespondData<RespondIntegrationSyncResult>(
    RESPOND_ENDPOINTS.incidentIntegrationSync(incidentID, input.connector_id),
    {
      action: input.action ?? 'sync',
      message: input.message ?? null,
    },
  );
}

export function ingestRespondIntegrationWebhook(
  input: IngestRespondIntegrationWebhookInput,
): Promise<RespondIntegrationSyncResult> {
  return postRespondData<RespondIntegrationSyncResult>(
    RESPOND_ENDPOINTS.integrationWebhook(input.tenant_id, input.connector_id),
    input.body,
  );
}

export function sendRespondStakeholderUpdate(
  incidentID: string,
  input: SendRespondStakeholderUpdateInput,
): Promise<RespondStakeholderUpdate> {
  return postRespondData<RespondStakeholderUpdate>(
    RESPOND_ENDPOINTS.stakeholderUpdates(incidentID),
    input,
  );
}

export function requestRespondApproval(
  incidentID: string,
  input: RequestRespondApprovalInput,
): Promise<RespondApprovalGate> {
  return postRespondData<RespondApprovalGate>(RESPOND_ENDPOINTS.approvals(incidentID), input);
}

export function decideRespondApproval(
  incidentID: string,
  approvalID: string,
  input: DecideRespondApprovalInput,
): Promise<RespondApprovalGate> {
  return postRespondData<RespondApprovalGate>(
    RESPOND_ENDPOINTS.approvalDecision(incidentID, approvalID),
    input,
  );
}

export function fetchRespondPIR(incidentID: string): Promise<RespondPIR> {
  return fetchRespondData<RespondPIR>(RESPOND_ENDPOINTS.pir(incidentID));
}

export function updateRespondPIR(
  incidentID: string,
  input: UpdateRespondPIRInput,
): Promise<RespondPIR> {
  return patchRespondData<RespondPIR>(RESPOND_ENDPOINTS.pir(incidentID), input);
}

export function signOffRespondPIR(incidentID: string): Promise<RespondPIR> {
  return postRespondData<RespondPIR>(RESPOND_ENDPOINTS.pirSignOff(incidentID), {});
}

export function createRespondEvidenceExport(
  incidentID: string,
  input: CreateRespondEvidenceExportInput,
): Promise<RespondEvidenceExport> {
  return postRespondData<RespondEvidenceExport>(
    RESPOND_ENDPOINTS.evidenceExports(incidentID),
    input,
  );
}

export async function executeRespondQuickAction(
  action: RespondCockpitQuickAction,
): Promise<void> {
  switch (action.method) {
    case 'POST':
      await apiPost<void>(action.endpoint, action.payload ?? {});
      return;
    case 'PUT':
      await apiPut<void>(action.endpoint, action.payload ?? {});
      return;
    case 'PATCH':
      await apiPatch<void>(action.endpoint, action.payload ?? {});
      return;
    case 'DELETE':
      await apiDelete<void>(action.endpoint);
      return;
  }
}
