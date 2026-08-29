import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { DRProtectedSite, DRReplicationStream } from '@/types/clario-dr';
import { AddEdgeDialog } from './add-edge-dialog';

/**
 * Add-topology-edge dialog tests.
 *
 * Proves the dialog builds a REAL {@link DRTopologyAddEdgeRequest} from a
 * zod-valid form and calls `onAddEdge` with that exact payload (the role/mode
 * defaults — `source`/`target`/`async`, the real `internal/dr/topology` tokens —
 * ride along, and a supplied priority is coerced to a number), that an unselected
 * required site blocks submission (no `onAddEdge` call), and includes an Arabic /
 * RTL render asserting the MSA copy. `next/navigation` is globally mocked by the
 * test setup.
 */

const sites: DRProtectedSite[] = [
  {
    id: 'site-primary-1',
    tenant_id: 't1',
    name: 'Primary DC',
    kind: 'primary',
    primary_endpoint: 'pg://primary.internal:5432',
    rto_objective_seconds: 900,
    rpo_objective_seconds: 300,
    created_at: '2026-06-14T10:00:00Z',
    updated_at: '2026-06-14T10:00:00Z',
  },
  {
    id: 'site-recovery-2',
    tenant_id: 't1',
    name: 'Recovery DC',
    kind: 'recovery',
    primary_endpoint: 'pg://recovery.internal:5432',
    rto_objective_seconds: 900,
    rpo_objective_seconds: 300,
    created_at: '2026-06-14T10:00:00Z',
    updated_at: '2026-06-14T10:00:00Z',
  },
];

const streams: DRReplicationStream[] = [
  {
    id: 'stream-1',
    tenant_id: 't1',
    site_id: 'site-primary-1',
    status: 'streaming',
    applied_seq: 100,
    source_lsn: '0/16B3748',
    applied_at: '2026-06-14T10:00:00Z',
    last_error: null,
    created_at: '2026-06-14T10:00:00Z',
    updated_at: '2026-06-14T10:00:00Z',
  },
];

/** Pick an option from a Radix Select by its accessible (combobox) name. */
async function selectOption(
  user: ReturnType<typeof userEvent.setup>,
  triggerName: RegExp,
  optionName: string,
) {
  await user.click(screen.getByRole('combobox', { name: triggerName }));
  const listbox = await screen.findByRole('listbox');
  await user.click(within(listbox).getByRole('option', { name: optionName }));
}

describe('AddEdgeDialog', () => {
  it('calls onAddEdge with the zod-valid DRTopologyAddEdgeRequest payload', async () => {
    const user = userEvent.setup();
    const onAddEdge = vi.fn();

    renderWithQuery(
      <AddEdgeDialog
        open
        onOpenChange={vi.fn()}
        onAddEdge={onAddEdge}
        submitting={false}
        sites={sites}
        streams={streams}
      />,
    );

    await selectOption(user, /From site/i, 'Primary DC');
    await selectOption(user, /To site/i, 'Recovery DC');
    await selectOption(user, /Replication stream/i, 'stream-1');

    await user.type(screen.getByRole('spinbutton'), '5');

    await user.click(screen.getByRole('button', { name: 'Add edge' }));

    await waitFor(() => expect(onAddEdge).toHaveBeenCalledTimes(1));
    expect(onAddEdge).toHaveBeenCalledWith({
      from_site_id: 'site-primary-1',
      to_site_id: 'site-recovery-2',
      stream_id: 'stream-1',
      from_role: 'source',
      to_role: 'target',
      mode: 'async',
      priority: 5,
    });
  });

  it('blocks submission when a required site is not selected', async () => {
    const user = userEvent.setup();
    const onAddEdge = vi.fn();

    renderWithQuery(
      <AddEdgeDialog
        open
        onOpenChange={vi.fn()}
        onAddEdge={onAddEdge}
        submitting={false}
        sites={sites}
        streams={streams}
      />,
    );

    // Only the stream is chosen — both sites left empty, zod must reject.
    await selectOption(user, /Replication stream/i, 'stream-1');
    await user.click(screen.getByRole('button', { name: 'Add edge' }));

    expect(await screen.findAllByText('Select the source site')).not.toHaveLength(0);
    expect(onAddEdge).not.toHaveBeenCalled();
  });

  it('renders the full MSA Arabic surface for locale "ar" (RTL)', () => {
    renderWithQuery(
      <AddEdgeDialog
        open
        onOpenChange={vi.fn()}
        onAddEdge={vi.fn()}
        submitting={false}
        sites={sites}
        streams={streams}
      />,
      { locale: 'ar' },
    );

    expect(screen.getByText('إضافة رابط طوبولوجي')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'إلغاء' })).toBeInTheDocument();
    // Arabic role-option copy comes from the route-local bundle (backend tokens).
    expect(screen.getByText('من الموقع')).toBeInTheDocument();
  });
});
