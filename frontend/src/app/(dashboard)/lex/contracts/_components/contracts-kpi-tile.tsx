'use client';

import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { StatTile } from '@/components/shared/stat-tile';
import { cn } from '@/lib/utils';

export type ContractKpiTheme = 'teal' | 'emerald' | 'gold' | 'rose';

const CONTRACT_KPI_THEME_CLASS: Record<ContractKpiTheme, string> = {
  teal: 'kpi-theme-primary',
  emerald: 'kpi-theme-emerald',
  gold: 'kpi-theme-amber',
  rose: 'kpi-theme-red',
};

interface ContractKpiTileBaseProps {
  title: string;
  value: ReactNode;
  theme: ContractKpiTheme;
  icon: LucideIcon;
  progress?: number;
  progressLabel?: string;
  detail?: string;
  detailValue?: ReactNode;
  loading?: boolean;
  error?: boolean;
  active?: boolean;
  children?: ReactNode;
  className?: string;
}

export type ContractKpiTileProps = ContractKpiTileBaseProps &
  (
    | { href: string; onClick?: never }
    | { href?: never; onClick: () => void }
  );

/**
 * Compact contracts-register KPI. The shared StatTile supplies semantics,
 * loading/error states, RTL-safe values, progress and footer metrics; this
 * wrapper only applies the quieter contracts-specific treatment and optional
 * filter-button behaviour.
 */
export function ContractKpiTile({
  title,
  value,
  theme,
  icon,
  progress,
  progressLabel,
  detail,
  detailValue,
  loading = false,
  error = false,
  active = false,
  href,
  onClick,
  children,
  className,
}: ContractKpiTileProps) {
  return (
    <StatTile
      label={title}
      value={value}
      themeClass={CONTRACT_KPI_THEME_CLASS[theme]}
      icon={icon}
      progress={progress}
      progressLabel={progressLabel}
      detail={detail}
      detailValue={detailValue}
      loading={loading}
      error={error}
      spark={children}
      size="md"
      appearance="operational"
      href={href}
      onAction={onClick}
      pressed={active}
      className={cn(
        'contract-kpi-card',
        active && onClick && 'ring-2 ring-primary/70',
        className,
      )}
    />
  );
}
