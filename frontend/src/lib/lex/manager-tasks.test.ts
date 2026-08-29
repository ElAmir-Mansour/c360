import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiGetMock, apiPostMock } = vi.hoisted(() => ({
  apiGetMock: vi.fn(),
  apiPostMock: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  apiGet: apiGetMock,
  apiPost: apiPostMock,
}));

import { managerTasksApi } from './manager-tasks';

const BASE = '/api/v1/lex/manager-tasks';
const task = {
  id: 'task/1',
  tenant_id: 'tenant-1',
  title: 'Review renewal',
  description: 'Review the renewal pack',
  assignee_id: 'user-1',
  status: 'assigned' as const,
  created_by: 'manager-1',
  created_at: '2026-07-31T10:00:00Z',
  updated_at: '2026-07-31T10:00:00Z',
};

describe('managerTasksApi', () => {
  beforeEach(() => {
    apiGetMock.mockReset();
    apiPostMock.mockReset();
  });

  it('lists manager tasks using the backend pagination and filters', async () => {
    const response = {
      data: [task],
      meta: { page: 1, per_page: 20, total: 1, total_pages: 1 },
    };
    apiGetMock.mockResolvedValue(response);

    await expect(
      managerTasksApi.list({ page: 1, per_page: 20, status: 'assigned' }),
    ).resolves.toEqual(response);
    expect(apiGetMock).toHaveBeenCalledWith(BASE, {
      page: 1,
      per_page: 20,
      status: 'assigned',
    });
  });

  it('creates a task with the optional uploaded file id', async () => {
    apiPostMock.mockResolvedValue({ data: task });
    const payload = {
      title: task.title,
      description: task.description,
      assignee_id: task.assignee_id,
      attachment_file_id: 'file-1',
    };

    await expect(managerTasksApi.create(payload)).resolves.toEqual(task);
    expect(apiPostMock).toHaveBeenCalledWith(BASE, payload);
  });

  it('calls the assignee and director lifecycle commands', async () => {
    apiPostMock.mockResolvedValue({ data: task });

    await managerTasksApi.start(task.id);
    await managerTasksApi.submit(task.id, { result: 'Completed review' });
    await managerTasksApi.decide(task.id, {
      decision: 'return',
      note: 'Add the counterparty response.',
    });

    expect(apiPostMock).toHaveBeenNthCalledWith(1, `${BASE}/task%2F1/start`);
    expect(apiPostMock).toHaveBeenNthCalledWith(2, `${BASE}/task%2F1/submit`, {
      result: 'Completed review',
    });
    expect(apiPostMock).toHaveBeenNthCalledWith(3, `${BASE}/task%2F1/decision`, {
      decision: 'return',
      note: 'Add the counterparty response.',
    });
  });
});
