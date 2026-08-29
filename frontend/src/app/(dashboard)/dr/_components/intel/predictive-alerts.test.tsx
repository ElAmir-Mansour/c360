import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { DRPrediction } from '@/types/clario-dr';
import { PredictiveAlerts } from './predictive-alerts';
import {
  PREDICTIVE_BREACH_IMMINENT_SECONDS,
  deriveAlert,
  deriveAlerts,
} from './predictive-alerts-derivations';

/**
 * Tests for the reusable predictive-alerts surface and its pure ranking module.
 *
 * Every fixture uses the REAL `DRPrediction` shape from `@/types/clario-dr`
 * (no invented fields). The component renders a ranked alert from a real
 * prediction, exposes the recommended-action deep link, and shows the empty
 * state when nothing is at risk. `next/link` renders a plain anchor under jsdom
 * so no router mock is required.
 */

function makePrediction(overrides: Partial<DRPrediction> = {}): DRPrediction {
  return {
    id: 'pred-1',
    tenant_id: 't1',
    stream_id: 'stream-a',
    group_label: 'Critical ERP',
    rpo_objective_seconds: 300,
    smoothed_lag_seconds: 120,
    lag_trend_slope: 0.5,
    throughput_trend_slope: -0.1,
    predicted_breach_seconds: 1800,
    breach_forecast: false,
    throughput_collapse: false,
    sample_count: 12,
    forecast_at: '2026-06-14T09:00:00Z',
    updated_at: '2026-06-14T09:05:00Z',
    ...overrides,
  };
}

afterEach(() => cleanup());

describe('predictive-alerts derivations', () => {
  it('drops steady streams (neither risk flag set)', () => {
    expect(deriveAlert(makePrediction())).toBeNull();
  });

  it('derives an RPO-breach alert that routes to protect with the stream preset', () => {
    const alert = deriveAlert(
      makePrediction({ breach_forecast: true, predicted_breach_seconds: 1800 }),
    );
    expect(alert).not.toBeNull();
    expect(alert?.kind).toBe('rpo_breach_forecast');
    expect(alert?.actionTarget).toBe('protect');
    expect(alert?.actionHref).toBe('/dr/protect?stream=stream-a');
    expect(alert?.etaSeconds).toBe(1800);
    // Far-out breach (> imminent horizon) is a warning, not critical.
    expect(alert?.severity).toBe('warning');
  });

  it('escalates an imminent breach forecast to critical', () => {
    const alert = deriveAlert(
      makePrediction({
        breach_forecast: true,
        predicted_breach_seconds: PREDICTIVE_BREACH_IMMINENT_SECONDS - 1,
      }),
    );
    expect(alert?.severity).toBe('critical');
  });

  it('derives a throughput-collapse alert that routes to recover', () => {
    const alert = deriveAlert(
      makePrediction({ throughput_collapse: true, predicted_breach_seconds: null }),
    );
    expect(alert?.kind).toBe('throughput_collapse');
    expect(alert?.actionTarget).toBe('recover');
    expect(alert?.actionHref).toBe('/dr/recover');
    expect(alert?.etaSeconds).toBeNull();
  });

  it('ranks critical alerts ahead of warnings, then by soonest ETA', () => {
    const alerts = deriveAlerts([
      // Far-out warning (3600s ETA, no imminence/collapse).
      makePrediction({ id: 'p-warn-far', stream_id: 's-far', breach_forecast: true, predicted_breach_seconds: 3600 }),
      // Critical via compounding throughput collapse, despite a longer ETA.
      makePrediction({ id: 'p-crit', stream_id: 's-crit', breach_forecast: true, throughput_collapse: true, predicted_breach_seconds: 7200 }),
      // Sooner warning (1800s ETA) — still a warning (over the imminent horizon).
      makePrediction({ id: 'p-warn-soon', stream_id: 's-soon', breach_forecast: true, predicted_breach_seconds: 1800 }),
    ]);
    // Critical first; then warnings ordered by soonest ETA.
    expect(alerts.map((a) => a.id)).toEqual(['p-crit', 'p-warn-soon', 'p-warn-far']);
  });
});

describe('PredictiveAlerts component', () => {
  it('renders a ranked alert with its recommended-action link', () => {
    renderWithQuery(
      <PredictiveAlerts
        predictions={[
          makePrediction({
            id: 'pred-9',
            stream_id: 'stream-erp-01',
            breach_forecast: true,
            predicted_breach_seconds: 600,
          }),
        ]}
      />,
    );

    expect(
      screen.getByText('Stream stream-erp-01 projected to breach RPO'),
    ).toBeInTheDocument();

    const link = screen.getByRole('link', {
      name: /Recommended action: Tune replication for stream stream-erp-01/i,
    });
    expect(link).toHaveAttribute('href', '/dr/protect?stream=stream-erp-01');
  });

  it('shows the empty state when no stream is forecast at risk', () => {
    renderWithQuery(<PredictiveAlerts predictions={[makePrediction()]} />);
    expect(screen.getByText('No streams forecast at risk.')).toBeInTheDocument();
  });

  it('renders the predictive-alert surface in Arabic under the ar locale (RTL)', () => {
    renderWithQuery(
      <PredictiveAlerts
        predictions={[
          makePrediction({
            id: 'pred-ar',
            stream_id: 'stream-erp-ar',
            breach_forecast: true,
            predicted_breach_seconds: 600,
          }),
        ]}
      />,
      { locale: 'ar' },
    );

    // The standalone card title resolves to professional MSA.
    expect(screen.getByText('التنبيهات التنبؤية')).toBeInTheDocument();
    // The breach headline is built in Arabic with the stream id interpolated.
    expect(
      screen.getByText('يُتوقَّع أن يتجاوز التدفق stream-erp-ar هدف نقطة الاسترداد (RPO)'),
    ).toBeInTheDocument();
    // The recommended-action link keeps its route + carries an Arabic accessible name.
    const link = screen.getByRole('link', {
      name: /الإجراء الموصى به: ضبط النسخ المتماثل للتدفق stream-erp-ar/,
    });
    expect(link).toHaveAttribute('href', '/dr/protect?stream=stream-erp-ar');
  });
});
