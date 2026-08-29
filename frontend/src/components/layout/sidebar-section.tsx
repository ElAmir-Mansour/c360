'use client';

import { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SidebarSectionProps {
  label: string;
  collapsed: boolean;
  children: React.ReactNode;
  /**
   * Number of visible items in this section. When provided, a small count chip
   * is rendered beside the section label. Purely presentational — additive,
   * defaults to hidden when undefined.
   */
  count?: number;
  /**
   * Progressive disclosure (desktop sidebar): when `onToggle` is provided the
   * section header becomes a disclosure button and the item list renders only
   * while `expanded`. When omitted (mobile sidebar, legacy callers) the section
   * renders exactly as before — a static labelled group.
   */
  expanded?: boolean;
  onToggle?: () => void;
}

export function SidebarSection({
  label,
  collapsed,
  children,
  count,
  expanded = true,
  onToggle,
}: SidebarSectionProps) {
  const listId = useId();
  const disclosable = onToggle !== undefined && Boolean(label) && !collapsed;
  const isOpen = disclosable ? expanded : true;

  const countChip =
    count !== undefined && count > 0 ? (
      <span className="flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-white/10 px-1 text-overline font-medium tabular-nums text-[color:var(--sidebar-muted)]">
        {count}
      </span>
    ) : null;

  return (
    <div role="group" aria-label={label || 'Navigation'} className="mb-3">
      {label && !collapsed && (
        disclosable ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={isOpen}
            aria-controls={listId}
            className="sidebar-section-trigger group/section mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-1 text-start transition-[background-color,box-shadow] hover:bg-[var(--sidebar-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 motion-reduce:transition-none"
          >
            <p className="flex-1 truncate text-xs font-medium text-[color:var(--sidebar-muted)] transition-colors group-hover/section:text-white/80">
              {label}
            </p>
            {countChip}
            <ChevronDown
              aria-hidden="true"
              className={cn(
                'h-3.5 w-3.5 shrink-0 text-white/40 transition-transform duration-200 ease-spring motion-reduce:transition-none group-hover/section:text-white/70',
                isOpen ? 'rotate-0' : 'ltr:-rotate-90 rtl:rotate-90',
              )}
            />
          </button>
        ) : (
          <div className="mb-1 flex items-center gap-2 px-3">
            <p className="flex-1 truncate text-xs font-medium text-[color:var(--sidebar-muted)]">
              {label}
            </p>
            {countChip}
          </div>
        )
      )}
      {label && collapsed && <div className="mx-3 mb-1.5 h-px bg-white/10" />}
      {isOpen && (
        <div id={listId} className={cn('space-y-0.5')}>
          {children}
        </div>
      )}
    </div>
  );
}
