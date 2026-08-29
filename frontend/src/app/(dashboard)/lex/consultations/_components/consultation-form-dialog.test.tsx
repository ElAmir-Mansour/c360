import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { consultationsApi, type Consultation } from '@/lib/lex/consultations';
import { ConsultationFormDialog } from './consultation-form-dialog';
import { resolveConsultationLabels } from './labels';

vi.mock('@/lib/toast', () => ({
  showApiError: vi.fn(),
  showSuccess: vi.fn(),
}));

const labels = resolveConsultationLabels('en');
const createdConsultation = {
  id: 'consultation-1',
  consultation_number: 'CONS-20260722-ABC12345',
} as Consultation;

describe('ConsultationFormDialog', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('submits a normalized consultation and returns the created record', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onSaved = vi.fn();
    const submit = vi
      .spyOn(consultationsApi, 'submit')
      .mockResolvedValue(createdConsultation);

    renderWithQuery(
      <ConsultationFormDialog
        open
        onOpenChange={onOpenChange}
        onSaved={onSaved}
        defaultRequesterName="Super User"
      />,
    );

    expect(screen.getByLabelText(new RegExp(labels.form.requesterName))).toHaveValue('Super User');

    await user.type(screen.getByLabelText(labels.form.titleEn), 'Vendor contract review');
    await user.type(
      screen.getByLabelText(new RegExp(labels.form.question)),
      'Can we terminate this agreement before renewal?',
    );
    await user.type(screen.getByLabelText(labels.form.department), 'Procurement');
    await user.type(screen.getByLabelText(labels.form.tags), ' Contracts, Urgent, contracts ');

    expect(screen.getByText(labels.form.readiness(3, 3))).toBeInTheDocument();
    expect(screen.getByText('contracts')).toBeInTheDocument();
    expect(screen.getByText('urgent')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: labels.form.submit }));

    await waitFor(() => {
      expect(submit).toHaveBeenCalledWith({
        type: 'general',
        priority: 'medium',
        title: { en: 'Vendor contract review', ar: '' },
        requester_name: 'Super User',
        department: 'Procurement',
        question: 'Can we terminate this agreement before renewal?',
        tags: ['contracts', 'urgent'],
      });
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(createdConsultation));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('blocks submission and displays required-field errors', async () => {
    const user = userEvent.setup();
    const submit = vi.spyOn(consultationsApi, 'submit').mockResolvedValue(createdConsultation);

    renderWithQuery(<ConsultationFormDialog open onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: labels.form.submit }));

    expect(await screen.findByText(labels.form.errors.titleRequired)).toBeInTheDocument();
    expect(screen.getByText(labels.form.errors.requesterRequired)).toBeInTheDocument();
    expect(screen.getByText(labels.form.errors.questionRequired)).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });
});
