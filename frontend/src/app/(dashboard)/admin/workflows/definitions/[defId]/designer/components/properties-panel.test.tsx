import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { WorkflowStep } from '@/types/models';
import { PropertiesPanel } from './properties-panel';

vi.mock('@/lib/api', () => ({
  apiGet: vi.fn().mockResolvedValue([]),
}));

describe('PropertiesPanel', () => {
  it('mounts the role-assigned human-step controls without a ref update loop', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const step: WorkflowStep = {
      id: 'human-step',
      name: 'Set Agenda & Statutory Invitation',
      type: 'task',
      config: { form_schema: [] },
      position: { x: 0, y: 0 },
      transitions: [],
      timeout_minutes: null,
      on_timeout: 'skip',
      assignee_strategy: { type: 'role', role_id: '' },
    };

    expect(() =>
      render(
        <QueryClientProvider client={queryClient}>
          <PropertiesPanel
            mode="step"
            step={step}
            onUpdate={vi.fn()}
            onRemove={vi.fn()}
            onClose={vi.fn()}
            readOnly={false}
          />
        </QueryClientProvider>,
      ),
    ).not.toThrow();

    expect(screen.getAllByRole('combobox')).toHaveLength(2);
  });
});
