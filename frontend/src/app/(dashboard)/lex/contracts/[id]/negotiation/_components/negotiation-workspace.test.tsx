import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LocaleProvider } from '@/components/providers/locale-provider';
import { getMessages } from '@/lib/i18n/messages';
import { NegotiationWorkspace } from './negotiation-workspace';

describe('NegotiationWorkspace', () => {
  it('renders the English Figma composition and supports clause-level decisions', async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider
        locale="en"
        direction="ltr"
        messages={getMessages('en')}
      >
        <NegotiationWorkspace
          contractId="contract-uuid"
          contractRef="CON-2024-089"
          contractTitle="Technology Services Agreement"
        />
      </LocaleProvider>,
    );

    expect(
      screen.getByRole('heading', { name: 'Version Comparison Summary' }),
    ).toBeInTheDocument();
    expect(screen.getByText('ORIGINAL DRAFT (V1.2)')).toBeInTheDocument();
    expect(
      screen.getByText('MODIFIED PROPOSAL (V1.3 BY CLIENT)'),
    ).toBeInTheDocument();

    const acceptButtons = screen.getAllByRole('button', { name: 'Accept' });
    await user.click(acceptButtons[0]);

    expect(acceptButtons[0]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Change accepted');
  });

  it('applies bulk decisions across every proposed change', async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider
        locale="en"
        direction="ltr"
        messages={getMessages('en')}
      >
        <NegotiationWorkspace
          contractId="contract-uuid"
          contractRef="CON-2024-089"
          contractTitle="Technology Services Agreement"
        />
      </LocaleProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Reject All Changes' }));

    for (const button of screen.getAllByRole('button', { name: 'Reject' })) {
      expect(button).toHaveAttribute('aria-pressed', 'true');
    }
    expect(screen.getByRole('status')).toHaveTextContent(
      'All proposed changes rejected',
    );
  });

  it('renders the Arabic-specific comparison layout and localized controls', () => {
    render(
      <LocaleProvider
        locale="ar"
        direction="rtl"
        messages={getMessages('ar')}
      >
        <NegotiationWorkspace
          contractId="contract-uuid"
          contractRef="CON-2024-089"
          contractTitle="اتفاقية الخدمات التقنية"
        />
      </LocaleProvider>,
    );

    const workspace = screen.getByTestId('negotiation-workspace');
    expect(workspace).toHaveAttribute('dir', 'rtl');
    expect(
      screen.getByRole('heading', { name: 'ملخص الفروقات بين النسخ' }),
    ).toBeInTheDocument();
    expect(screen.getByText('النسخة المعدلة (الطرف الثاني)')).toBeInTheDocument();
    expect(screen.getByText('النسخة الأصلية (مسودة نظامية)')).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'قبول التعديل' }),
    ).toHaveLength(2);
  });
});
