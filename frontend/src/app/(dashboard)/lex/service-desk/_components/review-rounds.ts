'use client';

/**
 * Review-round grouping for the request detail thread.
 *
 * A request may be reviewed and returned between the business entity and the
 * legal department any number of times, each round carrying its own comments and
 * file uploads. Backend migration 000112 stamps every note and attachment with
 * the round it arrived in; this module turns that flat, chronologically-ordered
 * list into the rounds the UI renders, so "what did they send back the second
 * time" is answerable rather than lost in one undifferentiated pile.
 *
 * Pure and transport-free: callers pass already-fetched rows.
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type LexBilingual, resolveLexBilingual } from '../../_lib/lex-i18n';

/** Anything stamped with a review round. */
export interface RoundStamped {
  cycle?: number | null;
}

export interface ReviewRound<T> {
  /** 1-based round number. */
  cycle: number;
  items: T[];
}

/**
 * Groups round-stamped rows into ascending rounds.
 *
 * Rows are kept in the order given (the API returns them oldest-first), so the
 * thread still reads chronologically inside each round. A missing or invalid
 * cycle falls back to round 1 — every row predating round tracking belongs to
 * the first round, and defaulting is preferable to dropping a real comment.
 *
 * Rounds with no items are never invented: a gap can legitimately exist when a
 * round produced no comments or uploads at all.
 */
export function groupByReviewRound<T extends RoundStamped>(
  items: readonly T[],
): ReviewRound<T>[] {
  const byCycle = new Map<number, T[]>();

  for (const item of items) {
    const raw = item.cycle;
    const cycle = typeof raw === 'number' && Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
    const bucket = byCycle.get(cycle);
    if (bucket) {
      bucket.push(item);
    } else {
      byCycle.set(cycle, [item]);
    }
  }

  return [...byCycle.entries()]
    .sort(([a], [b]) => a - b)
    .map(([cycle, roundItems]) => ({ cycle, items: roundItems }));
}

/**
 * Whether the round separators are worth rendering at all. A request that has
 * never been returned has exactly one round, and labelling it "Round 1" adds
 * chrome without information.
 */
export function hasMultipleRounds<T extends RoundStamped>(rounds: readonly ReviewRound<T>[]): boolean {
  return rounds.length > 1;
}

export interface ReviewRoundLabels {
  /** Separator above each round's items, e.g. "Round 2". */
  roundHeading: (formattedRound: string) => string;
  /** Round currently accepting work. */
  currentRound: string;
  /** Count of times the request has been handed back. */
  returnCount: (formattedCount: string, isSingular: boolean) => string;
  /** SLA badge on a round whose clock was halted by a return. */
  slaStopped: string;
  /** SLA badge on the live round. */
  slaRunning: string;
  /** Tooltip explaining why a stopped round is not a breach. */
  slaStoppedHint: string;
}

const reviewRoundMessages: LexBilingual<ReviewRoundLabels> = {
  en: {
    roundHeading: (formattedRound) => `Round ${formattedRound}`,
    currentRound: 'Current round',
    returnCount: (formattedCount, isSingular) =>
      isSingular ? `Returned ${formattedCount} time` : `Returned ${formattedCount} times`,
    slaStopped: 'SLA stopped',
    slaRunning: 'SLA running',
    slaStoppedHint:
      'The SLA stopped when this round was returned to the requester, and is not counted as a breach. A new SLA starts when the request is sent back.',
  },
  ar: {
    roundHeading: (formattedRound) => `الجولة ${formattedRound}`,
    currentRound: 'الجولة الحالية',
    returnCount: (formattedCount, isSingular) =>
      isSingular ? `أُعيد ${formattedCount} مرة` : `أُعيد ${formattedCount} مرات`,
    slaStopped: 'توقفت اتفاقية مستوى الخدمة',
    slaRunning: 'اتفاقية مستوى الخدمة جارية',
    slaStoppedHint:
      'توقفت اتفاقية مستوى الخدمة عند إعادة هذه الجولة إلى مقدّم الطلب، ولا تُحتسب تجاوزًا. تبدأ اتفاقية جديدة عند إعادة إرسال الطلب.',
  },
};

export function useReviewRoundLabels(): ReviewRoundLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(() => resolveLexBilingual(reviewRoundMessages, locale), [locale]);
}
