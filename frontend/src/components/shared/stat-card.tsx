import * as React from "react";
import { type LucideIcon } from "lucide-react";
import { StatTile, type StatTileTone } from "@/components/shared/stat-tile";

/**
 * @deprecated Use `StatTile` from `@/components/shared/stat-tile` — the
 * canonical KPI primitive. `<StatCard>` remains as a thin adapter that maps
 * the Stream-E tone vocabulary onto the canonical semantic tones.
 */

/** Stream-E tonal accent vocabulary (kept for the 60+ existing consumers). */
// `teal` = the canonical WatheeqTech brand primary (#005E5E via kpi-theme-primary).
// Added so brand/neutral cards can be brand-teal without borrowing the off-brand
// blue `sky` tone. `sky` is retained unchanged for suites (cyber/dr) that use it.
export type StatTone = "neutral" | "emerald" | "gold" | "sky" | "rose" | "slate" | "teal";

/**
 * Bridge a Stream-E tone onto an existing `.kpi-theme-*` palette in
 * globals.css. Kept exported — several suites consume this map directly to
 * theme their own `.kpi-card-themed` surfaces.
 */
export const TONE_THEME_CLASS: Record<StatTone, string> = {
  neutral: "",
  emerald: "kpi-theme-emerald",
  gold: "kpi-theme-amber",
  sky: "kpi-theme-sky",
  rose: "kpi-theme-red",
  slate: "kpi-theme-primary",
  teal: "kpi-theme-primary",
};

/** Stream-E tone → canonical StatTile tone. */
const TONE_TO_TILE: Record<StatTone, StatTileTone> = {
  neutral: "neutral",
  emerald: "success",
  gold: "warning",
  sky: "info",
  rose: "danger",
  slate: "primary",
  teal: "primary",
};

interface StatCardProps {
  label: string;
  value: string | number;
  /** Optional tonal accent. Defaults to `neutral`. */
  tone?: StatTone;
  /** Optional leading icon, rendered in a tonal chip when a tone is set. */
  icon?: LucideIcon;
  /** Optional change %. Positive renders up, negative down, 0 flat. */
  change?: number;
  /** Optional supporting copy under the change pill. */
  changeLabel?: string;
  className?: string;
}

/** @deprecated Thin adapter over the canonical `StatTile`. */
export function StatCard({
  label,
  value,
  tone = "neutral",
  icon,
  change,
  changeLabel,
  className,
}: StatCardProps) {
  return (
    <StatTile
      size="md"
      label={label}
      value={value}
      icon={icon}
      tone={TONE_TO_TILE[tone]}
      delta={
        change !== undefined
          ? { value: change, label: changeLabel, percent: true }
          : undefined
      }
      className={className}
    />
  );
}
