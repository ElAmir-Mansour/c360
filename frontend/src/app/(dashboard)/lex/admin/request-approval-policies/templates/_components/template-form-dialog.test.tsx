/**
 * Render + interaction tests for the template create/edit dialog. These prove the
 * structured editor actually drives a `createTemplate({ name, definition })` call
 * (definition derived from React state) and that an invalid draft BLOCKS save.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import { resolveTemplateLabels } from '../_labels';
import { TemplateFormDialog } from './template-form-dialog';

vi.mock('@/components/shared/forms/tenant-role-picker', () => ({
  TenantRolePicker: ({
    ariaLabel,
    value,
    onChange,
  }: {
    ariaLabel: string;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <input
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const { createTemplateMock, updateTemplateMock, listServicesMock } = vi.hoisted(() => ({
  createTemplateMock: vi.fn(),
  updateTemplateMock: vi.fn(),
  listServicesMock: vi.fn(),
}));

vi.mock('@/lib/lex/request-approval-policies', () => ({
  lexRequestApprovalPoliciesApi: {
    createTemplate: createTemplateMock,
    updateTemplate: updateTemplateMock,
  },
}));

vi.mock('@/lib/lex/requests', () => ({
  lexRequestsApi: {
    listServices: listServicesMock,
  },
}));

vi.mock('@/lib/toast', () => ({
  showSuccess: vi.fn(),
  showApiError: vi.fn(),
}));

const labels = resolveTemplateLabels('en');

beforeEach(() => {
  createTemplateMock.mockReset();
  updateTemplateMock.mockReset();
  listServicesMock.mockReset();
  listServicesMock.mockResolvedValue({
    data: [],
    meta: { page: 1, per_page: 500, total: 0, total_pages: 0 },
  });
  createTemplateMock.mockResolvedValue({ id: 'tpl-new', name: 'X', definition: {} });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('TemplateFormDialog', () => {
  it('derives the definition from structured state and calls createTemplate', async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <TemplateFormDialog labels={labels} open onOpenChange={vi.fn()} template={null} />,
    );

    // Fill the name (required).
    await user.type(screen.getByPlaceholderText(labels.dialog.namePlaceholder), 'Standard routing');
    // Fill a couple of structured fields.
    await user.type(
      screen.getByPlaceholderText(labels.dialog.requestTypePlaceholder),
      'consultation',
    );
    await user.type(screen.getByPlaceholderText(labels.dialog.departmentPlaceholder), 'Legal');
    // Provide an approver reference (a default blank approver row exists).
    await user.type(
      screen.getByLabelText(labels.dialog.approverRefRolePlaceholder),
      'legal_counsel',
    );

    await user.click(screen.getByRole('button', { name: labels.dialog.create }));

    await waitFor(() => expect(createTemplateMock).toHaveBeenCalledTimes(1));

    const payload = createTemplateMock.mock.calls[0][0];
    expect(payload.name).toBe('Standard routing');
    expect(payload.definition).toMatchObject({
      request_type: 'consultation',
      department: 'Legal',
      mode: 'parallel',
      quorum: 'all',
      approvers: [{ type: 'role', ref: 'legal_counsel' }],
    });
  });

  it('blocks save and shows the validation error when there are zero approvers', async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <TemplateFormDialog labels={labels} open onOpenChange={vi.fn()} template={null} />,
    );

    await user.type(screen.getByPlaceholderText(labels.dialog.namePlaceholder), 'Bad template');
    // Leave the approver ref blank → validateDefinition yields `approver_required`.

    // The validation panel surfaces the resolved message.
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(labels.validation.approverRequired)).toBeInTheDocument();

    // Save button is disabled (canSubmit is false), so clicking does nothing.
    const saveButton = screen.getByRole('button', { name: labels.dialog.create });
    expect(saveButton).toBeDisabled();
    await user.click(saveButton);

    expect(createTemplateMock).not.toHaveBeenCalled();
  });
});
