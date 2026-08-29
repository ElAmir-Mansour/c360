import type { ReactNode } from 'react';
import { RecoverServerGuard } from '../_components/recover-server-guard';
import DRConsoleLayout from '../../dr/layout';

/**
 * IT Disaster Recovery workspace layout.
 *
 * Two layers, in order:
 *  1. SERVER-SIDE entitlement guard (`recover.it_dr`) — rejects unentitled
 *     tenants before any workspace renders.
 *  2. The shared DR console chrome (`DRConsoleLayout`) — the IT DR workspace
 *     composes the existing DR capabilities, so it reuses the DR console's
 *     posture banner, command bar, copilot launcher and the single console-wide
 *     realtime registration. We do NOT fork that chrome; we mount it here so the
 *     re-exported `dr/*` pages behave identically under their new Recover route.
 */
export default function RecoverITDRLayout({ children }: { children: ReactNode }) {
  return (
    <RecoverServerGuard slug="it-dr">
      <DRConsoleLayout>{children}</DRConsoleLayout>
    </RecoverServerGuard>
  );
}
