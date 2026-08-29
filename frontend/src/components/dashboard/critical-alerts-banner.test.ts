import { describe, expect, it } from 'vitest';
import { promotedSeverities } from './critical-alerts-banner';

describe('critical alert promotion threshold', () => {
  it('promotes only severities at or above the selected threshold', () => {
    expect(promotedSeverities('critical')).toEqual(['critical']);
    expect(promotedSeverities('high')).toEqual(['critical', 'high']);
    expect(promotedSeverities('medium')).toEqual(['critical', 'high', 'medium']);
  });
});
