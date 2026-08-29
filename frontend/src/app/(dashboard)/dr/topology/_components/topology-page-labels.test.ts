import { describe, expect, it } from 'vitest';

import { resolveDRBilingual } from '../../_lib/dr-i18n';
import {
  topologyPageLabelBundle,
  topologyPageLabels,
  type TopologyPageLabels,
} from './topology-page-labels';

/**
 * Unit test for the topology + isolated-boot authoring bilingual label bundle.
 *
 * Proves THE BILINGUAL CONTRACT: both locales carry FULL, same-shaped copies (no
 * missing keys), the option records are keyed by the REAL backend enum tokens
 * (`internal/dr/topology` roles/modes, `internal/dr/bootgraph` probe kinds /
 * policies / run + service statuses), the function-valued announcements preserve
 * their interpolation params and Western digits, Arabic is real MSA, and
 * resolution defaults to English. Includes the required ar/RTL case.
 */

function leafPaths(value: unknown, prefix = ''): string[] {
  if (typeof value === 'function') return [prefix];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      leafPaths(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [prefix];
}

describe('topologyPageLabelBundle', () => {
  it('English and Arabic have identical key shapes (full, same-shaped copies)', () => {
    expect(leafPaths(topologyPageLabelBundle.ar).sort()).toEqual(
      leafPaths(topologyPageLabelBundle.en).sort(),
    );
  });

  it('keys the option records by the real backend enum tokens in both locales', () => {
    for (const locale of [topologyPageLabelBundle.en, topologyPageLabelBundle.ar]) {
      expect(Object.keys(locale.roleOptions).sort()).toEqual(['relay', 'source', 'target']);
      expect(Object.keys(locale.modeOptions).sort()).toEqual(['async', 'sync']);
      expect(Object.keys(locale.probeKindOptions).sort()).toEqual(['http', 'script', 'tcp']);
      expect(Object.keys(locale.bootPolicyOptions).sort()).toEqual(['halt', 'rollback']);
      expect(Object.keys(locale.bootRunStatusOptions).sort()).toEqual([
        'completed',
        'failed',
        'pending',
        'rolled_back',
        'running',
      ]);
      expect(Object.keys(locale.bootServiceStatusOptions).sort()).toEqual([
        'booting',
        'healthy',
        'pending',
        'rolled_back',
        'unhealthy',
      ]);
    }
  });

  it('preserves announcement interpolation and Western digits across both locales', () => {
    expect(topologyPageLabelBundle.en.bootRunStartedAnnouncement('run-7')).toContain('run-7');
    expect(topologyPageLabelBundle.ar.bootRunStartedAnnouncement('run-7')).toContain('run-7');
    expect(topologyPageLabelBundle.en.bootServicesDefinedAnnouncement(3)).toContain('3');
    expect(topologyPageLabelBundle.ar.bootServicesDefinedAnnouncement(3)).toContain('3');
    expect(topologyPageLabelBundle.en.bootRunTiersValue(2, 4)).toContain('2');
    expect(topologyPageLabelBundle.ar.bootRunTiersValue(2, 4)).toContain('4');
  });

  it('defaults to English and exports the en surface as topologyPageLabels', () => {
    const resolved: TopologyPageLabels = resolveDRBilingual(topologyPageLabelBundle, 'en');
    expect(resolved.pageTitle).toBe('Recovery topology & boot');
    expect(topologyPageLabels).toBe(topologyPageLabelBundle.en);
  });

  it('resolves the full MSA Arabic surface for locale "ar" (RTL)', () => {
    const ar: TopologyPageLabels = resolveDRBilingual(topologyPageLabelBundle, 'ar');
    expect(ar.pageTitle).toBe('طوبولوجيا الاسترداد والإقلاع');
    expect(ar.roleOptions.source).toBe('مصدر');
    expect(ar.probeKindOptions.tcp).toBe('اتصال TCP');
    expect(ar.bootSectionTitle).not.toBe(topologyPageLabelBundle.en.bootSectionTitle);
    expect(ar.defineServicesTitle).toMatch(/[؀-ۿ]/);
  });
});
