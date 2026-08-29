import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { WorkflowDefinition } from '@/types/models';
import { WorkflowCanvas } from './workflow-canvas';

vi.mock('@xyflow/react', async () => {
  const React = await import('react');

  return {
    Background: () => null,
    BackgroundVariant: { Dots: 'dots' },
    Controls: () => null,
    MarkerType: { ArrowClosed: 'arrowclosed' },
    MiniMap: () => null,
    Panel: ({ children }: { children: ReactNode }) => <>{children}</>,
    ReactFlow: ({
      children,
      onSelectionChange,
    }: {
      children: ReactNode;
      onSelectionChange?: (selection: { nodes: never[]; edges: never[] }) => void;
    }) => {
      // React Flow's SelectionListener includes the callback in its effect
      // dependencies. This recreates the stale-empty-selection notification
      // that used to clear a step chosen from the lint panel.
      React.useEffect(() => {
        onSelectionChange?.({ nodes: [], edges: [] });
      }, [onSelectionChange]);

      return <div>{children}</div>;
    },
    ReactFlowProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
    useReactFlow: () => ({
      fitView: vi.fn(),
      screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x, y }),
    }),
  };
});

vi.mock('@/components/providers/locale-provider', () => ({
  useLocaleOrDefault: () => ({ locale: 'en', direction: 'ltr' }),
}));

vi.mock('./rf-step-node', () => ({
  RfStepNode: () => null,
  STEP_TYPE_KEYS: ['task'],
}));

vi.mock('./step-palette', () => ({
  StepPalette: () => null,
}));

vi.mock('./properties-panel', () => ({
  PropertiesPanel: ({ mode }: { mode: string }) => (
    <aside data-testid={`${mode}-properties-panel`} />
  ),
}));

describe('WorkflowCanvas selection', () => {
  it('keeps a step selected when it is opened from a lint warning', () => {
    const definition = {
      id: 'workflow-1',
      name: 'AGM workflow',
      description: '',
      status: 'draft',
      version: 1,
      trigger_config: { type: 'manual' },
      variables: {},
      steps: [
        {
          id: 'set-agenda',
          name: 'Set Agenda & Statutory Invitation',
          type: 'human_task',
          config: {},
          position: { x: 0, y: 0 },
          transitions: [],
          assignee_strategy: { type: 'role', role_id: '' },
        },
      ],
      created_by: 'admin',
      created_at: '2026-07-13T00:00:00Z',
      updated_at: '2026-07-13T00:00:00Z',
    } as unknown as WorkflowDefinition;

    render(
      <WorkflowCanvas
        definition={definition}
        readOnly={false}
        isSaving={false}
        isPublishing={false}
        onSave={vi.fn()}
        onPublish={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /warnings/i }));
    fireEvent.click(
      screen.getByRole('button', {
        name: /Set Agenda & Statutory Invitation: Human step has no assignee role configured/i,
      }),
    );

    expect(screen.getByTestId('step-properties-panel')).toBeInTheDocument();
  });
});
