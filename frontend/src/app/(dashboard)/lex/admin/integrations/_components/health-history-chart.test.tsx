import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { HealthHistoryChart } from './health-history-chart';
import type { HealthCheckRecord } from '@/lib/lex/integrations';
import { detailOpsLabels } from '../_lib/detail-ops-labels';

const { getHealthHistoryResultMock } = vi.hoisted(() => ({
  getHealthHistoryResultMock: vi.fn(),
}));

// recharts ResponsiveContainer needs a sized parent; jsdom reports 0×0. Stub it
// to a fixed box so the chart renders deterministically (the component sets an
// explicit height on the wrapper, this just unblocks the container measurement).
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 400, height: 44 }}>{children}</div>
    ),
  };
});

vi.mock('@/lib/lex/integrations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/lex/integrations')>(
    '@/lib/lex/integrations',
  );
  return {
    ...actual,
    getHealthHistoryResult: getHealthHistoryResultMock,
  };
});

const en = detailOpsLabels.en;

function record(over: Partial<HealthCheckRecord> = {}): HealthCheckRecord {
  return {
    grade: 'healthy',
    reachable: true,
    detail: 'ok',
    checked_at: '2026-06-20T10:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  getHealthHistoryResultMock.mockReset();
});

describe('HealthHistoryChart', () => {
  it('renders an empty state when there is no probe history', async () => {
    getHealthHistoryResultMock.mockResolvedValue({ records: [], degraded: false });
    renderWithQuery(<HealthHistoryChart endpointId="ep-1" />);

    expect(await screen.findByText(en.healthHistoryEmpty)).toBeInTheDocument();
  });

  it('renders an unavailable state when the probe history read is degraded', async () => {
    getHealthHistoryResultMock.mockResolvedValue({ records: [], degraded: true });
    renderWithQuery(<HealthHistoryChart endpointId="ep-1" />);

    expect(await screen.findByText(en.opsError)).toBeInTheDocument();
    expect(screen.queryByText(en.healthHistoryEmpty)).not.toBeInTheDocument();
  });

  it('renders gracefully with a single probe point (no recharts 0-size crash)', async () => {
    getHealthHistoryResultMock.mockResolvedValue({ records: [record()], degraded: false });
    const { container } = renderWithQuery(<HealthHistoryChart endpointId="ep-1" />);

    // 100% uptime for the single reachable probe.
    expect(await screen.findByText('100% reachable')).toBeInTheDocument();
    // Exactly one grade dot rendered.
    expect(container.querySelectorAll('.rounded-full').length).toBe(1);
  });

  it('computes an uptime summary across multiple probes', async () => {
    getHealthHistoryResultMock.mockResolvedValue({
      records: [
        record({ checked_at: '2026-06-20T13:00:00Z', grade: 'down', reachable: false }),
        record({ checked_at: '2026-06-20T12:00:00Z' }),
        record({ checked_at: '2026-06-20T11:00:00Z' }),
        record({ checked_at: '2026-06-20T10:00:00Z' }),
      ],
      degraded: false,
    });
    const { container } = renderWithQuery(<HealthHistoryChart endpointId="ep-1" />);

    // 3 of 4 reachable → 75%.
    expect(await screen.findByText('75% reachable')).toBeInTheDocument();
    expect(container.querySelectorAll('.rounded-full').length).toBe(4);
  });

  it('renders the Arabic/RTL surface under the ar locale', async () => {
    getHealthHistoryResultMock.mockResolvedValue({ records: [record()], degraded: false });
    const { container } = renderWithQuery(<HealthHistoryChart endpointId="ep-1" />, {
      locale: 'ar',
    });

    expect(await screen.findByText(detailOpsLabels.ar.healthHistoryLatest, { exact: false }))
      .toBeInTheDocument();
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });
});
