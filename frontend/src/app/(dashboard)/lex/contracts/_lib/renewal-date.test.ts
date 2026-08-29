import { describe, expect, it } from 'vitest';

import { deriveRenewalDate } from './renewal-date';

describe('deriveRenewalDate', () => {
  it('pulls the expiry date back by the notice period', () => {
    // A 12-month contract expiring 3 Aug 2027 with 60 days' notice must be
    // renewed or cancelled by 4 Jun 2027.
    expect(deriveRenewalDate('2027-08-03T00:00:00Z', 60)?.toISOString()).toBe(
      '2027-06-04T00:00:00.000Z',
    );
  });

  it('accepts a Date as well as an ISO string', () => {
    expect(
      deriveRenewalDate(new Date('2027-08-03T00:00:00Z'), 30)?.toISOString(),
    ).toBe('2027-07-04T00:00:00.000Z');
  });

  it('returns the expiry date itself when no notice period applies', () => {
    for (const notice of [0, null, undefined, -5]) {
      expect(deriveRenewalDate('2027-08-03T00:00:00Z', notice)?.toISOString()).toBe(
        '2027-08-03T00:00:00.000Z',
      );
    }
  });

  it('returns null without a usable expiry date', () => {
    expect(deriveRenewalDate(null, 30)).toBeNull();
    expect(deriveRenewalDate(undefined, 30)).toBeNull();
    expect(deriveRenewalDate('', 30)).toBeNull();
    expect(deriveRenewalDate('not-a-date', 30)).toBeNull();
  });
});
