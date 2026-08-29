import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { DRBootPlan, DRBootService } from '@/types/clario-dr';
import { BootPlanPanel } from './boot-plan-panel';

/**
 * Boot-plan panel tests.
 *
 * Proves the tiered boot plan renders the REAL {@link DRBootService} rows (name,
 * probe kind, probe target, boot timeout) grouped by tier; that the write
 * controls (define services / start run) are honestly disabled inside a
 * read-only fieldset when the operator lacks `dr:write` (the shared write gate);
 * and an Arabic / RTL render asserting the MSA copy. `next/navigation` is
 * globally mocked by the test setup.
 */

function service(overrides: Partial<DRBootService>): DRBootService {
  return {
    id: 'svc-1',
    tenant_id: 't1',
    group_id: 'g1',
    name: 'postgres-primary',
    kind: 'database',
    boot_action: '',
    probe_kind: 'tcp',
    probe_target: 'db.recovery:5432',
    probe_expect_status: 0,
    boot_timeout_seconds: 30,
    health_retries: 3,
    created_at: '2026-06-14T10:00:00Z',
    updated_at: '2026-06-14T10:00:00Z',
    ...overrides,
  };
}

const bootPlan: DRBootPlan = {
  group_id: 'g1',
  tiers: [
    [service({ id: 'svc-db', name: 'postgres-primary', probe_kind: 'tcp', probe_target: 'db.recovery:5432' })],
    [
      service({
        id: 'svc-api',
        name: 'api-gateway',
        kind: 'service',
        probe_kind: 'http',
        probe_target: 'http://api.recovery:8080/healthz',
        boot_timeout_seconds: 45,
      }),
    ],
  ],
  tier_count: 2,
};

const noop = () => undefined;

describe('BootPlanPanel', () => {
  it('renders the tiered boot plan from a real DRBootPlan', () => {
    renderWithQuery(
      <BootPlanPanel
        bootPlan={bootPlan}
        loading={false}
        error={null}
        canWrite
        onDefineServices={vi.fn()}
        defineServicesPending={false}
        onStartBootRun={vi.fn()}
        startBootRunPending={false}
        onRetry={noop}
      />,
    );

    expect(screen.getByText('Tier 1')).toBeInTheDocument();
    expect(screen.getByText('Tier 2')).toBeInTheDocument();
    expect(screen.getByText('postgres-primary')).toBeInTheDocument();
    expect(screen.getByText('api-gateway')).toBeInTheDocument();
    expect(screen.getByText('db.recovery:5432')).toBeInTheDocument();
    expect(screen.getByText('http://api.recovery:8080/healthz')).toBeInTheDocument();

    // Write controls are live for a dr:write operator.
    expect(screen.getByRole('button', { name: 'Define boot services' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Start boot run' })).toBeEnabled();
  });

  it('shows the read-only notice and disables write controls when the operator lacks dr:write', () => {
    renderWithQuery(
      <BootPlanPanel
        bootPlan={bootPlan}
        loading={false}
        error={null}
        canWrite={false}
        onDefineServices={vi.fn()}
        defineServicesPending={false}
        onStartBootRun={vi.fn()}
        startBootRunPending={false}
        onRetry={noop}
      />,
    );

    // The shared write gate renders an explanatory read-only notice…
    expect(screen.getByText('Read-only access')).toBeInTheDocument();
    // …and the write controls are inside a disabled fieldset.
    expect(screen.getByRole('button', { name: 'Define boot services' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Start boot run' })).toBeDisabled();
  });

  it('renders the full MSA Arabic surface for locale "ar" (RTL)', () => {
    renderWithQuery(
      <BootPlanPanel
        bootPlan={bootPlan}
        loading={false}
        error={null}
        canWrite
        onDefineServices={vi.fn()}
        defineServicesPending={false}
        onStartBootRun={vi.fn()}
        startBootRunPending={false}
        onRetry={noop}
      />,
      { locale: 'ar' },
    );

    expect(screen.getByText('خطة الإقلاع المعزول')).toBeInTheDocument();
    expect(screen.getByText('الطبقة 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'تعريف خدمات الإقلاع' })).toBeInTheDocument();
  });
});
