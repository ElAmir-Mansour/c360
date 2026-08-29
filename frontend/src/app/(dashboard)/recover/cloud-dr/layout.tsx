import type { ReactNode } from 'react';
import { RecoverServerGuard } from '../_components/recover-server-guard';
import DRConsoleLayout from '../../dr/layout';

/**
 * Cloud Disaster Recovery workspace layout.
 *
 * SERVER-SIDE entitlement guard (`recover.cloud_dr`) wrapping the shared DR
 * console chrome. The Cloud DR workspace composes the existing DR cloud-recovery
 * capabilities (IaC DR, VM capture, boot-graph sequencing, failover/failback),
 * so it reuses the DR console layout rather than forking it. The full composed
 * workspace is owned by Prompt 5; this prompt establishes the guarded route.
 */
export default function RecoverCloudDRLayout({ children }: { children: ReactNode }) {
  return (
    <RecoverServerGuard slug="cloud-dr">
      <DRConsoleLayout>{children}</DRConsoleLayout>
    </RecoverServerGuard>
  );
}
