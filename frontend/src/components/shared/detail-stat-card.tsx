import * as React from "react";
import { type LucideIcon } from "lucide-react";
import {
  StatTile,
  type StatTileAppearance,
  type StatTileTone,
} from "@/components/shared/stat-tile";
import type { StatTone } from "@/components/shared/stat-card";
import { cn } from "@/lib/utils";

/**
 * @deprecated Use `StatTile` from `@/components/shared/stat-tile` — the
 * canonical KPI primitive. `<DetailStatCard>` remains as a thin adapter for
 * the detail-page "brief" tiles (label over value + helper + trailing badge).
 */

const TONE_TO_TILE: Record<StatTone, StatTileTone> = {
  neutral: "neutral",
  emerald: "success",
  gold: "warning",
  sky: "info",
  rose: "danger",
  slate: "primary",
  teal: "primary",
};

export interface DetailStatCardProps {
  /** Short caption above the value. */
  label: string;
  /** The primary value (string, number, or rich node such as a chip). */
  value: React.ReactNode;
  /** Optional semantic tonal accent. Defaults to `"neutral"`. */
  tone?: StatTone;
  /** Optional leading icon, rendered in a tonal chip. */
  icon?: LucideIcon;
  /** Optional trailing element (e.g. a severity indicator or status chip). */
  badge?: React.ReactNode;
  /** Optional supporting copy under the value (xs, muted). */
  helper?: string;
  /** Navigates the whole card to the supporting record or breakdown. */
  href?: string;
  /** Makes the whole card an accessible drill-down button. */
  onAction?: () => void;
  /** Optional toggle state announced by an actionable card. */
  pressed?: boolean;
  /** Flat compact detail treatment by default; `default` keeps legacy material. */
  appearance?: StatTileAppearance;
  className?: string;
}

/** @deprecated Thin adapter over the canonical `StatTile`. */
export function DetailStatCard({
  label,
  value,
  tone = "neutral",
  icon,
  badge,
  helper,
  href,
  onAction,
  pressed,
  appearance = "operational",
  className,
}: DetailStatCardProps) {
  return (
    <StatTile
      size="md"
      appearance={appearance}
      label={label}
      value={value}
      tone={TONE_TO_TILE[tone]}
      icon={icon}
      badge={badge}
      helper={helper}
      href={href}
      onAction={onAction}
      pressed={pressed}
      className={cn(appearance === "operational" && "min-h-32", className)}
    />
  );
}
