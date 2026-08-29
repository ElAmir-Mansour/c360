import { describe, expect, it } from 'vitest';

import { groupByReviewRound, hasMultipleRounds } from './review-rounds';

interface Row {
  id: string;
  cycle?: number | null;
}

describe('groupByReviewRound', () => {
  it('groups items into ascending rounds and preserves order within a round', () => {
    const rounds = groupByReviewRound<Row>([
      { id: 'a', cycle: 1 },
      { id: 'b', cycle: 1 },
      { id: 'c', cycle: 2 },
      { id: 'd', cycle: 2 },
    ]);

    expect(rounds.map((r) => r.cycle)).toEqual([1, 2]);
    expect(rounds[0].items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(rounds[1].items.map((i) => i.id)).toEqual(['c', 'd']);
  });

  it('sorts rounds numerically even when the input is out of order', () => {
    // 10 must follow 2, not sort lexicographically before it.
    const rounds = groupByReviewRound<Row>([
      { id: 'x', cycle: 10 },
      { id: 'y', cycle: 2 },
    ]);

    expect(rounds.map((r) => r.cycle)).toEqual([2, 10]);
  });

  it('treats missing or invalid cycles as round 1 rather than dropping the row', () => {
    // Everything written before round tracking belongs to the first round, and
    // losing a real comment would be far worse than misfiling one.
    const rounds = groupByReviewRound<Row>([
      { id: 'legacy' },
      { id: 'null-cycle', cycle: null },
      { id: 'zero', cycle: 0 },
      { id: 'negative', cycle: -3 },
      { id: 'nan', cycle: Number.NaN },
      { id: 'real', cycle: 2 },
    ]);

    expect(rounds.map((r) => r.cycle)).toEqual([1, 2]);
    expect(rounds[0].items.map((i) => i.id)).toEqual([
      'legacy',
      'null-cycle',
      'zero',
      'negative',
      'nan',
    ]);
    expect(rounds[1].items.map((i) => i.id)).toEqual(['real']);
  });

  it('does not invent empty rounds for gaps', () => {
    // A round can legitimately produce no comments and no uploads at all.
    const rounds = groupByReviewRound<Row>([
      { id: 'a', cycle: 1 },
      { id: 'c', cycle: 3 },
    ]);

    expect(rounds.map((r) => r.cycle)).toEqual([1, 3]);
  });

  it('returns no rounds for an empty thread', () => {
    expect(groupByReviewRound<Row>([])).toEqual([]);
  });

  it('floors fractional cycles instead of creating a separate round', () => {
    const rounds = groupByReviewRound<Row>([
      { id: 'a', cycle: 2 },
      { id: 'b', cycle: 2.7 },
    ]);

    expect(rounds).toHaveLength(1);
    expect(rounds[0].cycle).toBe(2);
  });
});

describe('hasMultipleRounds', () => {
  it('is false for a request that has never been returned', () => {
    // One round needs no separators; labelling it adds chrome without information.
    expect(hasMultipleRounds(groupByReviewRound<Row>([{ id: 'a', cycle: 1 }]))).toBe(false);
    expect(hasMultipleRounds(groupByReviewRound<Row>([]))).toBe(false);
  });

  it('is true once the request has been returned at least once', () => {
    expect(
      hasMultipleRounds(groupByReviewRound<Row>([{ id: 'a', cycle: 1 }, { id: 'b', cycle: 2 }])),
    ).toBe(true);
  });
});
