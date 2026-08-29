import { describe, expect, it } from 'vitest';
import { resolveWorkforceLabels } from './workforce-i18n';

describe('workforce support labels', () => {
  it('labels the support domain in both supported locales', () => {
    expect(resolveWorkforceLabels('en').domains.support).toBe('Peer support');
    expect(resolveWorkforceLabels('ar').domains.support).toBe('دعم الزملاء');
  });
});

