import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';

/**
 * Integration tests for the DR command registrar against the REAL global command
 * palette + store.
 *
 * Verifies: DR navigation commands appear in the palette; a write action command
 * is hidden without `dr:write` and present with it; selecting a nav command
 * routes; selecting a write action raises the real intent; and the `g d` chord
 * hotkey routes to the overview (while respecting input focus).
 */

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: pushMock,
    replace: vi.fn(),
    back: vi.fn(),
    prefetch: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/dr',
  useSearchParams: () => new URLSearchParams(''),
}));

const canWriteRef = { current: true };
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (perm: string) => (perm === 'dr:write' ? canWriteRef.current : true),
    user: { id: 'u1' },
  }),
}));

// The registrar reads the live run from useDRFailoverRuns(); default to none.
const failoverRunsRef: { current: unknown[] } = { current: [] };
vi.mock('@/app/(dashboard)/dr/_hooks/use-dr-queries', () => ({
  useDRFailoverRuns: () => ({ data: failoverRunsRef.current, isLoading: false }),
}));

import { DRCommandRegistrar } from './dr-command-registrar';
import { CommandPalette } from '@/components/layout/command-palette';
import { useCommandPaletteStore } from '@/stores/command-palette-store';
import { useDRCommandIntentStore } from '@/app/(dashboard)/dr/_lib/dr-command-intents';

function renderConsolePalette() {
  return renderWithQuery(
    <>
      <DRCommandRegistrar />
      <CommandPalette />
    </>,
  );
}

async function openPalette() {
  await act(async () => {
    useCommandPaletteStore.getState().setOpen(true);
  });
}

async function search(term: string) {
  await act(async () => {
    useCommandPaletteStore.getState().setQuery(term);
  });
}

const LIVE_RUN = {
  id: 'run-live-001',
  tenant_id: 't1',
  group_id: 'g1',
  mode: 'live',
  status: 'EXECUTING',
  recovery_point_id: 'rp-1',
  rto_objective_seconds: 900,
  initiated_by: 'u1',
  approved_by: 'u2',
  initiated_at: '2026-06-14T09:00:00Z',
  completed_at: null,
  rto_actual_seconds: null,
  last_error: null,
  claimed_at: null,
  updated_at: '2026-06-14T09:05:00Z',
};

beforeEach(() => {
  canWriteRef.current = true;
  failoverRunsRef.current = [];
  pushMock.mockClear();
  useCommandPaletteStore.setState({ open: false, query: '', commands: {} });
  useDRCommandIntentStore.setState({ intent: null, nonce: 0 });
});

afterEach(() => {
  cleanup();
});

describe('DRCommandRegistrar + command palette', () => {
  it('registers the DR navigation commands into the palette', async () => {
    renderConsolePalette();
    await openPalette();
    await search('overview');

    expect(screen.getByRole('option', { name: /DR · Overview/i })).toBeInTheDocument();
  });

  it('hides write action commands when dr:write is absent', async () => {
    canWriteRef.current = false;
    renderConsolePalette();
    await openPalette();
    await search('failover');

    expect(screen.queryByRole('option', { name: /^Declare failover$/i })).not.toBeInTheDocument();
  });

  it('shows write action commands when dr:write is granted', async () => {
    renderConsolePalette();
    await openPalette();
    await search('seal recovery point');

    expect(screen.getByRole('option', { name: /Seal recovery point/i })).toBeInTheDocument();
  });

  it('routes when a navigation command is selected', async () => {
    const user = userEvent.setup();
    renderConsolePalette();
    await openPalette();
    await search('protect');

    await user.click(screen.getByRole('option', { name: /DR · Protect/i }));

    expect(pushMock).toHaveBeenCalledWith('/dr/protect');
    // Selecting a command closes the palette.
    expect(useCommandPaletteStore.getState().open).toBe(false);
  });

  it('does not reopen when selection restores toward a focus-triggered launcher', async () => {
    const user = userEvent.setup();
    renderWithQuery(
      <>
        <input
          aria-label="Product search launcher"
          onFocus={() => useCommandPaletteStore.getState().setOpen(true)}
        />
        <DRCommandRegistrar />
        <CommandPalette />
      </>,
    );

    await user.click(screen.getByRole('textbox', { name: 'Product search launcher' }));
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());
    await search('protect');
    await user.click(screen.getByRole('option', { name: /DR · Protect/i }));

    expect(pushMock).toHaveBeenCalledWith('/dr/protect');
    expect(useCommandPaletteStore.getState().open).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('raises a write intent when an action command is selected', async () => {
    const user = userEvent.setup();
    renderConsolePalette();
    await openPalette();
    await search('anchor');

    await user.click(screen.getByRole('option', { name: /Anchor attestation ledger/i }));

    expect(useDRCommandIntentStore.getState().intent).toBe('anchor-ledger');
  });

  it('exposes the active-run deep link only while a run is live', async () => {
    failoverRunsRef.current = [LIVE_RUN];
    renderConsolePalette();
    await openPalette();
    await search('active recovery run');

    const button = screen.getByRole('option', { name: /Open active recovery run/i });
    expect(button).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(button);
    expect(pushMock).toHaveBeenCalledWith('/dr/runs/run-live-001');
  });

  it('routes to the overview on the "g d" chord hotkey', async () => {
    renderConsolePalette();

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
    });

    expect(pushMock).toHaveBeenCalledWith('/dr');
  });

  it('does not fire the chord hotkey while typing in an input', async () => {
    renderConsolePalette();
    await openPalette();

    const input = screen.getByRole('dialog').querySelector('input');
    expect(input).not.toBeNull();

    await act(async () => {
      input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true }));
      input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }));
    });

    expect(pushMock).not.toHaveBeenCalledWith('/dr');
  });
});
