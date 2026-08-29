import { describe, expect, it } from 'vitest';

import {
  composeContractExecutiveSummary,
  localizeContractGeneratedText,
  localizeContractSignal,
  type ContractSummarySource,
} from './contract-value-localization';

const RISK_LABELS_AR: Record<string, string> = {
  none: 'بلا خطورة',
  low: 'منخفضة',
  medium: 'متوسطة',
  high: 'عالية',
  critical: 'حرجة',
};

const BRIEF: ContractSummarySource = {
  title: 'Fleet Maintenance Partnership',
  type: 'partnership',
  status: 'internal_review',
  counterparty: 'Acme Logistics',
  owner: 'Case Supervisor',
  value: 12,
  currency: 'SAR',
  effective_date: '2026-08-01',
  expiry_date: '2027-08-01',
  // The server composes this paragraph in Arabic regardless of the reader.
  executive_summary: '«Fleet Maintenance Partnership» عقد من نوع عقد شراكة مع Acme Logistics.',
};

describe('composeContractExecutiveSummary', () => {
  it('renders an English summary for an English reader instead of the server Arabic prose', () => {
    const summary = composeContractExecutiveSummary(BRIEF, 'en');

    expect(summary).toBe(
      '“Fleet Maintenance Partnership” is a partnership agreement with Acme Logistics, ' +
        'owned by Case Supervisor, currently internal review, valued at 12 SAR, ' +
        'running from 2026-08-01 to 2027-08-01.',
    );
    expect(summary).not.toMatch(/[؀-ۿ]/);
  });

  it('renders an Arabic summary for an Arabic reader', () => {
    const summary = composeContractExecutiveSummary(BRIEF, 'ar');

    expect(summary).toContain('عقد شراكة');
    expect(summary).toContain('وحالته الحالية مراجعة داخلية');
    expect(summary).not.toContain('is a');
  });

  it('omits absent operands rather than emitting empty fragments', () => {
    const summary = composeContractExecutiveSummary(
      { title: 'NDA — Vendor', type: 'nda', status: 'draft' },
      'en',
    );

    expect(summary).toBe('“NDA — Vendor” is a non-disclosure agreement, currently draft.');
  });

  it('falls back to the server text when the brief carries no title', () => {
    expect(
      composeContractExecutiveSummary({ ...BRIEF, title: '' }, 'en'),
    ).toBe(BRIEF.executive_summary);
  });

  it('uses the injected currency formatter when one is supplied', () => {
    const summary = composeContractExecutiveSummary({ ...BRIEF, expiry_date: null }, 'en', {
      formatDate: (value) => value,
      formatNumber: (value) => String(value),
      formatCurrency: (value, currency) => `${currency} ${value.toFixed(2)}`,
    });

    expect(summary).toContain('valued at SAR 12.00');
  });
});

describe('risk summary localization', () => {
  it('translates the pending-analysis sentence for an Arabic reader', () => {
    expect(
      localizeContractGeneratedText(
        'Risk analysis is pending; current contract risk is none.',
        'ar',
        RISK_LABELS_AR,
      ),
    ).toBe('تحليل المخاطر قيد الانتظار؛ ومستوى خطورة العقد الحالي بلا خطورة.');
  });

  it('leaves the English sentence untouched for an English reader', () => {
    const value = 'Risk analysis is pending; current contract risk is none.';
    expect(localizeContractGeneratedText(value, 'en', RISK_LABELS_AR)).toBe(value);
  });
});

describe('localizeContractSignal', () => {
  it('shows a readable source label instead of the raw record path in English', () => {
    const signal = localizeContractSignal(
      { label: 'Payment terms', value: '45', source: 'contract.payment_terms' },
      'en',
    );

    expect(signal.source).toBe('Payment terms');
    expect(signal.label).toBe('Payment terms');
    expect(signal.value).toBe('45');
  });
});
