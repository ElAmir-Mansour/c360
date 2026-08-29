import { describe, expect, it } from 'vitest';

import { resolveDRBilingual } from '../../_lib/dr-i18n';
import {
  isRunbookRunTerminal,
  runbookPageLabelBundle,
  runbookPageLabels,
  type RunbookPageLabels,
} from './runbook-page-labels';

/**
 * Unit test for the Runbook Studio page-labels bilingual bundle.
 *
 * Proves THE BILINGUAL CONTRACT: both locales carry FULL, same-shaped copies (no
 * missing keys), the run-status / run-mode / runbook-status display records are
 * keyed by the REAL backend tokens on BOTH locales, the function-valued
 * announcements preserve their interpolation tokens, resolution defaults to
 * English, and the Arabic surface is real MSA with no English leakage (the
 * required ar/RTL case). Also covers the `isRunbookRunTerminal` helper against the
 * real backend run-status enum.
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

describe('runbookPageLabelBundle', () => {
  it('English and Arabic have identical key shapes (full, same-shaped copies)', () => {
    expect(leafPaths(runbookPageLabelBundle.ar).sort()).toEqual(
      leafPaths(runbookPageLabelBundle.en).sort(),
    );
  });

  it('keys run-status / run-mode / runbook-status by the real backend tokens on both locales', () => {
    const runStatuses = ['pending', 'running', 'completed', 'failed', 'aborted'].sort();
    const runModes = ['live', 'rehearsal'].sort();
    const runbookStatuses = ['draft', 'published', 'archived'].sort();

    for (const locale of ['en', 'ar'] as const) {
      const b = runbookPageLabelBundle[locale];
      expect(Object.keys(b.runStatusLabels).sort()).toEqual(runStatuses);
      expect(Object.keys(b.runModeLabels).sort()).toEqual(runModes);
      expect(Object.keys(b.runbookStatusLabels).sort()).toEqual(runbookStatuses);
    }
  });

  it('preserves interpolation tokens in announcements across both locales', () => {
    expect(runbookPageLabelBundle.en.selectedAnnouncement('Tier-1')).toContain('Tier-1');
    expect(runbookPageLabelBundle.ar.selectedAnnouncement('Tier-1')).toContain('Tier-1');
    expect(runbookPageLabelBundle.en.runOpenedAnnouncement('run-9')).toContain('run-9');
    expect(runbookPageLabelBundle.ar.runOpenedAnnouncement('run-9')).toContain('run-9');
  });

  it('defaults to English and exports the en surface as runbookPageLabels', () => {
    const resolved: RunbookPageLabels = resolveDRBilingual(runbookPageLabelBundle, 'en');
    expect(resolved.listTitle).toBe('Recovery runbooks');
    expect(runbookPageLabels).toBe(runbookPageLabelBundle.en);
  });

  it('resolves Arabic to real MSA with no English leakage (ar/RTL)', () => {
    const ar = resolveDRBilingual(runbookPageLabelBundle, 'ar');
    expect(ar.listTitle).toBe('كتيّبات الاسترداد');
    expect(ar.runStatusLabels.completed).toBe('مكتمل');
    expect(ar.runModeLabels.rehearsal).toBe('بروفة');
    // Arabic-script content present; the English headline must not leak through.
    expect(ar.liveTitle).toMatch(/[؀-ۿ]/);
    expect(ar.liveTitle).not.toBe(runbookPageLabelBundle.en.liveTitle);
  });

  it('isRunbookRunTerminal matches the real backend terminal run statuses', () => {
    expect(isRunbookRunTerminal('completed')).toBe(true);
    expect(isRunbookRunTerminal('failed')).toBe(true);
    expect(isRunbookRunTerminal('aborted')).toBe(true);
    expect(isRunbookRunTerminal('pending')).toBe(false);
    expect(isRunbookRunTerminal('running')).toBe(false);
    expect(isRunbookRunTerminal(null)).toBe(false);
  });
});
