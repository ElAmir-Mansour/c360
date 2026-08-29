import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TaskDetailForm } from './task-detail-form';
import { LocaleProvider } from '@/components/providers/locale-provider';
import { getLocaleDirection, type AppLocale } from '@/lib/i18n';
import { getMessages } from '@/lib/i18n/messages';
import type { FormField } from '@/types/models';

function renderWithLocale(ui: React.ReactElement, locale: AppLocale) {
  return render(
    <LocaleProvider
      locale={locale}
      direction={getLocaleDirection(locale)}
      messages={getMessages(locale)}
    >
      {ui}
    </LocaleProvider>,
  );
}

describe('TaskDetailForm — bilingual + RTL + conditional + new types', () => {
  it('renders the EN label under locale=en with ltr form direction', () => {
    const schema: FormField[] = [
      { name: 'title', type: 'text', label: { ar: 'العنوان', en: 'Title' }, required: false },
    ];

    const { container } = renderWithLocale(
      <TaskDetailForm formSchema={schema} onSubmit={vi.fn().mockResolvedValue(undefined)} />,
      'en',
    );

    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.queryByText('العنوان')).not.toBeInTheDocument();
    expect(container.querySelector('form')).toHaveAttribute('dir', 'ltr');
  });

  it('renders the AR label and RTL form direction under locale=ar', () => {
    const schema: FormField[] = [
      { name: 'title', type: 'text', label: { ar: 'العنوان', en: 'Title' }, required: false },
    ];

    const { container } = renderWithLocale(
      <TaskDetailForm formSchema={schema} onSubmit={vi.fn().mockResolvedValue(undefined)} />,
      'ar',
    );

    expect(screen.getByText('العنوان')).toBeInTheDocument();
    expect(screen.queryByText('Title')).not.toBeInTheDocument();
    expect(container.querySelector('form')).toHaveAttribute('dir', 'rtl');
  });

  it('does NOT block submit while a required conditional field is hidden, blocks once visible', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const schema: FormField[] = [
      {
        name: 'escalate',
        type: 'boolean',
        label: { ar: 'تصعيد؟', en: 'Escalate?' },
        required: true,
      },
      {
        name: 'reason',
        type: 'text',
        label: { ar: 'السبب', en: 'Reason' },
        required: true,
        visibleWhen: [{ field: 'escalate', operator: 'eq', value: true }],
      },
    ];

    renderWithLocale(<TaskDetailForm formSchema={schema} onSubmit={onSubmit} />, 'en');

    // `reason` is hidden while escalate != true.
    expect(screen.queryByLabelText(/reason/i)).not.toBeInTheDocument();

    // Answer "No" -> escalate=false, reason stays hidden & excluded; submit fires.
    await user.click(screen.getByLabelText(/no/i));
    await user.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ escalate: false });
  });

  it('blocks submit once the required conditional field is visible and empty', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const schema: FormField[] = [
      {
        name: 'escalate',
        type: 'boolean',
        label: { ar: 'تصعيد؟', en: 'Escalate?' },
        required: true,
      },
      {
        name: 'reason',
        type: 'text',
        label: { ar: 'السبب', en: 'Reason' },
        required: true,
        visibleWhen: [{ field: 'escalate', operator: 'eq', value: true }],
      },
    ];

    renderWithLocale(<TaskDetailForm formSchema={schema} onSubmit={onSubmit} />, 'en');

    // Answer "Yes" -> escalate=true, reason becomes visible & required.
    await user.click(screen.getByLabelText(/yes/i));
    await screen.findByLabelText(/reason/i);

    await user.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => {
      expect(onSubmit).not.toHaveBeenCalled();
    });

    // Filling it in unblocks submit.
    await user.type(screen.getByLabelText(/reason/i), 'High risk');
    await user.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      escalate: true,
      reason: 'High risk',
    });
  });

  it('renders a radio field (new type) and submits the selected value', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const schema: FormField[] = [
      {
        name: 'priority',
        type: 'radio',
        label: { ar: 'الأولوية', en: 'Priority' },
        required: true,
        options: [
          { value: 'low', label: { ar: 'منخفض', en: 'Low' } },
          { value: 'high', label: { ar: 'مرتفع', en: 'High' } },
        ],
      },
    ];

    renderWithLocale(<TaskDetailForm formSchema={schema} onSubmit={onSubmit} />, 'en');

    expect(screen.getByLabelText('Low')).toBeInTheDocument();
    expect(screen.getByLabelText('High')).toBeInTheDocument();

    await user.click(screen.getByLabelText('High'));
    await user.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ priority: 'high' });
  });
});
