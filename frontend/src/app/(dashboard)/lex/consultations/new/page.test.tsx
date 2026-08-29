import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { consultationsApi, type Consultation } from '@/lib/lex/consultations';
import NewConsultationPage from './page';

const { pushMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => '/lex/consultations/new',
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: () => true,
    isHydrated: true,
    isAuthenticated: true,
    user: {
      id: 'user-1',
      first_name: 'Nora',
      last_name: 'Al-Zahrani',
      email: 'nora@example.test',
    },
  }),
}));

vi.mock('@/lib/toast', () => ({
  showApiError: vi.fn(),
  showSuccess: vi.fn(),
  showWarning: vi.fn(),
}));

const created = {
  id: 'consultation-1',
  consultation_number: 'CONS-2026-001',
} as Consultation;

describe('New consultation intake page', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  it('submits the Figma-aligned intake to the real consultation payload shape', async () => {
    const user = userEvent.setup();
    const submit = vi
      .spyOn(consultationsApi, 'submit')
      .mockResolvedValue(created);

    renderWithQuery(<NewConsultationPage />);

    expect(
      screen.getByRole('heading', {
        name: 'Request New Legal Consultation',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('Nora Al-Zahrani')).toBeInTheDocument();

    await user.type(
      screen.getByLabelText(/Consultation Subject/),
      'Employment policy review',
    );
    await user.type(
      screen.getByLabelText(/Detailed Description & Questions/),
      'Please confirm whether the revised policy complies with labor law.',
    );
    await user.type(
      screen.getByLabelText('Relevant Department'),
      'Human Resources',
    );
    await user.type(
      screen.getByLabelText(/Reference Contract or Case No/),
      'REQ-2026-001',
    );

    await user.click(
      screen.getByRole('button', { name: 'Submit consultation' }),
    );

    await waitFor(() => {
      expect(submit).toHaveBeenCalledWith({
        type: 'contractual',
        priority: 'medium',
        title: {
          en: 'Employment policy review',
          ar: '',
        },
        requester_name: 'Nora Al-Zahrani',
        department: 'Human Resources',
        question:
          'Please confirm whether the revised policy complies with labor law.',
        tags: ['contractual', 'normal'],
        metadata: {
          source: 'consultation_intake',
          reference_number: 'REQ-2026-001',
          urgency: 'normal',
          urgency_justification: null,
        },
      });
    });
    await waitFor(() =>
      expect(pushMock).toHaveBeenCalledWith(
        '/lex/consultations/consultation-1',
      ),
    );
  });

  it('requires a reason before an urgent consultation can be submitted', async () => {
    const user = userEvent.setup();
    const submit = vi
      .spyOn(consultationsApi, 'submit')
      .mockResolvedValue(created);

    renderWithQuery(<NewConsultationPage />);

    await user.type(
      screen.getByLabelText(/Consultation Subject/),
      'Urgent contract question',
    );
    await user.type(
      screen.getByLabelText(/Detailed Description & Questions/),
      'A deadline expires tomorrow and legal guidance is required.',
    );
    await user.click(
      screen.getByLabelText(
        'Urgent (3 working days — requires justification)',
      ),
    );
    await user.click(
      screen.getByRole('button', { name: 'Submit consultation' }),
    );

    expect(
      await screen.findByText('Urgent requests require a justification.'),
    ).toBeInTheDocument();
    expect(submit).not.toHaveBeenCalled();
  });
});
