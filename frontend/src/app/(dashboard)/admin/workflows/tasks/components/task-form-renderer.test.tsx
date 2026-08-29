import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { TaskFormRenderer } from './task-form-renderer';
import type { FormField } from '@/types/models';

describe('TaskFormRenderer — bilingual + RTL + conditional + field types', () => {
  describe('bilingual rendering and direction', () => {
    const bilingualFields: FormField[] = [
      {
        name: 'title',
        type: 'text',
        label: { ar: 'العنوان', en: 'Title' },
        required: false,
      },
    ];

    it('renders the EN label under locale=en with ltr form direction', () => {
      const { container } = renderWithQuery(
        <TaskFormRenderer
          fields={bilingualFields}
          readOnly={false}
          onSubmit={vi.fn()}
        />,
        { locale: 'en' },
      );

      expect(screen.getByText('Title')).toBeInTheDocument();
      expect(screen.queryByText('العنوان')).not.toBeInTheDocument();
      expect(container.querySelector('form')).toHaveAttribute('dir', 'ltr');
    });

    it('renders the AR label and RTL form direction under locale=ar', () => {
      const { container } = renderWithQuery(
        <TaskFormRenderer
          fields={bilingualFields}
          readOnly={false}
          onSubmit={vi.fn()}
        />,
        { locale: 'ar' },
      );

      expect(screen.getByText('العنوان')).toBeInTheDocument();
      expect(screen.queryByText('Title')).not.toBeInTheDocument();
      expect(container.querySelector('form')).toHaveAttribute('dir', 'rtl');
    });
  });

  describe('conditional visibility', () => {
    // `details` is shown only when `needsDetails` equals "yes", and is required.
    const conditionalFields: FormField[] = [
      {
        name: 'needsDetails',
        type: 'select',
        label: { ar: 'هل تريد المزيد؟', en: 'Want more?' },
        required: true,
        options: [
          { value: 'yes', label: { ar: 'نعم', en: 'Yes' } },
          { value: 'no', label: { ar: 'لا', en: 'No' } },
        ],
      },
      {
        name: 'details',
        type: 'text',
        label: { ar: 'التفاصيل', en: 'Details' },
        required: true,
        visibleWhen: [{ field: 'needsDetails', operator: 'eq', value: 'yes' }],
      },
    ];

    it('hides the conditional field until the controlling value is set, then shows it', async () => {
      const user = userEvent.setup();
      renderWithQuery(
        <TaskFormRenderer
          fields={conditionalFields}
          readOnly={false}
          onSubmit={vi.fn()}
        />,
        { locale: 'en' },
      );

      // The conditional "Details" field is absent from the DOM initially.
      expect(screen.queryByLabelText(/details/i)).not.toBeInTheDocument();

      // Set the controlling select to "Yes".
      await user.click(screen.getByRole('combobox'));
      await user.click(await screen.findByRole('option', { name: 'Yes' }));

      // Now the conditional field appears.
      await waitFor(() => {
        expect(screen.getByLabelText(/details/i)).toBeInTheDocument();
      });
    });

    it('does NOT block submit while the required conditional field is hidden', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      renderWithQuery(
        <TaskFormRenderer
          fields={conditionalFields}
          readOnly={false}
          onSubmit={onSubmit}
          formRef={undefined}
        />,
        { locale: 'en' },
      );

      // Select "No" so `details` stays hidden (and therefore excluded from the
      // schema). The form should submit even though `details` is "required".
      await user.click(screen.getByRole('combobox'));
      await user.click(await screen.findByRole('option', { name: 'No' }));

      // Trigger submit via the form's requestSubmit.
      const form = document.querySelector('form') as HTMLFormElement;
      form.requestSubmit();

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });
      expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ needsDetails: 'no' });
    });

    it('DOES block submit once the required conditional field is visible and empty', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      renderWithQuery(
        <TaskFormRenderer
          fields={conditionalFields}
          readOnly={false}
          onSubmit={onSubmit}
        />,
        { locale: 'en' },
      );

      // Select "Yes" so `details` becomes visible and required.
      await user.click(screen.getByRole('combobox'));
      await user.click(await screen.findByRole('option', { name: 'Yes' }));
      await screen.findByLabelText(/details/i);

      const form = document.querySelector('form') as HTMLFormElement;
      form.requestSubmit();

      await waitFor(() => {
        expect(onSubmit).not.toHaveBeenCalled();
      });

      // Filling it in unblocks submit.
      await user.type(screen.getByLabelText(/details/i), 'Some details');
      form.requestSubmit();

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });
      expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
        needsDetails: 'yes',
        details: 'Some details',
      });
    });
  });

  describe('new field types', () => {
    it('renders a radio field and submits the selected value', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      const fields: FormField[] = [
        {
          name: 'severity',
          type: 'radio',
          label: { ar: 'الخطورة', en: 'Severity' },
          required: true,
          options: [
            { value: 'low', label: { ar: 'منخفض', en: 'Low' } },
            { value: 'high', label: { ar: 'مرتفع', en: 'High' } },
          ],
        },
      ];

      renderWithQuery(
        <TaskFormRenderer fields={fields} readOnly={false} onSubmit={onSubmit} />,
        { locale: 'en' },
      );

      // Both radio options render with their EN labels.
      expect(screen.getByLabelText('Low')).toBeInTheDocument();
      expect(screen.getByLabelText('High')).toBeInTheDocument();

      await user.click(screen.getByLabelText('High'));

      const form = document.querySelector('form') as HTMLFormElement;
      form.requestSubmit();

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });
      expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ severity: 'high' });
    });

    it('renders a multiselect field and submits the selected values array', async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      const fields: FormField[] = [
        {
          name: 'tags',
          type: 'multiselect',
          label: { ar: 'الوسوم', en: 'Tags' },
          required: true,
          options: [
            { value: 'a', label: { ar: 'أ', en: 'Alpha' } },
            { value: 'b', label: { ar: 'ب', en: 'Beta' } },
          ],
        },
      ];

      renderWithQuery(
        <TaskFormRenderer fields={fields} readOnly={false} onSubmit={onSubmit} />,
        { locale: 'en' },
      );

      // Open the MultiSelect and pick two options.
      await user.click(screen.getByRole('combobox'));
      await user.click(await screen.findByRole('option', { name: 'Alpha' }));
      await user.click(screen.getByRole('option', { name: 'Beta' }));

      const form = document.querySelector('form') as HTMLFormElement;
      form.requestSubmit();

      await waitFor(() => {
        expect(onSubmit).toHaveBeenCalledTimes(1);
      });
      expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ tags: ['a', 'b'] });
    });
  });
});
