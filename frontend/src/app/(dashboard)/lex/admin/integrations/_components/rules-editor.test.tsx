import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { RuleSpec } from '@/lib/lex/integrations';
import { extensibilityLabels } from '../_lib/extensibility-labels';
import { RulesEditor } from './rules-editor';

const { previewSyncMock, showApiErrorMock } = vi.hoisted(() => ({
  previewSyncMock: vi.fn(),
  showApiErrorMock: vi.fn(),
}));

vi.mock('@/lib/toast', () => ({
  showApiError: showApiErrorMock,
  showSuccess: vi.fn(),
  showBackendError: vi.fn(),
}));

vi.mock('@/lib/lex/integrations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/lex/integrations')>(
    '@/lib/lex/integrations',
  );
  return {
    ...actual,
    lexIntegrationsApi: {
      ...actual.lexIntegrationsApi,
      previewSync: previewSyncMock,
    },
  };
});

const en = extensibilityLabels.en;

/** Controlled wrapper that re-renders with the emitted rules (mirrors the parent form). */
function ControlledRules({
  initial = [],
  endpointId,
  onEmit,
}: {
  initial?: RuleSpec[];
  endpointId?: string;
  onEmit?: (r: RuleSpec[]) => void;
}) {
  const [rules, setRules] = useState<RuleSpec[]>(initial);
  return (
    <RulesEditor
      value={rules}
      endpointId={endpointId}
      onChange={(next) => {
        setRules(next);
        onEmit?.(next);
      }}
    />
  );
}

beforeEach(() => {
  previewSyncMock.mockReset();
  showApiErrorMock.mockReset();
});

describe('RulesEditor', () => {
  it('shows an empty-state hint with no rules', () => {
    renderWithQuery(<RulesEditor value={[]} onChange={() => undefined} />);
    expect(screen.getByText(en.rulesEmptyHint)).toBeInTheDocument();
  });

  it('adds a transform rule and a filter rule', async () => {
    const user = userEvent.setup();
    const emitted: RuleSpec[][] = [];
    renderWithQuery(<ControlledRules onEmit={(r) => emitted.push(r)} />);

    await user.click(screen.getByRole('button', { name: en.rulesAddTransform }));
    await user.click(screen.getByRole('button', { name: en.rulesAddFilter }));

    // The latest emit prunes empty-field rules — but the in-progress rows render.
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText(en.ruleTypeTransform)).toBeInTheDocument();
    expect(screen.getByText(en.ruleTypeFilter)).toBeInTheDocument();
  });

  it('removes a rule', async () => {
    const user = userEvent.setup();
    const initial: RuleSpec[] = [
      { type: 'transform', op: 'default', field: 'status', args: ['active'] },
      { type: 'filter', op: 'eq', field: 'dept', args: ['legal'] },
    ];
    renderWithQuery(<ControlledRules initial={initial} />);

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    const removeButtons = screen.getAllByRole('button', { name: en.rulesRemove });
    await user.click(removeButtons[0]);
    await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
  });

  it('reorders rules with the move-down control', async () => {
    const user = userEvent.setup();
    const initial: RuleSpec[] = [
      { type: 'transform', op: 'default', field: 'aaa', args: ['x'] },
      { type: 'filter', op: 'eq', field: 'bbb', args: ['y'] },
    ];
    let latest: RuleSpec[] = initial;
    renderWithQuery(<ControlledRules initial={initial} onEmit={(r) => (latest = r)} />);

    await user.click(screen.getAllByRole('button', { name: en.rulesMoveDown })[0]);
    await waitFor(() => expect(latest[0].field).toBe('bbb'));
  });

  it('runs the preview dry-run when an endpoint id is present and toasts on error', async () => {
    previewSyncMock.mockRejectedValueOnce(new Error('nope'));
    const user = userEvent.setup();
    renderWithQuery(<RulesEditor value={[]} endpointId="ep-1" onChange={() => undefined} />);

    await user.click(screen.getByRole('button', { name: new RegExp(en.rulesPreview, 'i') }));
    await waitFor(() => expect(showApiErrorMock).toHaveBeenCalledTimes(1));
  });

  it('renders the Arabic surface under the ar locale', () => {
    const { container } = renderWithQuery(
      <div dir="rtl">
        <RulesEditor value={[]} onChange={() => undefined} />
      </div>,
      { locale: 'ar' },
    );
    expect(screen.getByText(extensibilityLabels.ar.rulesEmptyHint)).toBeInTheDocument();
    expect(container.querySelector('[dir="rtl"]')).not.toBeNull();
  });
});
