import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ENTITLEMENT_REQUIRED_EVENT, PERMISSION_DENIED_EVENT } from '@/lib/api';
import { getMessages } from '@/lib/i18n/messages';

import { LocaleProvider } from './locale-provider';
import { ToastProvider } from './toast-provider';

function renderProvider(locale: 'en' | 'ar' = 'en') {
  return render(
    <LocaleProvider
      locale={locale}
      direction={locale === 'ar' ? 'rtl' : 'ltr'}
      messages={getMessages(locale)}
    >
      <ToastProvider />
    </LocaleProvider>,
  );
}

describe('ToastProvider entitlement listener', () => {
  it('shows an upgrade toast when the API reports a missing entitlement', async () => {
    renderProvider('en');

    window.dispatchEvent(
      new CustomEvent(ENTITLEMENT_REQUIRED_EVENT, {
        detail: {
          status: 402,
          code: 'ENTITLEMENT_REQUIRED',
          message: 'Your plan does not include Watheeq.',
          plan_required: 'app.watheeq',
          upgrade_url: '/register?suites=lex&plan=trial',
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText('Upgrade required')).toBeInTheDocument();
    });
    expect(screen.getByText('Your plan does not include Watheeq.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /review/i })).toBeInTheDocument();
  });
});

describe('ToastProvider permission listener', () => {
  it('shows an actionable permission toast on a 403 event', async () => {
    renderProvider('en');

    window.dispatchEvent(
      new CustomEvent(PERMISSION_DENIED_EVENT, {
        detail: {
          status: 403,
          code: 'PERMISSION_DENIED',
          message: 'forbidden',
          required_permission: 'audit:read',
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText('Permission required')).toBeInTheDocument();
    });
    expect(
      screen.getByText(/You don't have permission to view audit logs/i),
    ).toBeInTheDocument();
  });

  it('renders Arabic copy under the ar locale', async () => {
    renderProvider('ar');

    window.dispatchEvent(
      new CustomEvent(PERMISSION_DENIED_EVENT, {
        detail: {
          status: 403,
          code: 'PERMISSION_DENIED',
          message: 'forbidden',
          required_permission: 'lex:contract:approve',
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByText('صلاحية مطلوبة')).toBeInTheDocument();
    });
    // Arabic copy keeps the raw slug so the admin can recognize it.
    expect(screen.getByText(/lex:contract:approve/)).toBeInTheDocument();
  });
});
