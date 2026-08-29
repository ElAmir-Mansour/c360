/**
 * Render + interaction tests for the instantiate dialog. Proves the conflict
 * preview is NON-blocking (confirm stays enabled) and that confirming calls
 * `instantiateTemplate(id, { overrides })` and surfaces the new policy id.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { RequestApprovalPolicyTemplate } from '@/lib/lex/request-approval-policies';
import { resolveTemplateLabels } from '../_labels';
import { InstantiateTemplateDialog } from './instantiate-template-dialog';

const { conflictCheckMock, instantiateTemplateMock } = vi.hoisted(() => ({
  conflictCheckMock: vi.fn(),
  instantiateTemplateMock: vi.fn(),
}));

vi.mock('@/lib/lex/request-approval-policies', () => ({
  lexRequestApprovalPoliciesApi: {
    conflictCheck: conflictCheckMock,
    instantiateTemplate: instantiateTemplateMock,
  },
}));

vi.mock('@/lib/toast', () => ({
  showSuccess: vi.fn(),
  showApiError: vi.fn(),
}));

const labels = resolveTemplateLabels('en');

const template: RequestApprovalPolicyTemplate = {
  id: 'tpl-1',
  tenant_id: 'tenant-1',
  name: 'Procurement routing',
  description: '',
  category: 'procurement',
  definition: {
    request_type: 'consultation',
    department: 'Legal',
    mode: 'parallel',
    quorum: 'all',
    approvers: [{ type: 'role', ref: 'legal_counsel' }],
  },
  created_by: 'u-1',
  updated_by: null,
  created_at: '2026-05-01T09:00:00Z',
  updated_at: '2026-05-10T09:00:00Z',
};

beforeEach(() => {
  conflictCheckMock.mockReset();
  instantiateTemplateMock.mockReset();
  conflictCheckMock.mockResolvedValue({
    has_conflicts: true,
    has_identical: false,
    conflicts: [{ id: 'pol-x', name: 'X' }],
  });
  instantiateTemplateMock.mockResolvedValue({
    id: 'pol-9000',
    name: 'Procurement routing',
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('InstantiateTemplateDialog', () => {
  it('shows a NON-blocking conflict warning and still allows confirm + surfaces the policy id', async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <InstantiateTemplateDialog labels={labels} open onOpenChange={vi.fn()} template={template} />,
    );

    // Preview conflicts → the warning renders the conflicting policy badge.
    await user.click(screen.getByRole('button', { name: labels.conflict.checkConflicts }));
    await waitFor(() => expect(conflictCheckMock).toHaveBeenCalledTimes(1));

    expect(
      screen.getByText(labels.conflict.conflictsHeader(1)),
    ).toBeInTheDocument();
    expect(screen.getByText('X')).toBeInTheDocument();

    // The conflict preview is NON-blocking: confirm stays enabled.
    const confirmButton = screen.getByRole('button', { name: labels.instantiate.confirm });
    expect(confirmButton).toBeEnabled();

    // Provide an override so we can assert the override payload is forwarded.
    await user.type(
      screen.getByPlaceholderText(labels.instantiate.overrideNamePlaceholder),
      'Custom policy name',
    );

    await user.click(confirmButton);

    await waitFor(() => expect(instantiateTemplateMock).toHaveBeenCalledTimes(1));
    expect(instantiateTemplateMock).toHaveBeenCalledWith('tpl-1', {
      overrides: { name: 'Custom policy name' },
    });

    // Success panel shows the returned policy id.
    expect(await screen.findByText('pol-9000')).toBeInTheDocument();
    expect(screen.getByText(labels.instantiate.successTitle)).toBeInTheDocument();
  });

  it('instantiates with no overrides when all fields are blank', async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <InstantiateTemplateDialog labels={labels} open onOpenChange={vi.fn()} template={template} />,
    );

    await user.click(screen.getByRole('button', { name: labels.instantiate.confirm }));

    await waitFor(() => expect(instantiateTemplateMock).toHaveBeenCalledTimes(1));
    expect(instantiateTemplateMock).toHaveBeenCalledWith('tpl-1', { overrides: undefined });
  });
});
