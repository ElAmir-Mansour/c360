import { describe, expect, it } from 'vitest';
import {
  buildDecisionSummary,
  buildEvidenceSummary,
  buildFilingSummary,
  metadataNumber,
  metadataText,
  resolveRecordText,
} from './deep-tab-model';

describe('deep case tab model', () => {
  it('reads direct and metadata fallback values safely', () => {
    expect(metadataText({ court_reference: ' COURT-22 ' }, 'court_reference')).toBe('COURT-22');
    expect(metadataNumber({ evidence_strength: '78' }, 'evidence_strength')).toBe(78);
    expect(resolveRecordText({ recipient: 'Court', metadata: { recipient: 'Fallback' } }, 'recipient')).toBe('Court');
    expect(resolveRecordText({ metadata: { recipient: 'Fallback' } }, 'recipient')).toBe('Fallback');
  });

  it('builds evidence KPIs, strength, and categories', () => {
    expect(
      buildEvidenceSummary([
        { status: 'admitted', category: 'documentary', strength: 80 },
        { status: 'submitted', category: 'digital', strength: 60 },
        { status: 'rejected', category: 'digital', strength: 40 },
      ]),
    ).toEqual({
      total: 3,
      admitted: 1,
      underReview: 1,
      challenged: 1,
      strength: 60,
      categories: { documentary: 1, digital: 2 },
    });
  });

  it('calculates active filing KPIs and sorts future deadlines', () => {
    const result = buildFilingSummary(
      [
        { title: 'Later', direction: 'incoming', status: 'approved', responseDeadline: '2026-02-03' },
        { title: 'Sooner', direction: 'outgoing', status: 'filed', responseDeadline: '2026-02-01' },
        { title: 'Past', direction: 'internal', status: 'rejected', responseDeadline: '2025-01-01' },
      ],
      new Date('2026-01-01'),
    );
    expect(result).toMatchObject({ total: 3, outgoing: 1, incoming: 1, acceptanceRate: 67 });
    expect(result.deadlines.map((item) => item.title)).toEqual(['Sooner', 'Later']);
  });

  it('derives decision trajectory and the next expected ruling', () => {
    const result = buildDecisionSummary([
      { impact: 'positive', nextExpectedRulingAt: '2026-08-03', nextExpectedRuling: 'Final judgment' },
      { impact: 'positive', nextExpectedRulingAt: '2026-07-30', nextExpectedRuling: 'Interim order' },
      { impact: 'negative' },
      { impact: 'neutral' },
    ]);
    expect(result).toMatchObject({ total: 4, positive: 2, negative: 1, neutral: 1, trajectory: 'positive' });
    expect(result.next?.nextExpectedRuling).toBe('Interim order');
  });
});
