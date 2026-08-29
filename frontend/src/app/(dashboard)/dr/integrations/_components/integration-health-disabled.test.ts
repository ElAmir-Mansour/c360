import { describe, expect, it } from 'vitest';
import type { ApiError } from '@/types/api';
import {
  integrationHealthLabelBundle,
  isIntegrationsFeatureDisabled,
} from './integration-health';

describe('isIntegrationsFeatureDisabled', () => {
  const apiError = (status: number): ApiError => ({
    status,
    code: `HTTP_${status}`,
    message: `Request failed with status ${status}`,
  });

  it('treats a 404 ApiError as the feature-disabled signal', () => {
    // DR_INTEGRATIONS_ENC_KEY unset => router not mounted => chi 404.
    expect(isIntegrationsFeatureDisabled(apiError(404))).toBe(true);
  });

  it('does NOT treat genuine failures (0/408/5xx) as feature-disabled', () => {
    expect(isIntegrationsFeatureDisabled(apiError(0))).toBe(false); // network
    expect(isIntegrationsFeatureDisabled(apiError(408))).toBe(false); // timeout
    expect(isIntegrationsFeatureDisabled(apiError(500))).toBe(false);
    expect(isIntegrationsFeatureDisabled(apiError(503))).toBe(false);
  });

  it('does not throw and returns false for non-ApiError values', () => {
    expect(isIntegrationsFeatureDisabled(null)).toBe(false);
    expect(isIntegrationsFeatureDisabled(undefined)).toBe(false);
    expect(isIntegrationsFeatureDisabled(new Error('boom'))).toBe(false);
    expect(isIntegrationsFeatureDisabled('not found')).toBe(false);
    expect(isIntegrationsFeatureDisabled({ status: 404 })).toBe(false); // missing code/message
  });
});

describe('integrationHealthLabelBundle feature-disabled copy', () => {
  it('exposes the disabled-state keys in BOTH locales', () => {
    for (const locale of ['en', 'ar'] as const) {
      const copy = integrationHealthLabelBundle[locale];
      expect(copy.featureDisabledTitle.length).toBeGreaterThan(0);
      expect(copy.featureDisabledDescription.length).toBeGreaterThan(0);
      // Both locales name the exact env var to set (literal identifier kept).
      expect(copy.featureDisabledEnvHint).toContain('DR_INTEGRATIONS_ENC_KEY');
    }
  });

  it('uses distinct (translated) titles per locale', () => {
    expect(integrationHealthLabelBundle.en.featureDisabledTitle).not.toBe(
      integrationHealthLabelBundle.ar.featureDisabledTitle,
    );
  });
});
