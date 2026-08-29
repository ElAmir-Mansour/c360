import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { LocaleProvider } from '@/components/providers/locale-provider';
import { getMessages } from '@/lib/i18n/messages';
import { KeyDatesStrip } from './key-dates-strip';

function renderStrip(props: Partial<React.ComponentProps<typeof KeyDatesStrip>> = {}) {
  return render(
    <LocaleProvider locale="en" direction="ltr" messages={getMessages('en')}>
      <KeyDatesStrip
        effective="2026-08-03T00:00:00Z"
        renewal={null}
        expiry="2027-08-03T00:00:00Z"
        {...props}
      />
    </LocaleProvider>,
  );
}

describe('KeyDatesStrip', () => {
  it('shows "Not set" for the renewal node on a manually renewed contract', () => {
    renderStrip({ autoRenew: false });

    expect(screen.getByText('Not set')).toBeInTheDocument();
    expect(screen.queryByText('Auto')).not.toBeInTheDocument();
  });

  it('derives the renewal date from expiry minus notice when the contract auto-renews', () => {
    // Regression: auto_renew is a flag and never populated renewal_date, so the
    // node used to read "Not set" on a contract the user had just set to renew.
    renderStrip({ autoRenew: true, noticeDays: 30 });

    expect(screen.queryByText('Not set')).not.toBeInTheDocument();
    expect(screen.getByText('Auto')).toBeInTheDocument();
    expect(screen.getByText('July 4, 2027')).toBeInTheDocument();
    expect(screen.getByText('Renews August 3, 2027')).toBeInTheDocument();
  });

  it('collapses onto the expiry date when no notice period is configured', () => {
    renderStrip({ autoRenew: true, noticeDays: 0 });

    expect(screen.getAllByText('August 3, 2027')).toHaveLength(2);
    expect(screen.queryByText(/^Renews /)).not.toBeInTheDocument();
  });

  it('prefers an explicit renewal date over the derived one', () => {
    renderStrip({
      autoRenew: true,
      noticeDays: 30,
      renewal: '2027-02-01T00:00:00Z',
    });

    expect(screen.getByText('February 1, 2027')).toBeInTheDocument();
    expect(screen.queryByText('July 4, 2027')).not.toBeInTheDocument();
  });

  it('falls back to an "Auto-renew" label when there is no expiry to derive from', () => {
    renderStrip({ autoRenew: true, expiry: null });

    expect(screen.getByText('Auto-renew')).toBeInTheDocument();
  });
});
