"use client";

import { AlertTriangle, AlertCircle, Info, ArrowDown, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { severityVar, type SeverityLevel } from "@/lib/design-tokens";
import { useLocaleOrDefault } from "@/components/providers/locale-provider";

export type Severity =
  | "critical"
  | "high"
  | "warning"
  | "medium"
  | "low"
  | "info";

interface SeverityIndicatorProps {
  severity: Severity;
  showLabel?: boolean;
  showIcon?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * Per-severity presentation. Colour is driven entirely by the `--severity-*`
 * design tokens via `severityVar()` (resolved inline so it re-themes in dark
 * mode); the chrome (radius, faint elevation, motion) is shared. `warning` and
 * `medium` both map to the canonical `medium` token level.
 */
const severityConfig: Record<Severity, { label: string; labelAr: string; icon: LucideIcon; level: SeverityLevel }> = {
  critical: { label: "Critical", labelAr: "حرجة",   icon: AlertTriangle, level: "critical" },
  high:     { label: "High",     labelAr: "عالية",  icon: AlertCircle,   level: "high" },
  warning:  { label: "Warning",  labelAr: "تحذير",  icon: AlertCircle,   level: "medium" },
  medium:   { label: "Medium",   labelAr: "متوسطة", icon: Info,          level: "medium" },
  low:      { label: "Low",      labelAr: "منخفضة", icon: ArrowDown,     level: "low" },
  info:     { label: "Info",     labelAr: "معلومة", icon: Info,          level: "info" },
};

const sizeClasses = { sm: "text-overline px-1.5 py-0.5 gap-1", md: "text-caption px-2 py-0.5 gap-1.5", lg: "text-body-sm px-2.5 py-1 gap-2" };
const iconSizes = { sm: "h-3 w-3", md: "h-3.5 w-3.5", lg: "h-4 w-4" };

export function SeverityIndicator({
  severity,
  showLabel = true,
  showIcon = true,
  size = "md",
  className,
}: SeverityIndicatorProps) {
  const { locale } = useLocaleOrDefault();
  const config = severityConfig[severity] ?? severityConfig.info;
  const Icon = config.icon;
  const color = severityVar(config.level);
  const resolvedLabel = locale === "ar" ? config.labelAr : config.label;

  return (
    <span
      className={cn(
        // Label uses the theme-aware foreground (AA in light + dark) so the text
        // never fails contrast; severity is conveyed by the coloured icon + tint.
        "inline-flex items-center rounded-full border font-medium align-middle text-foreground shadow-elevation-1 outline-none",
        "transition-[color,background-color,border-color,box-shadow] duration-fast ease-standard",
        "hover:shadow-elevation-2",
        "focus-visible:shadow-[var(--ds-elevation-focus),var(--ds-elevation-1)]",
        "active:shadow-elevation-1",
        sizeClasses[size],
        className,
      )}
      style={{
        // Faint tint + matching hairline border, derived from the severity token.
        backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`,
        borderColor: `color-mix(in srgb, ${color} 30%, transparent)`,
      }}
    >
      {showIcon && (
        <Icon className={cn(iconSizes[size], "shrink-0")} style={{ color }} aria-hidden />
      )}
      {showLabel && resolvedLabel}
    </span>
  );
}
