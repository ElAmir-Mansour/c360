'use client';

import { WidgetBoard } from '@/components/dashboard/widget-board';
import { DashboardTour } from '@/components/shared/tour';
import { DashboardLandingGate } from './_components/dashboard-landing-gate';

/**
 * Dashboard home — now a customizable widget board.
 *
 * The board wraps the existing dashboard widgets (critical-alerts banner,
 * hero, suites launcher, onboarding checklist, KPI cards, metrics strip,
 * recent alerts, my tasks, activity timeline) in a widget registry rendered
 * through react-grid-layout. Users can enter customize mode to drag, resize,
 * add/remove widgets, or apply role/scope/time presets via a picker sheet.
 * Preferences persist per tenant user on the server with a local fast cache.
 *
 * Non-customizing users see the exact original composition: the board's
 * default path renders the same stacked sections (same token-driven staggered
 * reveal, same permission gating, same alerts+tasks 2-col row) that this page
 * rendered before the board existed. See `@/components/dashboard/widget-board`.
 */
export default function DashboardHome() {
  return (
    <DashboardLandingGate>
      {/* First-run spotlight tour for the suites hub. Invisible until it
          auto-offers once per browser profile (localStorage-gated) or is
          relaunched via the user menu's "Show tour". Kept outside the board:
          it is a page overlay, not a dashboard widget. */}
      <DashboardTour />
      <WidgetBoard />
    </DashboardLandingGate>
  );
}
