import { describe, expect, it } from 'vitest';

import { resolveDRBilingual } from '../../_lib/dr-i18n';
import {
  topologyLabelBundle,
  topologyLabels,
  type TopologyLabels,
} from './topology-labels';

/**
 * Unit test for the recovery-topology bilingual label bundle.
 *
 * Proves THE BILINGUAL CONTRACT: both locales carry FULL, same-shaped copies (no
 * missing keys), Arabic is real MSA, the embedded `nodeMap` carries the
 * function-valued `textAlternativeSummary(nodeCount, edgeCount)` on both locales
 * with Western digits preserved, interpolation tokens survive, and resolution
 * defaults to English. Includes the required ar/RTL case.
 */

function leafPaths(value: unknown, prefix = ''): string[] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      leafPaths(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [prefix];
}

describe('topologyLabelBundle', () => {
  it('English and Arabic have identical key shapes (full, same-shaped copies)', () => {
    expect(leafPaths(topologyLabelBundle.ar).sort()).toEqual(
      leafPaths(topologyLabelBundle.en).sort(),
    );
  });

  it('keeps the embedded NodeMap textAlternativeSummary with Western digits in both locales', () => {
    expect(topologyLabelBundle.en.nodeMap.textAlternativeSummary(3, 2)).toContain('3');
    expect(topologyLabelBundle.en.nodeMap.textAlternativeSummary(3, 2)).toContain('2');
    expect(topologyLabelBundle.ar.nodeMap.textAlternativeSummary(3, 2)).toContain('3');
    expect(topologyLabelBundle.ar.nodeMap.textAlternativeSummary(3, 2)).toContain('2');
  });

  it('preserves the {from}/{to} interpolation tokens across both locales', () => {
    expect(topologyLabelBundle.en.edgeAddedAnnouncement('site-a', 'site-b')).toContain(
      'site-a',
    );
    expect(topologyLabelBundle.ar.edgeAddedAnnouncement('site-a', 'site-b')).toContain(
      'site-b',
    );
  });

  it('defaults to English and exports the en surface as topologyLabels', () => {
    const resolved: TopologyLabels = resolveDRBilingual(topologyLabelBundle, 'en');
    expect(resolved.title).toBe('Recovery topology');
    expect(topologyLabels).toBe(topologyLabelBundle.en);
  });

  it('resolves the full MSA Arabic surface for locale "ar" (RTL)', () => {
    const ar: TopologyLabels = resolveDRBilingual(topologyLabelBundle, 'ar');
    expect(ar.title).toBe('طوبولوجيا الاسترداد');
    expect(ar.roles.primary).toBe('أساسي');
    expect(ar.addEdgeTriggerLabel).not.toBe(topologyLabelBundle.en.addEdgeTriggerLabel);
    expect(ar.nodeMap.figureAriaLabel).toMatch(/[؀-ۿ]/);
  });
});
