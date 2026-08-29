import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';

import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { ContractsManagerReports } from './contracts-manager-reports';

const { contractReportMock, consultationReportMock } = vi.hoisted(() => ({
  contractReportMock: vi.fn(),
  consultationReportMock: vi.fn(),
}));

vi.mock('@/lib/lex/reports', async () => {
  const actual = await vi.importActual<typeof import('@/lib/lex/reports')>('@/lib/lex/reports');
  return {
    ...actual,
    lexReportsApi: {
      ...actual.lexReportsApi,
      getContractAnalytics: contractReportMock,
      getConsultationReport: consultationReportMock,
    },
  };
});

beforeEach(() => {
  contractReportMock.mockReset();
  consultationReportMock.mockReset();
  contractReportMock.mockResolvedValue({
    generated_at: '2026-07-31T12:00:00Z',
    filters: {},
    total: 12,
    avg_review_duration_hours: 18.5,
    review_sample_size: 8,
    by_department: [{ key: 'Procurement', count: 5 }],
    by_type: [{ key: 'vendor', count: 7 }],
    by_status: [{ key: 'active', count: 9 }],
    total_value: 500000,
    total_value_by_currency: { SAR: 500000 },
    spend_by_type: [{ key: 'vendor', count: 7, total_value: 400000, by_currency: { SAR: 400000 } }],
    spend_by_department: [{ key: 'Procurement', count: 5, total_value: 300000, by_currency: { SAR: 300000 } }],
    expiry_cliff: [{ month: '2026-08', count: 2, value: 100000 }],
    cycle_time: { avg_days: 5, p50_days: 4, p90_days: 9, sample_size: 8, source: 'status_timeline' },
  });
  consultationReportMock.mockResolvedValue({
    generated_at: '2026-07-31T12:00:00Z',
    filters: {},
    total: 6,
    by_department: [{ key: 'Finance', count: 2 }],
    by_type: [{ key: 'general', count: 5 }],
    by_status: [{ key: 'approved', count: 4 }],
    avg_completion_time_hours: 12,
    completion_sample_size: 4,
  });
});

describe('ContractsManagerReports', () => {
  it('shows period controls, every contract value rollup, PDF, and detailed builder access', async () => {
    const printMock = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    renderWithQuery(<ContractsManagerReports />);

    expect(await screen.findByText('Total contracts')).toBeInTheDocument();
    expect(screen.getByText('Spend by contract type')).toBeInTheDocument();
    expect(screen.getByText('Spend by department')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(printMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '30 days' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /report builder/i }).length).toBeGreaterThan(0);
    expect(contractReportMock).toHaveBeenCalledWith(expect.objectContaining({ from: expect.any(String), to: expect.any(String) }));
  });
});
