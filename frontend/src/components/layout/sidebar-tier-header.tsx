'use client';

import { cn } from '@/lib/utils';

interface SidebarTierHeaderProps {
  /** Localized tier name (e.g. "AI Services"). */
  label: string;
  /** Collapsed rail renders a compact leaf marker instead of the full header. */
  collapsed: boolean;
  /** First tier group after the lead block — trims its leading spacing. */
  first?: boolean;
}

/**
 * Platform-architecture tier header for the deep-teal sidebar rail. Sits ABOVE
 * the section headers to group the sidebar into the five brand tiers (AI
 * Services, DataStream, Business+, Platform Core, Infrastructure).
 *
 * Palette: a small leaf-green (`--ds-accent`) marker ties the header to the deck
 * accent, paired with a quiet muted-white uppercase label that stays legible on
 * the teal rail (AA) without competing with the active-item accent. The label is
 * `aria-hidden` because the surrounding tier group already carries it as its
 * `aria-label`, so screen readers announce the tier exactly once.
 *
 * The rail is always dark (teal in light AND dark themes), so the tokens here
 * hold in both — `--sidebar-muted` and `--ds-accent` are theme-stable on teal.
 */
export function SidebarTierHeader({ label, collapsed, first = false }: SidebarTierHeaderProps) {
  if (collapsed) {
    // Collapsed rail: a centred leaf dot marks a new tier — distinct from the
    // full-width hairline the section headers render, so tiers stay legible when
    // only icons show. Tooltips on each row carry the real labels.
    return (
      <div
        className={cn('flex items-center justify-center', first ? 'pb-1.5' : 'py-2')}
        aria-hidden="true"
      >
        <span className="h-1 w-1 rounded-full bg-brand-accent/70" />
      </div>
    );
  }

  return (
    <div className={cn('sidebar-tier-header flex items-center gap-2 px-3 pb-1.5', first ? 'pt-0.5' : 'pt-3')}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-accent" aria-hidden="true" />
      <span
        aria-hidden="true"
        className="text-overline font-semibold uppercase tracking-caps-xwide text-[color:var(--sidebar-muted)] rtl:tracking-[0.08em]"
      >
        {label}
      </span>
      <span className="h-px flex-1 bg-white/10" aria-hidden="true" />
    </div>
  );
}
