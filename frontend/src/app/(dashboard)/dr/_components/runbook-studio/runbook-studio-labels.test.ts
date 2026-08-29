import { describe, expect, it } from 'vitest';

import { resolveDRBilingual } from '../../_lib/dr-i18n';
import {
  runbookStudioLabelBundle,
  runbookStudioLabels,
  type RunbookStudioLabels,
} from './runbook-studio-labels';

/**
 * Unit test for the Runbook Studio bilingual label bundle.
 *
 * Proves THE BILINGUAL CONTRACT: both locales carry FULL, same-shaped copies (no
 * missing keys), Arabic is real MSA (not the English fallback), the embedded
 * `taskFlow` carries the REAL `RunbookTaskType` / `RunbookTaskRunStatus` enum keys
 * on both locales, interpolation tokens survive, and resolution defaults to
 * English so the `renderWithQuery` `en` default keeps assertions green. Includes
 * the required ar/RTL case.
 */

function leafPaths(value: unknown, prefix = ''): string[] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      leafPaths(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [prefix];
}

describe('runbookStudioLabelBundle', () => {
  it('English and Arabic have identical key shapes (full, same-shaped copies)', () => {
    expect(leafPaths(runbookStudioLabelBundle.ar).sort()).toEqual(
      leafPaths(runbookStudioLabelBundle.en).sort(),
    );
  });

  it('embeds the real RunbookTaskType / RunbookTaskRunStatus enum keys on both locales', () => {
    const taskTypes = ['manual', 'automated', 'approval_gate', 'comms', 'milestone'].sort();
    const statuses = [
      'pending',
      'runnable',
      'running',
      'complete',
      'skipped',
      'failed',
      'blocked',
    ].sort();
    expect(Object.keys(runbookStudioLabelBundle.en.taskFlow.taskTypes).sort()).toEqual(
      taskTypes,
    );
    expect(Object.keys(runbookStudioLabelBundle.ar.taskFlow.taskTypes).sort()).toEqual(
      taskTypes,
    );
    expect(Object.keys(runbookStudioLabelBundle.en.taskFlow.statuses).sort()).toEqual(
      statuses,
    );
    expect(Object.keys(runbookStudioLabelBundle.ar.taskFlow.statuses).sort()).toEqual(
      statuses,
    );
  });

  it('preserves interpolation tokens across both locales', () => {
    expect(runbookStudioLabelBundle.en.runbookCreatedAnnouncement('Tier-1')).toContain(
      'Tier-1',
    );
    expect(runbookStudioLabelBundle.ar.runbookCreatedAnnouncement('Tier-1')).toContain(
      'Tier-1',
    );
    expect(runbookStudioLabelBundle.en.runStartedAnnouncement('run-1')).toContain('run-1');
    expect(runbookStudioLabelBundle.ar.runStartedAnnouncement('run-1')).toContain('run-1');
  });

  it('defaults to English and exports the en surface as runbookStudioLabels', () => {
    const resolved: RunbookStudioLabels = resolveDRBilingual(runbookStudioLabelBundle, 'en');
    expect(resolved.title).toBe('Runbook Studio');
    expect(runbookStudioLabels).toBe(runbookStudioLabelBundle.en);
  });

  it('resolves the full MSA Arabic surface for locale "ar" (RTL)', () => {
    const ar: RunbookStudioLabels = resolveDRBilingual(runbookStudioLabelBundle, 'ar');
    expect(ar.title).toBe('استوديو كتيّب الاسترداد');
    expect(ar.taskFlow.taskTypes.approval_gate).toBe('بوابة موافقة');
    // Arabic must not leak English copy.
    expect(ar.createTriggerLabel).not.toBe(runbookStudioLabelBundle.en.createTriggerLabel);
    // Contains Arabic-script characters (RTL content present).
    expect(ar.startRunTriggerLabel).toMatch(/[؀-ۿ]/);
  });
});
