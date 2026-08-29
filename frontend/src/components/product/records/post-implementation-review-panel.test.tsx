import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { PostImplementationReviewPanel } from './post-implementation-review-panel';
import {
  sampleActions,
  sampleAttestation,
  sampleFailoverRun,
  sampleGates,
  sampleIssues,
  sampleSteps,
} from './records.gallery';

describe('PostImplementationReviewPanel', () => {
  function renderPanel(overrides = {}) {
    return renderWithQuery(
      <PostImplementationReviewPanel
        run={sampleFailoverRun}
        attestation={sampleAttestation}
        steps={sampleSteps}
        gates={sampleGates}
        issues={sampleIssues}
        actionItems={sampleActions}
        rpoObjectiveSeconds={60}
        {...overrides}
      />,
    );
  }

  it('renders RTO objective and achieved (RTA) metrics', () => {
    renderPanel();

    // RTO objective 900s -> "15m 00s"; RTA achieved 818s -> "13m 38s".
    expect(screen.getByText('RTO objective')).toBeInTheDocument();
    expect(screen.getByText('15m 00s')).toBeInTheDocument();
    expect(screen.getByText('RTA achieved')).toBeInTheDocument();
    expect(screen.getByText('13m 38s')).toBeInTheDocument();
  });

  it('shows RPO achieved and validation ratio from the attestation', () => {
    renderPanel();
    // RPO achieved 22s.
    expect(screen.getByText('RPO achieved')).toBeInTheDocument();
    expect(screen.getByText('22s')).toBeInTheDocument();
    // validation_ratio 1 -> 100%.
    expect(screen.getByText('Validation ratio')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('renders an RTO-met verdict when achieved <= objective', () => {
    renderPanel();
    expect(screen.getByText('RTO met')).toBeInTheDocument();
    expect(screen.queryByText('RTO missed')).not.toBeInTheDocument();
  });

  it('renders an RTO-missed verdict when achieved exceeds objective', () => {
    renderPanel({
      run: { ...sampleFailoverRun, rto_actual_seconds: 1500 },
      attestation: { ...sampleAttestation, rto_actual_seconds: 1500 },
    });
    expect(screen.getByText('RTO missed')).toBeInTheDocument();
    expect(screen.queryByText('RTO met')).not.toBeInTheDocument();
  });

  it('renders the four recovery gate outcomes', () => {
    renderPanel();
    const gateRegion = screen.getByRole('region', { name: 'Gate outcomes' });
    expect(gateRegion).toBeInTheDocument();
    // Gate labels.
    ['Validate', 'Approve', 'Execute', 'Attest'].forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
    // All four passed.
    expect(screen.getAllByText('Passed')).toHaveLength(4);
  });

  it('lists execution steps with their pass/fail status', () => {
    renderPanel();
    expect(screen.getByText('gate1.validate')).toBeInTheDocument();
    expect(screen.getByText('gate4.attest')).toBeInTheDocument();
    // 6 sample steps all 'passed'.
    expect(screen.getAllByText('passed')).toHaveLength(sampleSteps.length);
  });

  it('renders issues and tracked action items', () => {
    renderPanel();
    expect(
      screen.getByText('DNS propagation lagged service health by ~90s'),
    ).toBeInTheDocument();
    expect(screen.getByText('Lower TTL on customer-facing zones to 60s')).toBeInTheDocument();
    // Action statuses surface their labels.
    expect(screen.getByText('In progress')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('shows empty states for steps, issues, and actions when omitted', () => {
    renderWithQuery(
      <PostImplementationReviewPanel run={sampleFailoverRun} gates={sampleGates} />,
    );
    expect(screen.getByText('No step records')).toBeInTheDocument();
    expect(screen.getByText('No issues recorded')).toBeInTheDocument();
    expect(screen.getByText('No action items')).toBeInTheDocument();
  });

  it('resolves bilingual labels under the Arabic (RTL) locale', () => {
    renderPanel({
      labels: { rtoObjectiveLabel: 'هدف زمن الاسترداد', rtoMet: 'تحقق الهدف' },
    });
    expect(screen.getByText('هدف زمن الاسترداد')).toBeInTheDocument();
    expect(screen.getByText('تحقق الهدف')).toBeInTheDocument();
  });
});
