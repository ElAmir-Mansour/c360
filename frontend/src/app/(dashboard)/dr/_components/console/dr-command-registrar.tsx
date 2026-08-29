'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import type { DRFailoverRun } from '@/types/clario-dr';
import { useAuth } from '@/hooks/use-auth';
import { useCommandPaletteStore } from '@/stores/command-palette-store';
import { useDRFailoverRuns } from '../../_hooks/use-dr-queries';
import { isRunLive } from '../../_hooks/use-dr-realtime';
import { useDRCommandIntentStore } from '../../_lib/dr-command-intents';
import { buildDRCommands, activeRunHref, useDRCommandLabels } from '../../_lib/dr-commands';

/**
 * Registers the `/dr` console's commands into the global command palette and
 * wires the DR power-operator hotkeys. Mounted once in the console layout so the
 * commands are available from any `/dr` route (and torn down when the operator
 * leaves the console).
 *
 * Renders nothing. Write-action commands are contributed only when the operator
 * holds `dr:write` (so they are hidden, not just disabled, without it); each
 * raises a real intent fulfilled by the always-mounted `DRCommandBar`.
 */

const WRITE_PERMISSION = 'dr:write';

/** The most recently-initiated in-flight failover run, or `null` when none. */
function selectLiveRun(runs: DRFailoverRun[] | undefined | null): DRFailoverRun | null {
  if (!runs || runs.length === 0) return null;
  let latest: DRFailoverRun | null = null;
  let latestMs = -Infinity;
  for (const run of runs) {
    if (!isRunLive(run.status)) continue;
    const ms = Date.parse(run.initiated_at);
    const ordinal = Number.isNaN(ms) ? 0 : ms;
    if (ordinal >= latestMs) {
      latest = run;
      latestMs = ordinal;
    }
  }
  return latest;
}

export function DRCommandRegistrar() {
  const { hasPermission } = useAuth();
  const canWrite = hasPermission(WRITE_PERMISSION);
  const router = useRouter();

  const registerCommands = useCommandPaletteStore((s) => s.registerCommands);
  const requestIntent = useDRCommandIntentStore((s) => s.requestIntent);
  const labels = useDRCommandLabels();

  const failoverRunsQuery = useDRFailoverRuns();
  const activeRun = useMemo(
    () => selectLiveRun(failoverRunsQuery.data),
    [failoverRunsQuery.data],
  );
  const activeRunId = activeRun?.id ?? null;

  const commands = useMemo(
    () =>
      buildDRCommands({
        labels,
        canWrite,
        activeRunId,
        requestIntent,
        navigate: (href) => router.push(href),
      }),
    [labels, canWrite, activeRunId, requestIntent, router],
  );

  useEffect(() => registerCommands(commands), [registerCommands, commands]);

  useDRHotkeys({ router, activeRunId });

  return null;
}

interface UseDRHotkeysArgs {
  router: ReturnType<typeof useRouter>;
  activeRunId: string | null;
}

/**
 * Power-operator chord hotkeys for the DR console:
 *   - `g` then `d` → DR overview
 *   - `g` then `r` → open the active recovery run (when one is live)
 *
 * The chord window is short (1s) and the leader resets on any non-matching key.
 * Hotkeys never fire while the operator is typing in a field/contenteditable,
 * and the global palette open shortcut (Cmd/Ctrl+K) is intentionally left to its
 * own listener — this effect ignores any event carrying a platform modifier.
 */
function useDRHotkeys({ router, activeRunId }: UseDRHotkeysArgs): void {
  useEffect(() => {
    const CHORD_WINDOW_MS = 1_000;
    let leaderActive = false;
    let leaderTimer: ReturnType<typeof setTimeout> | null = null;

    const clearLeader = () => {
      leaderActive = false;
      if (leaderTimer) {
        clearTimeout(leaderTimer);
        leaderTimer = null;
      }
    };

    const isTypingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      return target.isContentEditable;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      const key = event.key.toLowerCase();

      if (!leaderActive) {
        if (key === 'g') {
          leaderActive = true;
          leaderTimer = setTimeout(clearLeader, CHORD_WINDOW_MS);
        }
        return;
      }

      // A leader is active: resolve the chord (then always reset).
      if (key === 'd') {
        event.preventDefault();
        router.push('/dr');
      } else if (key === 'r' && activeRunId) {
        event.preventDefault();
        router.push(activeRunHref(activeRunId));
      }
      clearLeader();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      clearLeader();
    };
  }, [router, activeRunId]);
}
