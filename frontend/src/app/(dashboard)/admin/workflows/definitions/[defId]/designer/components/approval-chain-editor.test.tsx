import { useState } from 'react';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { WorkflowStepConfig } from '@/types/models';
import { ApprovalChainEditor } from './approval-chain-editor';

vi.mock('@/components/shared/forms/tenant-user-picker', () => ({
  TenantUserPicker: ({
    ariaLabel,
    onChange,
  }: {
    ariaLabel: string;
    onChange: (value: string) => void;
  }) => (
    // Deliberately minimal test double for the shared picker trigger.
    <button type="button" aria-label={ariaLabel} onClick={() => onChange('user-123')}>
      Select a user
    </button>
  ),
}));

vi.mock('@/components/shared/forms/async-record-picker', () => ({
  AsyncRecordPicker: ({
    ariaLabel,
    onChange,
  }: {
    ariaLabel: string;
    onChange: (value: string) => void;
  }) => (
    // Deliberately minimal test double for the shared picker trigger.
    <button type="button" aria-label={ariaLabel} onClick={() => onChange('legal-director')}>
      Select a role
    </button>
  ),
}));

function renderControlled(initial: WorkflowStepConfig) {
  const latest = { value: initial };
  const Wrapper = () => {
    const [value, setValue] = useState(initial);
    return (
      <ApprovalChainEditor
        value={value}
        onChange={(patch) => {
          const next = { ...value, ...patch };
          latest.value = next;
          setValue(next);
        }}
      />
    );
  };
  renderWithQuery(<Wrapper />, { locale: 'en' });
  return () => latest.value;
}

describe('ApprovalChainEditor approver references', () => {
  it('selects literal user references through the tenant directory', async () => {
    const user = userEvent.setup();
    const current = renderControlled({
      approvers: [{ type: 'user', ref: '' }],
      mode: 'sequential',
      quorum: 'all',
    });

    await user.click(screen.getByRole('button', { name: 'Approvers 1' }));

    expect(current().approvers?.[0]).toEqual({ type: 'user', ref: 'user-123' });
  });

  it('keeps dynamic user references editable as workflow variables', () => {
    const current = renderControlled({
      approvers: [{ type: 'user', ref: '${variables.gm}' }],
      mode: 'sequential',
      quorum: 'all',
    });

    const reference = screen.getByRole('textbox', { name: 'Approvers 1' });
    expect(reference).toHaveValue('${variables.gm}');
    fireEvent.change(reference, { target: { value: '${variables.director}' } });

    expect(current().approvers?.[0]?.ref).toBe('${variables.director}');
  });

  it('selects role references by claimable role slug', async () => {
    const user = userEvent.setup();
    const current = renderControlled({
      approvers: [{ type: 'role', ref: '' }],
      mode: 'sequential',
      quorum: 'all',
    });

    await user.click(screen.getByRole('button', { name: 'Approvers 1' }));

    expect(current().approvers?.[0]).toEqual({ type: 'role', ref: 'legal-director' });
  });
});
