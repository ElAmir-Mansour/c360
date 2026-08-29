import { describe, expect, it, vi } from 'vitest';
import {
  buildDRCommands,
  activeRunHref,
  DR_NAV_ROUTES,
  resolveDRCommandLabels,
} from './dr-commands';
import type { DRCommandIntent } from './dr-command-intents';

/**
 * Unit tests for the DR command builder.
 *
 * Asserts that: navigation commands are always present; the active-run command
 * appears only when a run is live; write actions are present only with
 * `dr:write` (hidden, not disabled, without it); and the action `run` callbacks
 * raise the real intents / navigate.
 */

function build(overrides: {
  canWrite?: boolean;
  activeRunId?: string | null;
  requestIntent?: (intent: DRCommandIntent) => void;
  navigate?: (href: string) => void;
}) {
  return buildDRCommands({
    labels: resolveDRCommandLabels('en'),
    canWrite: overrides.canWrite ?? false,
    activeRunId: overrides.activeRunId ?? null,
    requestIntent: overrides.requestIntent ?? vi.fn(),
    navigate: overrides.navigate ?? vi.fn(),
  });
}

describe('buildDRCommands', () => {
  it('always contributes every console navigation route', () => {
    const commands = build({});
    const hrefs = commands.filter((c) => c.href).map((c) => c.href);

    for (const route of DR_NAV_ROUTES) {
      expect(hrefs).toContain(route.href);
    }
    // Recover lifecycle pages use canonical Recover routes; deep operational
    // routes that still exist under /dr stay under /dr.
    expect(hrefs).toContain('/recover/it-dr/recover');
    expect(hrefs).toContain('/recover/it-dr/prove/ledger');
    expect(hrefs).toContain('/recover/it-dr/prove/compliance');
    expect(hrefs).toContain('/dr/approvals');
  });

  it('omits the active-run command when no run is live', () => {
    const commands = build({ activeRunId: null });
    expect(commands.some((c) => c.id === 'dr-nav-active-run')).toBe(false);
  });

  it('adds an active-run deep link only when a run is live', () => {
    const commands = build({ activeRunId: 'run-77' });
    const activeRun = commands.find((c) => c.id === 'dr-nav-active-run');
    expect(activeRun).toBeDefined();
    expect(activeRun?.href).toBe(activeRunHref('run-77'));
    expect(activeRun?.href).toBe('/dr/runs/run-77');
  });

  it('hides every write action when dr:write is absent', () => {
    const commands = build({ canWrite: false });
    expect(commands.some((c) => c.id.startsWith('dr-action-'))).toBe(false);
    expect(commands.every((c) => typeof c.run === 'undefined')).toBe(true);
  });

  it('contributes the four write actions when dr:write is granted', () => {
    const commands = build({ canWrite: true });
    const actionIds = commands.filter((c) => c.run).map((c) => c.id);
    expect(actionIds).toEqual(
      expect.arrayContaining([
        'dr-action-declare-failover',
        'dr-action-rehearse',
        'dr-action-seal-point',
        'dr-action-anchor-ledger',
      ]),
    );
  });

  it('routes to the overview and raises the failover intent on declare', () => {
    const requestIntent = vi.fn();
    const navigate = vi.fn();
    const commands = build({ canWrite: true, requestIntent, navigate });

    commands.find((c) => c.id === 'dr-action-declare-failover')?.run?.();

    expect(navigate).toHaveBeenCalledWith('/dr');
    expect(requestIntent).toHaveBeenCalledWith('declare-failover');
  });

  it('raises the matching intent for each non-failover write action', () => {
    const requestIntent = vi.fn();
    const commands = build({ canWrite: true, requestIntent });

    commands.find((c) => c.id === 'dr-action-rehearse')?.run?.();
    commands.find((c) => c.id === 'dr-action-seal-point')?.run?.();
    commands.find((c) => c.id === 'dr-action-anchor-ledger')?.run?.();

    expect(requestIntent).toHaveBeenCalledWith('rehearse');
    expect(requestIntent).toHaveBeenCalledWith('seal-recovery-point');
    expect(requestIntent).toHaveBeenCalledWith('anchor-ledger');
  });

  it('resolves Arabic palette copy while keeping route ids stable (ar)', () => {
    const commands = buildDRCommands({
      labels: resolveDRCommandLabels('ar'),
      canWrite: true,
      activeRunId: 'run-77',
      requestIntent: vi.fn(),
      navigate: vi.fn(),
    });

    // Route ids/hrefs are locale-independent…
    const overview = commands.find((c) => c.id === 'dr-nav-overview');
    expect(overview?.href).toBe('/dr');
    // …but the user-facing labels + section are professional MSA.
    expect(overview?.label).toBe('الاسترداد · نظرة عامة');
    expect(overview?.section).toBe('وحدة التحكّم بالاسترداد');
    expect(
      commands.find((c) => c.id === 'dr-action-declare-failover')?.label,
    ).toBe('إعلان تجاوز الفشل');
    // The English default differs, proving locale actually drives the copy.
    expect(resolveDRCommandLabels('en').actions.declareFailover).toBe('Declare failover');
  });
});
