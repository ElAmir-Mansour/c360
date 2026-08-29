import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useNotificationStore } from '@/stores/notification-store';
import { ConnectionBanner } from './connection-banner';

describe('ConnectionBanner', () => {
  beforeEach(() => {
    sessionStorage.clear();
    useNotificationStore.setState({
      connectionStatus: 'disconnected',
      reconnectAttempt: 0,
      nextRetryAt: null,
    });
  });

  it('does not announce a recovery during the initial socket connection', () => {
    render(<ConnectionBanner />);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    act(() => {
      useNotificationStore.setState({ connectionStatus: 'connected' });
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('announces a recovery after an established connection is interrupted', () => {
    render(<ConnectionBanner />);

    act(() => {
      useNotificationStore.setState({ connectionStatus: 'connected' });
    });
    act(() => {
      useNotificationStore.setState({ connectionStatus: 'reconnecting' });
    });
    act(() => {
      useNotificationStore.setState({ connectionStatus: 'connected' });
    });

    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
