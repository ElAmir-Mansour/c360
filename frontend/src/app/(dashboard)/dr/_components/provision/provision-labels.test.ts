import { describe, expect, it } from 'vitest';

import { resolveDRBilingual } from '../../_lib/dr-i18n';
import {
  provisionLabelBundle,
  provisionLabels,
  type ProvisionLabels,
} from './provision-labels';

/**
 * Unit test for the provisioning bilingual label bundle.
 *
 * Proves the bundle honours THE BILINGUAL CONTRACT: both locales carry FULL,
 * same-shaped copies (no missing keys), Arabic is real MSA (not the English
 * fallback), real backend enum keys are present (site kind / pending stream
 * status), and resolution defaults to English so the `renderWithQuery` `en`
 * default keeps existing assertions green. Includes the required ar/RTL case.
 */

/** Recursively collect every leaf key path so the two locales can be compared. */
function leafPaths(value: unknown, prefix = ''): string[] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      leafPaths(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [prefix];
}

describe('provisionLabelBundle', () => {
  it('English and Arabic have identical key shapes (full, same-shaped copies)', () => {
    const enPaths = leafPaths(provisionLabelBundle.en).sort();
    const arPaths = leafPaths(provisionLabelBundle.ar).sort();
    expect(arPaths).toEqual(enPaths);
  });

  it('exposes the real backend site-kind enum keys on both locales', () => {
    const expectedKinds = ['vm', 'database', 'fileset', 'iac'].sort();
    expect(Object.keys(provisionLabelBundle.en.site.kindOptions).sort()).toEqual(
      expectedKinds,
    );
    expect(Object.keys(provisionLabelBundle.ar.site.kindOptions).sort()).toEqual(
      expectedKinds,
    );
  });

  it('keeps glossed acronyms and Western digits in both locales', () => {
    expect(provisionLabelBundle.en.site.rtoLabel).toContain('RTO');
    expect(provisionLabelBundle.ar.site.rtoLabel).toContain('RTO');
    expect(provisionLabelBundle.ar.site.rpoLabel).toContain('RPO');
    // Western digits preserved in the CIDR placeholder across locales.
    expect(provisionLabelBundle.ar.networkMapping.primaryCidrPlaceholder).toContain(
      '10.0.0.0/16',
    );
  });

  it('preserves the {name} interpolation token across locales', () => {
    expect(provisionLabelBundle.en.site.successAnnouncement).toContain('{name}');
    expect(provisionLabelBundle.ar.site.successAnnouncement).toContain('{name}');
    expect(provisionLabelBundle.en.networkMapping.successAnnouncement).toContain(
      '{profile}',
    );
    expect(provisionLabelBundle.ar.networkMapping.successAnnouncement).toContain(
      '{profile}',
    );
  });
});

describe('resolveDRBilingual(provisionLabelBundle, ...)', () => {
  it('defaults to English (the en surface) and exports the en bundle as provisionLabels', () => {
    const resolved: ProvisionLabels = resolveDRBilingual(provisionLabelBundle, 'en');
    expect(resolved.site.dialogTitle).toBe('Add a protected site');
    expect(resolved.group.triggerLabel).toBe('Create protection group');
    expect(provisionLabels).toBe(provisionLabelBundle.en);
  });

  it('resolves the full MSA Arabic surface for locale "ar" (RTL)', () => {
    const ar: ProvisionLabels = resolveDRBilingual(provisionLabelBundle, 'ar');
    // Real MSA copy, not the English fallback.
    expect(ar.site.dialogTitle).toBe('إضافة موقع محمي');
    expect(ar.group.triggerLabel).toBe('إنشاء مجموعة حماية');
    expect(ar.stream.statusPendingOption).toBe('معلّق');
    expect(ar.site.kindOptions.database).toBe('قاعدة بيانات');
    // Arabic surface must not leak the English strings.
    expect(ar.site.dialogTitle).not.toBe(provisionLabelBundle.en.site.dialogTitle);
    expect(ar.actions.submit).not.toBe(provisionLabelBundle.en.actions.submit);
    // Contains Arabic-script characters (RTL content present).
    expect(ar.member.dialogTitle).toMatch(/[؀-ۿ]/);
  });
});
