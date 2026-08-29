import { render, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stub the data-suite API so no real network happens and we can count calls.
const scanContradictions = vi.fn();
const getContradictionScan = vi.fn();
vi.mock('@/lib/data-suite', () => ({
  dataSuiteApi: {
    scanContradictions: (...args: unknown[]) => scanContradictions(...args),
    getContradictionScan: (...args: unknown[]) => getContradictionScan(...args),
  },
}));

import { ContradictionScanDialog } from './contradiction-scan-dialog';

const RUNNING = {
  id: 'scan-1',
  status: 'running',
  models_scanned: 1,
  model_pairs_compared: 1,
  contradictions_found: 0,
  triggered_by: 'test',
};

describe('ContradictionScanDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    scanContradictions.mockReset().mockResolvedValue({ ...RUNNING });
    getContradictionScan.mockReset().mockResolvedValue({ ...RUNNING });
  });
  afterEach(() => vi.useRealTimers());

  it('starts the backend scan exactly once across parent re-renders', async () => {
    // The parent passes a fresh inline onComplete every render. The old effect
    // listed onComplete in its deps, so each re-render tore down and re-ran the
    // effect — kicking off a brand-new backend scan (a self-feeding loop).
    const { rerender } = render(
      <ContradictionScanDialog open onOpenChange={() => {}} onComplete={() => {}} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    rerender(<ContradictionScanDialog open onOpenChange={() => {}} onComplete={() => {}} />);
    rerender(<ContradictionScanDialog open onOpenChange={() => {}} onComplete={() => {}} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(scanContradictions).toHaveBeenCalledTimes(1);
  }, 10000);

  it('surfaces a retry affordance when the scan fails to start', async () => {
    scanContradictions.mockReset().mockRejectedValue(new Error('boom'));
    // Synchronous query only — findBy*/waitFor deadlock under fake timers.
    const { queryByRole } = render(
      <ContradictionScanDialog open onOpenChange={() => {}} onComplete={() => {}} />,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // A retry button renders instead of an eternal "Starting scan" spinner.
    expect(queryByRole('button', { name: /retry|إعادة/i })).not.toBeNull();
  }, 10000);
});
