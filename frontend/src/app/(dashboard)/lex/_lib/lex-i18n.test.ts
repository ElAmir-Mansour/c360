import { describe, expect, it } from 'vitest';
import {
  lexOverviewLabels,
  resolveLexBilingual,
  type LexBilingual,
} from './lex-i18n';

interface SampleLabels {
  title: string;
  nested: {
    cases: string;
    missingFromMemory: string;
  };
  steps: string[];
  formatCount: (count: number) => string;
}

const sampleBundle: LexBilingual<SampleLabels> = {
  en: {
    title: 'Workflow Policies',
    nested: {
      cases: 'Litigation Cases',
      missingFromMemory: 'Definitely not a Watheeq v22 source string',
    },
    steps: ['Command center', 'Definitely not a Watheeq v22 array source'],
    formatCount: (count) => `Open ${count}`,
  },
  ar: {
    title: 'ترجمة عربية قديمة',
    nested: {
      cases: 'ترجمة قضايا قديمة',
      missingFromMemory: 'ترجمة عربية احتياطية',
    },
    steps: ['خطوة عربية قديمة', 'خطوة عربية احتياطية'],
    formatCount: (count) => `مفتوح ${count}`,
  },
};

describe('resolveLexBilingual authored-copy precedence', () => {
  it('keeps English labels untouched', () => {
    expect(resolveLexBilingual(sampleBundle, 'en')).toBe(sampleBundle.en);
  });

  it('uses the authored Arabic labels verbatim', () => {
    const labels = resolveLexBilingual(sampleBundle, 'ar');

    expect(labels.title).toBe('ترجمة عربية قديمة');
    expect(labels.nested.cases).toBe('ترجمة قضايا قديمة');
    expect(labels.steps[0]).toBe('خطوة عربية قديمة');
  });

  it('does not change Arabic labels based on English translation-memory matches', () => {
    const labels = resolveLexBilingual(sampleBundle, 'ar');

    expect(labels.nested.missingFromMemory).toBe('ترجمة عربية احتياطية');
    expect(labels.steps[1]).toBe('خطوة عربية احتياطية');
  });

  it('preserves function-valued Arabic labels', () => {
    const labels = resolveLexBilingual(sampleBundle, 'ar');

    expect(labels.formatCount(7)).toBe('مفتوح 7');
  });
});

describe('renewal timing labels', () => {
  it('describes negative offsets as overdue without exposing a raw minus value', () => {
    expect(lexOverviewLabels.en.renewals.daysShort(-26)).toBe(
      'Overdue by 26 days',
    );
    expect(lexOverviewLabels.ar.renewals.daysShort(-26)).toBe('متأخر 26 يومًا');
  });

  it('describes today and future offsets in plain language', () => {
    expect(lexOverviewLabels.en.renewals.daysShort(0)).toBe('Due today');
    expect(lexOverviewLabels.en.renewals.daysShort(1)).toBe('Due in 1 day');
    expect(lexOverviewLabels.en.renewals.daysShort(12)).toBe('Due in 12 days');
  });
});

describe('client-documented Overview wording', () => {
  it('keeps the supplied Arabic labels exactly as written', () => {
    const labels = resolveLexBilingual(lexOverviewLabels, 'ar');

    expect(labels.hero.greeting('neutral')).toBe('مرحبًا');
    expect(labels.hero.greeting('morning', 'نورة')).toBe(
      'صباح الخير، نورة',
    );
    expect(labels.domainsHeading).toBe('الشؤون القانونية');
    expect(labels.needsAttention.title).toBe('يتطلب انتباهًا');
    expect(labels.myWork.title).toBe('أعمالي');
  });
});
