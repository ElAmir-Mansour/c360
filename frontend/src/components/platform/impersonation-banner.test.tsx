import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ImpersonationBanner } from './impersonation-banner';
import { useImpersonationStore } from '@/stores/impersonation-store';

// Banner ends the session via useStopImpersonation() (which POSTs the stop audit
// then clears the store + invalidates queries). We don't need a live backend or
// QueryClient here — mock the hook to a spy so we can assert the Stop control
// wires to it.
const stopSpy = vi.fn(async () => undefined);
vi.mock('@/hooks/use-platform', () => ({
  useStopImpersonation: () => stopSpy,
}));

// Translate i18n keys to readable, assertable strings ({tenant} stays for the
// component's own .replace()).
vi.mock('@/components/providers/locale-provider', () => ({
  useT: () => (key: string) => {
    const map: Record<string, string> = {
      'platformConsole.impersonation.viewingAs': 'Viewing as {tenant}',
      'platformConsole.impersonation.readOnly': 'Read only',
      'platformConsole.impersonation.expiresIn': 'Expires in',
      'platformConsole.impersonation.stop': 'Stop',
    };
    return map[key] ?? key;
  },
}));

function resetStore() {
  useImpersonationStore.setState({
    token: null,
    tenantId: null,
    tenantName: null,
    userId: null,
    expiresAt: null,
    active: false,
  });
}

function activate(overrides: Record<string, unknown> = {}) {
  useImpersonationStore.setState({
    active: true,
    token: 'imp-token',
    tenantId: 'tenant-1',
    tenantName: 'Acme Corp',
    userId: 'user-9',
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    ...overrides,
  });
}

describe('ImpersonationBanner', () => {
  beforeEach(() => {
    stopSpy.mockClear();
    resetStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders nothing when no impersonation is active', () => {
    const { container } = render(<ImpersonationBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the tenant name and a read-only badge while active', () => {
    activate();
    render(<ImpersonationBanner />);

    expect(screen.getByText('Viewing as Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Read only')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('falls back to the tenant id when no tenant name is set', () => {
    activate({ tenantName: null });
    render(<ImpersonationBanner />);
    expect(screen.getByText('Viewing as tenant-1')).toBeInTheDocument();
  });

  it('calls stop when the Stop control is clicked', async () => {
    const user = userEvent.setup();
    activate();
    render(<ImpersonationBanner />);

    await user.click(screen.getByRole('button', { name: /stop/i }));

    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it('auto-stops the session once the hard TTL is reached', () => {
    vi.useFakeTimers();
    activate({ expiresAt: new Date(Date.now() + 1000).toISOString() });

    render(<ImpersonationBanner />);
    // Initial tick: still within TTL, no stop yet.
    expect(stopSpy).not.toHaveBeenCalled();

    // Advance past expiry; the 1s interval tick fires stopImpersonation().
    vi.advanceTimersByTime(2000);
    expect(stopSpy).toHaveBeenCalled();
  });
});
