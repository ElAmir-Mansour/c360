'use client';

import { useMemo, type ReactNode } from 'react';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { DRPostureBanner } from './_components/console/dr-posture-banner';
import { DRCommandBar } from './_components/console/dr-command-bar';
import { DRCommandRegistrar } from './_components/console/dr-command-registrar';
import { DRCopilotLauncher } from './_components/copilot/dr-copilot-launcher';
import { useDRPosture } from './_hooks/use-dr-queries';
import { useDRRealtime } from './_hooks/use-dr-realtime';
import { useDRSelection } from './_lib/dr-selection';

/**
 * Recovery Operations Console route-group layout.
 *
 * Persists across every `/dr` route so the readiness banner and the primary
 * command bar are always mounted (and the failover/rehearse/runbook dialogs stay
 * reachable from anywhere in the console). The whole console is gated at
 * `dr:read`; individual write actions are additionally gated at `dr:write`
 * inside the command bar and the route pages.
 *
 * The single console-wide DR realtime registration also lives here (mounted once
 * per the `use-dr-realtime` contract): it registers the console's `['clario-dr',
 * …]` query keys against the DR WebSocket topics so failover runs, posture,
 * replication, predictions and ransomware signals invalidate the instant a DR
 * lifecycle/alert event arrives — without any per-route hook duplicating it. The
 * per-route polling fallbacks (e.g. the overview's 5s-while-live cadence) keep
 * liveness even where the WS topic is not delivered.
 */
export default function DRConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <PermissionRedirect permission="dr:read">
      <DRConsoleRealtime />
      {/* Registers the console's command-palette entries + power-operator
          hotkeys for the whole `/dr` route group. Renders nothing; the write
          actions it contributes are fulfilled by the always-mounted command
          bar below (single source of truth for every write flow). */}
      <DRCommandRegistrar />
      {/* Single primary IA: the lifecycle-grouped DR sidebar section is the one
          navigation for the console (paired with per-page breadcrumbs on drill-in
          routes). The former horizontal console tab-bar (`DRConsoleNav`) duplicated
          that sidebar, so it is no longer rendered here — every `/dr` route stays
          reachable from the grouped sidebar + breadcrumbs, and the posture banner +
          command bar remain the always-mounted console chrome. */}
      <div className="space-y-5">
        <DRPostureBanner />
        <DRCommandBar />
        <div className="space-y-6">{children}</div>
      </div>
      {/* Console-wide DR copilot: a floating launcher reachable from every /dr
          route. Mounted once here (not in the command bar) so it stays out of the
          toolbar's action flow and never collides with the readiness-route copilot
          panel. NOT registered into the command palette (Wave 5 owns that). */}
      <DRCopilotLauncher />
    </PermissionRedirect>
  );
}

/**
 * Mounts the console-wide DR realtime registration exactly once. Derives the
 * active group/stream from the shared URL-backed selection (so group/stream-
 * scoped keys are invalidated too) using the live posture group list for the
 * default-group fallback. Renders nothing.
 */
function DRConsoleRealtime() {
  const postureQuery = useDRPosture();
  const groups = useMemo(() => postureQuery.data?.groups ?? [], [postureQuery.data?.groups]);
  const { activeGroupId, activeStreamId } = useDRSelection({ groups });

  useDRRealtime({ activeGroupId, activeStreamId });

  return null;
}
