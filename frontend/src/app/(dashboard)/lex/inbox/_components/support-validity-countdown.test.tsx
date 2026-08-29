import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { LocaleProvider } from '@/components/providers/locale-provider';
import { getMessages } from '@/lib/i18n/messages';
import { SupportValidityCountdown } from './support-validity-countdown';

describe('SupportValidityCountdown', () => {
  it('renders a neutral localized live-validity value and accessible progress', () => {
    render(
      <LocaleProvider locale="en" direction="ltr" messages={getMessages('en')}>
        <SupportValidityCountdown
          createdAt="2026-08-01T08:00:00Z"
          expiresAt="2026-08-03T08:00:00Z"
          now={new Date('2026-08-02T08:00:00Z').getTime()}
          label="Support validity"
          noExpiryLabel="No expiry window"
          reachedLabel="Validity ended"
          remainingLabel={(relative) => `Valid ${relative}`}
        />
      </LocaleProvider>,
    );

    expect(screen.getByText(/Valid (tomorrow|in 1 day)/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Support validity' })).toHaveAttribute('aria-valuenow', '50');
    expect(screen.queryByText(/SLA|overdue|breach/i)).not.toBeInTheDocument();
  });

  it('uses the supplied Arabic no-expiry label without a progress meter', () => {
    render(
      <LocaleProvider locale="ar" direction="rtl" messages={getMessages('ar')}>
        <SupportValidityCountdown
          createdAt="2026-08-01T08:00:00Z"
          expiresAt={null}
          now={0}
          label="صلاحية الدعم"
          noExpiryLabel="دون مدة صلاحية"
          reachedLabel="انتهت الصلاحية"
          remainingLabel={(relative) => `صالح ${relative}`}
        />
      </LocaleProvider>,
    );

    expect(screen.getByRole('status')).toHaveTextContent('دون مدة صلاحية');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });
});
