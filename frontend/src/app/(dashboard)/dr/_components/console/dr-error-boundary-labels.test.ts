import { describe, expect, it } from 'vitest';
import {
  drErrorBoundaryLabelBundle,
  type DRErrorBoundaryLabels,
} from './dr-error-boundary-labels';

/**
 * Shape parity: every key present in `en` must be present in `ar` (and vice
 * versa), with matching value kinds — the bilingual contract for every
 * feature-local bundle in the DR console.
 */
function shapeOf(labels: DRErrorBoundaryLabels): Record<string, string> {
  return Object.fromEntries(
    Object.entries(labels).map(([key, value]) => [key, typeof value]),
  );
}

describe('drErrorBoundaryLabelBundle', () => {
  it('has identical key shapes across en and ar', () => {
    expect(shapeOf(drErrorBoundaryLabelBundle.ar)).toEqual(
      shapeOf(drErrorBoundaryLabelBundle.en),
    );
  });

  it('translates the static copy (en !== ar)', () => {
    expect(drErrorBoundaryLabelBundle.ar.title).not.toBe(
      drErrorBoundaryLabelBundle.en.title,
    );
    expect(drErrorBoundaryLabelBundle.ar.description).not.toBe(
      drErrorBoundaryLabelBundle.en.description,
    );
    expect(drErrorBoundaryLabelBundle.ar.retryAction).not.toBe(
      drErrorBoundaryLabelBundle.en.retryAction,
    );
    expect(drErrorBoundaryLabelBundle.ar.backAction).not.toBe(
      drErrorBoundaryLabelBundle.en.backAction,
    );
  });

  it('interpolates the digest in both locales', () => {
    expect(drErrorBoundaryLabelBundle.en.referenceLabel('xyz')).toContain('xyz');
    expect(drErrorBoundaryLabelBundle.ar.referenceLabel('xyz')).toContain('xyz');
  });
});
