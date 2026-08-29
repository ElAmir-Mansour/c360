import api from '@/lib/api';
import type { TenantSettings } from '@/types/tenant';
import { sanitizeUserBoard, type PersistedUserBoard } from './layout-utils';

interface DashboardPreferenceResponse {
  preferences: unknown;
  updated_at?: string;
}

export interface LoadedDashboardPreference {
  board: PersistedUserBoard | null;
  updatedAt?: string;
}

export async function loadDashboardPreference(): Promise<LoadedDashboardPreference> {
  const { data } = await api.get<DashboardPreferenceResponse>(
    '/api/v1/users/me/dashboard-preferences',
  );
  return {
    board:
      data.preferences &&
      typeof data.preferences === 'object' &&
      Object.keys(data.preferences).length > 0
        ? sanitizeUserBoard(data.preferences)
        : null,
    updatedAt: data.updated_at,
  };
}

export async function saveDashboardPreference(
  board: PersistedUserBoard,
): Promise<LoadedDashboardPreference> {
  const { data } = await api.put<DashboardPreferenceResponse>(
    '/api/v1/users/me/dashboard-preferences',
    { preferences: board },
  );
  return {
    board: sanitizeUserBoard(data.preferences),
    updatedAt: data.updated_at,
  };
}

export async function resetDashboardPreference(): Promise<void> {
  await api.delete('/api/v1/users/me/dashboard-preferences');
}

export async function saveTenantDashboardDefault(
  tenantId: string,
  settings: TenantSettings,
  board: PersistedUserBoard,
): Promise<void> {
  await api.put(`/api/v1/tenants/${tenantId}`, {
    settings: { ...settings, dashboard_defaults: board },
  });
}
