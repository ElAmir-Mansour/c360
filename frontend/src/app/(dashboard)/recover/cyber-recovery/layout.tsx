import type { ReactNode } from 'react';
import { RecoverServerGuard } from '../_components/recover-server-guard';
import DRConsoleLayout from '../../dr/layout';

/**
 * Cyber Recovery workspace layout.
 *
 * SERVER-SIDE entitlement guard (`recover.cyber_recovery`) wrapping the shared
 * DR console chrome. The Cyber Recovery workspace composes the existing DR
 * cyber-recovery capabilities (clean room, cyber vault, ransomware detection,
 * clean points, immutable proof), so it reuses the DR console layout rather than
 * forking it. The clean-room recovery flow with the mandatory integrity gate is
 * owned by Prompt 6; this prompt establishes the guarded route.
 */
export default function RecoverCyberRecoveryLayout({ children }: { children: ReactNode }) {
  return (
    <RecoverServerGuard slug="cyber-recovery">
      <DRConsoleLayout>{children}</DRConsoleLayout>
    </RecoverServerGuard>
  );
}
