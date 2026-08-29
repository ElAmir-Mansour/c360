'use client';

import type { ReactNode } from 'react';
import { AuthProvider } from '@/components/providers/auth-provider';

// No session-expiry UI. The access token renews silently in AuthProvider for as
// long as the refresh cookie is valid, so there is no countdown to show and no
// "Extend" button to click. See lib/session-refresh.ts for why the old dialog
// was removed rather than fixed.
export function AuthRuntime({
  children,
  hydrateOnMount = true,
}: {
  children: ReactNode;
  hydrateOnMount?: boolean;
}) {
  return <AuthProvider hydrateOnMount={hydrateOnMount}>{children}</AuthProvider>;
}
