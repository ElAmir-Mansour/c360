import { describe, expect, it } from 'vitest';

import {
  BULK_AI_CONCURRENCY,
  type BulkAiCategoryOption,
  type BulkAiKind,
  bulkAiKindLabel,
  bulkAiLabels,
  deriveCategorySlugs,
  runWithConcurrency,
} from './use-bulk-ai';

/* ------------------------------------------------------------------------- *
 * runWithConcurrency — the fan-out engine behind Analyze / Extract obligations
 * / Auto-categorize.
 * ------------------------------------------------------------------------- */

describe('runWithConcurrency', () => {
  it('processes every item exactly once while capping in-flight workers', async () => {
    const items = Array.from({ length: 7 }, (_, index) => index);
    const seen: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    await runWithConcurrency(items, BULK_AI_CONCURRENCY, async (item) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      seen.push(item);
      inFlight -= 1;
    });

    expect(maxInFlight).toBe(BULK_AI_CONCURRENCY);
    expect(seen).toHaveLength(items.length);
    expect([...seen].sort((a, b) => a - b)).toEqual(items);
  });

  it('never opens more lanes than there are items', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    await runWithConcurrency(['only'], 3, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
    });

    expect(maxInFlight).toBe(1);
  });

  it('resolves immediately for an empty selection', async () => {
    let calls = 0;
    await runWithConcurrency([], 3, async () => {
      calls += 1;
    });
    expect(calls).toBe(0);
  });
});

/* ------------------------------------------------------------------------- *
 * deriveCategorySlugs — auto-categorize input derivation.
 * ------------------------------------------------------------------------- */

const catalog: BulkAiCategoryOption[] = [
  { id: 'cat-1', name: 'NDA', slug: 'nda' },
  { id: 'cat-2', name: 'Service Agreement', slug: 'service-agreement' },
  { id: 'cat-3', name: 'Lease', slug: 'lease' },
];

describe('deriveCategorySlugs', () => {
  it('matches a contract type against a catalog slug', () => {
    expect(deriveCategorySlugs({ type: 'nda' }, catalog)).toEqual(['nda']);
  });

  it('normalizes hyphen/underscore/case differences and returns the RAW slug', () => {
    // type `service_agreement` vs catalog slug `service-agreement`.
    expect(deriveCategorySlugs({ type: 'service_agreement' }, catalog)).toEqual([
      'service-agreement',
    ]);
  });

  it('falls back to matching the catalog display name', () => {
    const nameOnly: BulkAiCategoryOption[] = [
      { id: 'cat-4', name: 'Lease', slug: 'real-estate-lease' },
    ];
    expect(deriveCategorySlugs({ type: 'lease' }, nameOnly)).toEqual([
      'real-estate-lease',
    ]);
  });

  it('returns no slugs when nothing in the tenant catalog matches', () => {
    expect(deriveCategorySlugs({ type: 'employment' }, catalog)).toEqual([]);
    expect(deriveCategorySlugs({ type: 'nda' }, [])).toEqual([]);
  });
});

/* ------------------------------------------------------------------------- *
 * Bilingual label bundle contract.
 * ------------------------------------------------------------------------- */

const ALL_KINDS: BulkAiKind[] = [
  'compliance',
  'analyze',
  'extract_obligations',
  'auto_categorize',
];

describe('bulkAiLabels', () => {
  it('keeps en/ar bundles structurally identical', () => {
    expect(Object.keys(bulkAiLabels.ar.actions)).toEqual(
      Object.keys(bulkAiLabels.en.actions),
    );
    expect(Object.keys(bulkAiLabels.ar.running)).toEqual(
      Object.keys(bulkAiLabels.en.running),
    );
    expect(Object.keys(bulkAiLabels.ar.toast)).toEqual(
      Object.keys(bulkAiLabels.en.toast),
    );
    expect(Object.keys(bulkAiLabels.ar.reasons)).toEqual(
      Object.keys(bulkAiLabels.en.reasons),
    );
    expect(Object.keys(bulkAiLabels.ar.dialog)).toEqual(
      Object.keys(bulkAiLabels.en.dialog),
    );
  });

  it('covers every bulk-AI kind with a running message in both locales', () => {
    for (const kind of ALL_KINDS) {
      expect(bulkAiLabels.en.running[kind]).toBeTruthy();
      expect(bulkAiLabels.ar.running[kind]).toBeTruthy();
    }
  });

  it('resolves a display name for every kind', () => {
    expect(bulkAiKindLabel(bulkAiLabels.en, 'compliance')).toBe(
      bulkAiLabels.en.actions.runCompliance,
    );
    expect(bulkAiKindLabel(bulkAiLabels.en, 'analyze')).toBe(
      bulkAiLabels.en.actions.analyze,
    );
    expect(bulkAiKindLabel(bulkAiLabels.en, 'extract_obligations')).toBe(
      bulkAiLabels.en.actions.extractObligations,
    );
    expect(bulkAiKindLabel(bulkAiLabels.ar, 'auto_categorize')).toBe(
      bulkAiLabels.ar.actions.autoCategorize,
    );
  });

  it('reports n/total progress in both locales', () => {
    expect(bulkAiLabels.en.progress(2, 5)).toContain('2/5');
    expect(bulkAiLabels.ar.progress(2, 5)).toContain('2/5');
  });
});
