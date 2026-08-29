import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RequirementItem } from '@/lib/lex/requests';
import type { ServiceDeskLabels } from './labels';
import { RequirementSatisfyControls } from './requirement-satisfy-controls';

const { uploadMock, updateRequirementMock } = vi.hoisted(() => ({
  uploadMock: vi.fn(),
  updateRequirementMock: vi.fn(),
}));

vi.mock('@/lib/enterprise', () => ({
  enterpriseApi: {
    files: {
      upload: uploadMock,
      getPresignedDownload: vi.fn(),
    },
  },
}));

vi.mock('@/lib/lex/requests', () => ({
  lexRequestsApi: {
    updateRequirement: updateRequirementMock,
  },
}));

vi.mock('@/lib/toast', () => ({
  showApiError: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

const execLabels = {
  markSatisfied: 'Mark satisfied',
  markUnsatisfied: 'Mark pending',
  toast: { requirementUpdated: 'Requirement updated' },
} as ServiceDeskLabels['execution'];

const attachmentRequirement: RequirementItem = {
  id: 'req-item-1',
  tenant_id: 'tenant-1',
  legal_request_id: 'request-1',
  code: 'signed_contract',
  label: { en: 'Final signed contract', ar: 'العقد النهائي الموقع' },
  kind: 'attachment',
  required: true,
  satisfied: false,
  sort_order: 1,
  metadata: {},
  created_at: '2026-08-01T10:00:00Z',
  updated_at: '2026-08-01T10:00:00Z',
};

describe('RequirementSatisfyControls requester fulfillment mode', () => {
  beforeEach(() => {
    uploadMock.mockReset();
    updateRequirementMock.mockReset();
    uploadMock.mockResolvedValue({ id: 'file-1' });
    updateRequirementMock.mockResolvedValue({});
  });

  it('uploads evidence and satisfies the existing requirement without exposing legal toggles', async () => {
    const onChanged = vi.fn();
    const { container } = render(
      <RequirementSatisfyControls
        requestId="request-1"
        item={attachmentRequirement}
        execLabels={execLabels}
        mode="fulfill"
        onChanged={onChanged}
      />,
    );

    expect(screen.getByRole('button', { name: /Upload|رفع/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark satisfied' })).not.toBeInTheDocument();

    const file = new File(['signed contract'], 'signed-contract.pdf', {
      type: 'application/pdf',
    });
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    fireEvent.change(input!, { target: { files: [file] } });

    await waitFor(() => {
      expect(uploadMock).toHaveBeenCalledWith(
        file,
        {
          suite: 'lex',
          entity_type: 'requirement',
          lifecycle_policy: 'standard',
        },
        expect.any(Function),
      );
      expect(updateRequirementMock).toHaveBeenCalledWith('request-1', 'req-item-1', {
        file_id: 'file-1',
        satisfied: true,
      });
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
  });

  it('keeps the explicit satisfy toggle available to a legal manager', () => {
    render(
      <RequirementSatisfyControls
        requestId="request-1"
        item={attachmentRequirement}
        execLabels={execLabels}
        mode="manage"
        onChanged={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Mark satisfied' })).toBeInTheDocument();
  });
});
