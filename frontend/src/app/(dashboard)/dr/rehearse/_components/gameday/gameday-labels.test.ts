import { describe, expect, it } from 'vitest';

import { resolveDRBilingual } from '../../../_lib/dr-i18n';
import { gameDayLabelBundle, gameDayLabels, type GameDayLabels } from './gameday-labels';

/**
 * Unit test for the Game Day bilingual label bundle.
 *
 * Proves THE BILINGUAL CONTRACT: both locales carry FULL, same-shaped copies (no
 * missing keys), Arabic is real MSA, the REAL backend safety-verdict / run-status
 * tokens are present on both locales, the function-valued `stepSummary` preserves
 * its Western digits, interpolation tokens survive, and resolution defaults to
 * English. Includes the required ar/RTL case.
 */

function leafPaths(value: unknown, prefix = ''): string[] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      leafPaths(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [prefix];
}

describe('gameDayLabelBundle', () => {
  it('English and Arabic have identical key shapes (full, same-shaped copies)', () => {
    expect(leafPaths(gameDayLabelBundle.ar).sort()).toEqual(
      leafPaths(gameDayLabelBundle.en).sort(),
    );
  });

  it('exposes the real safety-verdict tokens on both locales', () => {
    const verdicts = ['safe', 'unsafe', 'inconclusive'].sort();
    expect(Object.keys(gameDayLabelBundle.en.safetyVerdicts).sort()).toEqual(verdicts);
    expect(Object.keys(gameDayLabelBundle.ar.safetyVerdicts).sort()).toEqual(verdicts);
  });

  it('preserves Western digits in stepSummary across both locales', () => {
    expect(gameDayLabelBundle.en.stepSummary(3, 5)).toContain('3');
    expect(gameDayLabelBundle.en.stepSummary(3, 5)).toContain('5');
    expect(gameDayLabelBundle.ar.stepSummary(3, 5)).toContain('3');
    expect(gameDayLabelBundle.ar.stepSummary(3, 5)).toContain('5');
  });

  it('formats latency (ms) and signed second deltas with Western digits on both locales', () => {
    expect(gameDayLabelBundle.en.millis(420)).toContain('420');
    expect(gameDayLabelBundle.ar.millis(420)).toContain('420');
    // Signed deltas keep their sign and digits in both locales.
    expect(gameDayLabelBundle.en.diff.secondsDelta(12)).toBe('+12 s');
    expect(gameDayLabelBundle.en.diff.secondsDelta(-3)).toBe('-3 s');
    expect(gameDayLabelBundle.ar.diff.secondsDelta(12)).toContain('+12');
    expect(gameDayLabelBundle.ar.diff.secondsDelta(-3)).toContain('-3');
  });

  it('carries the drill-diff sub-bundle with Arabic copy under "ar"', () => {
    expect(gameDayLabelBundle.en.diff.heading).toBe('Drill diff (planned vs actual)');
    expect(gameDayLabelBundle.ar.diff.heading).toMatch(/[؀-ۿ]/);
    expect(gameDayLabelBundle.ar.diff.heading).not.toBe(gameDayLabelBundle.en.diff.heading);
  });

  it('preserves the {name}/{verdict} interpolation tokens across both locales', () => {
    expect(gameDayLabelBundle.en.scenarioCreatedAnnouncement('Region loss')).toContain(
      'Region loss',
    );
    expect(gameDayLabelBundle.ar.scenarioCreatedAnnouncement('Region loss')).toContain(
      'Region loss',
    );
    expect(gameDayLabelBundle.en.runCompletedAnnouncement('safe')).toContain('safe');
    expect(gameDayLabelBundle.ar.runCompletedAnnouncement('safe')).toContain('safe');
  });

  it('defaults to English and exports the en surface as gameDayLabels', () => {
    const resolved: GameDayLabels = resolveDRBilingual(gameDayLabelBundle, 'en');
    expect(resolved.title).toBe('Game Day');
    expect(gameDayLabels).toBe(gameDayLabelBundle.en);
  });

  it('resolves the full MSA Arabic surface for locale "ar" (RTL)', () => {
    const ar: GameDayLabels = resolveDRBilingual(gameDayLabelBundle, 'ar');
    expect(ar.title).toBe('يوم المحاكاة');
    expect(ar.safetyVerdicts.safe).toBe('آمن');
    expect(ar.createTriggerLabel).not.toBe(gameDayLabelBundle.en.createTriggerLabel);
    expect(ar.scorecardHeading).toMatch(/[؀-ۿ]/);
  });
});
