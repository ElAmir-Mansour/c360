import { screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { CloudDROverview, RegionFailoverPlan } from '@/types/recover-cloud-dr';
import { CloudDRDashboard } from './cloud-dr-dashboard';

// Mock the data hooks so the dashboard's loading/error/data branches are tested
// deterministically without MSW or an auth context (mocks live only in tests).
const mockUseCloudDROverview = vi.fn();
const mockUseCloudDRRegionBootPlan = vi.fn();

vi.mock('@/lib/recover/use-cloud-dr-overview', () => ({
  useCloudDROverview: () => mockUseCloudDROverview(),
  useCloudDRRegionBootPlan: () => mockUseCloudDRRegionBootPlan(),
}));

function overview(partial: Partial<CloudDROverview> = {}): CloudDROverview {
  return {
    workloads: {
      vm_sources: 2,
      vm_sources_list: [
        { id: 'v1', name: 'web-vm', source_kind: 'vm_disk', enabled: true, epoch_count: 5 },
        { id: 'v2', name: 'db-vm', source_kind: 'vm_disk', enabled: false, epoch_count: 0 },
      ],
      iac_snapshots: 1,
      iac_snapshots_list: [
        { id: 'i1', name: 'tf-prod', source_kind: 'terraform', version: 3, resource_count: 12, created_at: '2026-06-01T00:00:00Z' },
      ],
    },
    last_failover_test: {
      id: 'f1',
      group_id: 'g1',
      mode: 'drill',
      status: 'COMPLETED',
      rto_objective_seconds: 600,
      rto_actual_seconds: 420,
      initiated_at: '2026-06-20T10:00:00Z',
      completed_at: '2026-06-20T10:07:00Z',
    },
    boot_graph: {
      total_scopes: 1,
      scopes_with_plan: 1,
      total_services: 2,
      scopes: [
        { group_id: 'g1', group_name: 'eu-west-1', site_names: ['frankfurt-az1'], tier_count: 2, service_count: 2, has_plan: true },
      ],
    },
    ...partial,
  };
}

function plan(): RegionFailoverPlan {
  return {
    group_id: 'g1',
    group_name: 'eu-west-1',
    site_names: ['frankfurt-az1'],
    tier_count: 2,
    service_count: 2,
    tiers: [
      [{ id: 's1', name: 'database', kind: 'database' }],
      [{ id: 's2', name: 'api', kind: 'api' }],
    ],
  };
}

beforeEach(() => {
  mockUseCloudDROverview.mockReset();
  mockUseCloudDRRegionBootPlan.mockReset();
  mockUseCloudDRRegionBootPlan.mockReturnValue({
    data: plan(),
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  });
});

describe('CloudDRDashboard', () => {
  it('renders the loading skeleton while fetching', () => {
    mockUseCloudDROverview.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    const { container } = renderWithQuery(<CloudDRDashboard />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('renders an error state with a retry on failure', () => {
    const refetch = vi.fn();
    mockUseCloudDROverview.mockReturnValue({
      isLoading: false,
      isError: true,
      error: new Error('boom'),
      data: undefined,
      refetch,
    });
    renderWithQuery(<CloudDRDashboard />);
    expect(screen.getByText(/Unable to load the Cloud DR overview/i)).toBeInTheDocument();
    expect(screen.getByText('boom')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('renders real workloads, RTO-vs-RTA and the boot-graph status from the overview', () => {
    mockUseCloudDROverview.mockReturnValue({
      isLoading: false,
      isError: false,
      data: overview(),
      refetch: vi.fn(),
    });
    renderWithQuery(<CloudDRDashboard />);

    // Workload counts surfaced ("VM captures" appears as both a KPI and a
    // section header — assert at least one).
    expect(screen.getAllByText('VM captures').length).toBeGreaterThan(0);
    expect(screen.getByText('web-vm')).toBeInTheDocument();
    expect(screen.getByText('tf-prod')).toBeInTheDocument();

    // RTO-vs-RTA: actual (7m) within objective (10m).
    expect(screen.getByText('Last failover test')).toBeInTheDocument();
    expect(screen.getByText('7m')).toBeInTheDocument();
    expect(screen.getByText('10m')).toBeInTheDocument();
    expect(screen.getByText(/within objective/i)).toBeInTheDocument();

    // Region/AZ failover view lists the scope and visualises the real boot order.
    expect(screen.getByText('eu-west-1')).toBeInTheDocument();
    expect(screen.getByText('database')).toBeInTheDocument();
    expect(screen.getByText('api')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: /VM Capture/i })).toHaveAttribute('href', '/dr/protect');
    expect(screen.getByRole('link', { name: /Infrastructure-as-Code DR/i })).toHaveAttribute(
      'href',
      '/dr/protect',
    );
    expect(screen.getByRole('link', { name: /Failover \/ Failback/i })).toHaveAttribute(
      'href',
      '/recover/it-dr/recover',
    );
  });

  it('shows an empty failover-test state when no test has run', () => {
    mockUseCloudDROverview.mockReturnValue({
      isLoading: false,
      isError: false,
      data: overview({ last_failover_test: null }),
      refetch: vi.fn(),
    });
    renderWithQuery(<CloudDRDashboard />);
    expect(screen.getByText(/No failover or drill has run yet/i)).toBeInTheDocument();
  });
});
