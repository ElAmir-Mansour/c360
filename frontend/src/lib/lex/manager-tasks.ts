import { apiGet, apiPost } from '@/lib/api';

const MANAGER_TASKS_ENDPOINT = '/api/v1/lex/manager-tasks';

export type ManagerTaskStatus =
  | 'assigned'
  | 'in_progress'
  | 'submitted'
  | 'correction_required'
  | 'accepted'
  | 'cancelled';

export interface ManagerTaskAttachment {
  file_id: string;
  original_name: string;
  content_type: string;
  size_bytes: number;
  checksum_sha256: string;
  file_version: number;
  virus_scan_status: string;
  uploaded_by: string;
}

export interface ManagerTask {
  id: string;
  tenant_id: string;
  title: string;
  description: string;
  assignee_id: string;
  status: ManagerTaskStatus;
  attachment?: ManagerTaskAttachment;
  result?: string;
  correction_note?: string;
  created_by: string;
  submitted_at?: string;
  reviewed_by?: string;
  reviewed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ManagerTaskPagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

interface ManagerTaskEnvelope {
  data: ManagerTask;
}

interface ManagerTaskListEnvelope {
  data: ManagerTask[];
  meta: ManagerTaskPagination;
}

export interface ListManagerTasksParams {
  page?: number;
  per_page?: number;
  status?: ManagerTaskStatus;
  assignee_id?: string;
}

export interface CreateManagerTaskPayload {
  title: string;
  description: string;
  assignee_id: string;
  attachment_file_id?: string;
}

export interface SubmitManagerTaskPayload {
  result: string;
}

export interface DecideManagerTaskPayload {
  decision: 'accept' | 'return';
  note?: string;
}

function taskPath(id: string, suffix = ''): string {
  return `${MANAGER_TASKS_ENDPOINT}/${encodeURIComponent(id)}${suffix}`;
}

export const managerTasksApi = {
  list: (params: ListManagerTasksParams = {}): Promise<ManagerTaskListEnvelope> =>
    apiGet<ManagerTaskListEnvelope>(MANAGER_TASKS_ENDPOINT, params),

  get: (id: string): Promise<ManagerTask> =>
    apiGet<ManagerTaskEnvelope>(taskPath(id)).then((response) => response.data),

  create: (payload: CreateManagerTaskPayload): Promise<ManagerTask> =>
    apiPost<ManagerTaskEnvelope>(MANAGER_TASKS_ENDPOINT, payload).then(
      (response) => response.data,
    ),

  start: (id: string): Promise<ManagerTask> =>
    apiPost<ManagerTaskEnvelope>(taskPath(id, '/start')).then(
      (response) => response.data,
    ),

  submit: (id: string, payload: SubmitManagerTaskPayload): Promise<ManagerTask> =>
    apiPost<ManagerTaskEnvelope>(taskPath(id, '/submit'), payload).then(
      (response) => response.data,
    ),

  decide: (id: string, payload: DecideManagerTaskPayload): Promise<ManagerTask> =>
    apiPost<ManagerTaskEnvelope>(taskPath(id, '/decision'), payload).then(
      (response) => response.data,
    ),
};
