import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { COOKIES } from '@/lib/constants';
import { getServerApiUrl } from '@/lib/env';
import { LOCALE_COOKIE_NAME, resolveAppLocale } from '@/lib/i18n';
import type { HumanTask, WorkflowInstance } from '@/types/models';

const API_BASE_URL = getServerApiUrl();

const WORKFLOW_METADATA_LABELS = {
  en: {
    workflows: 'Workflows',
    myTasks: 'My Tasks',
    browseWorkflows: 'Browse Workflows',
    taskDetail: 'Task Detail',
    workflowDetail: 'Workflow Detail',
  },
  ar: {
    workflows: 'سير العمل',
    myTasks: 'مهامي',
    browseWorkflows: 'استعراض سير العمل',
    taskDetail: 'تفاصيل المهمة',
    workflowDetail: 'تفاصيل سير العمل',
  },
} as const;

async function getWorkflowMetadataLabels() {
  const cookieStore = await cookies();
  const locale = resolveAppLocale([cookieStore.get(LOCALE_COOKIE_NAME)?.value]);
  return locale === 'ar' ? WORKFLOW_METADATA_LABELS.ar : WORKFLOW_METADATA_LABELS.en;
}

async function fetchWithAccessToken<T>(path: string): Promise<T | null> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get(COOKIES.ACCESS)?.value;
  if (!accessToken) {
    return null;
  }

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export async function getWorkflowsPageMetadata(): Promise<Metadata> {
  const labels = await getWorkflowMetadataLabels();
  return { title: labels.workflows };
}

export async function getWorkflowTasksPageMetadata(): Promise<Metadata> {
  const labels = await getWorkflowMetadataLabels();
  return { title: labels.myTasks };
}

export async function getWorkflowDefinitionsPageMetadata(): Promise<Metadata> {
  const labels = await getWorkflowMetadataLabels();
  return { title: labels.browseWorkflows };
}

export async function getTaskPageMetadata(taskId: string): Promise<Metadata> {
  const labels = await getWorkflowMetadataLabels();
  const task = await fetchWithAccessToken<Pick<HumanTask, 'name'>>(
    `/api/v1/workflows/tasks/${taskId}`,
  );

  return {
    title: task?.name ? `${task.name} | ${labels.myTasks}` : labels.taskDetail,
  };
}

export async function getWorkflowInstancePageMetadata(
  instanceId: string,
): Promise<Metadata> {
  const labels = await getWorkflowMetadataLabels();
  const instance = await fetchWithAccessToken<Pick<WorkflowInstance, 'definition_name'>>(
    `/api/v1/workflows/instances/${instanceId}`,
  );

  return {
    title: instance?.definition_name
      ? `${instance.definition_name} | ${labels.workflows}`
      : labels.workflowDetail,
  };
}
