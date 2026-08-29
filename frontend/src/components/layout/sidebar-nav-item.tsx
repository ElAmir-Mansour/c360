'use client';

import { memo, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { NavItem } from '@/config/navigation';
import { useNavigationLabels } from './navigation-labels';

interface SidebarNavItemProps {
  item: NavItem;
  collapsed: boolean;
  badgeCount?: number;
  /**
   * Pin/unpin support (desktop sidebar “Pinned” group). When provided, leaf
   * rows and child rows reveal a star affordance on hover/focus. Optional —
   * mobile surfaces omit it and render exactly as before.
   */
  isPinned?: (itemId: string) => boolean;
  onTogglePin?: (itemId: string) => void;
}

/** Hover/focus-revealed star that pins a nav row to the top “Pinned” group. */
function PinButton({
  pinned,
  label,
  onToggle,
}: {
  pinned: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      aria-pressed={pinned}
      className={cn(
        'absolute end-1 top-1/2 z-[1] flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md',
        'transition-[opacity,color,background-color] duration-200 ease-spring motion-reduce:transition-none',
        'hover:bg-white/10 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70',
        pinned
          ? 'text-brand-gold opacity-80 hover:text-brand-gold group-hover/row:opacity-100'
          : 'text-white/50 opacity-0 hover:text-brand-gold group-hover/row:opacity-100',
      )}
    >
      <Star className={cn('h-3.5 w-3.5', pinned && 'fill-current')} aria-hidden="true" />
    </button>
  );
}

export const SidebarNavItem = memo(function SidebarNavItem({
  item,
  collapsed,
  badgeCount,
  isPinned,
  onTogglePin,
}: SidebarNavItemProps) {
  const pathname = usePathname();
  const { direction } = useNavigationLabels();
  const currentPath = pathname ?? '';
  const isActive =
    item.href === '/dashboard'
      ? currentPath === '/dashboard'
      : currentPath.startsWith(item.href);

  const children = item.children ?? [];
  const hasChildren = children.length > 0;
  const childActive = hasChildren && children.some((c) => currentPath.startsWith(c.href));
  // Expand the group when the route is inside it; still allow manual toggling.
  const [open, setOpen] = useState(isActive || childActive);
  useEffect(() => {
    if (isActive || childActive) setOpen(true);
  }, [isActive, childActive]);

  const linkRef = useRef<HTMLAnchorElement>(null);

  // Auto-scroll the active nav item into view when the route changes so the
  // current location is always visible in a long, scrollable sidebar. Honors
  // prefers-reduced-motion: jumps instantly instead of smooth-scrolling.
  useEffect(() => {
    if (!isActive && !childActive) return;
    const el = linkRef.current;
    if (!el) return;
    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({
      block: 'nearest',
      behavior: prefersReduced ? 'auto' : 'smooth',
    });
  }, [isActive, childActive]);

  const Icon = item.icon;
  const showBadge = badgeCount !== undefined && badgeCount > 0;
  // Pin affordance only makes sense on rows that can live in the Pinned group:
  // leaves and child rows (whole expandable groups are not pinnable).
  const pinnable = !collapsed && onTogglePin !== undefined && !hasChildren;
  const pinLabel = (pinned: boolean, label: string) =>
    direction === 'rtl'
      ? pinned
        ? `إزالة تثبيت ${label}`
        : `تثبيت ${label} في الأعلى`
      : pinned
        ? `Unpin ${label}`
        : `Pin ${label} to top`;

  const linkBody = (
    <>
      <div className="relative flex shrink-0 items-center justify-center">
        <Icon
          className={cn(
            'h-4 w-4 duration-200 ease-spring motion-reduce:transition-none',
            isActive ? 'text-white' : '',
          )}
        />
        {collapsed && showBadge && (
          <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-rose-400 shadow-[0_0_0_3px_rgba(4,20,11,0.7)] rtl:-left-1 rtl:right-auto" />
        )}
      </div>
      {!collapsed && (
        <>
          <span className="flex-1 truncate tracking-[-0.01em]">{item.label}</span>
          {showBadge && item.badge && (
            <span
              className={cn(
                'ms-auto flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-overline font-semibold',
                item.badge.variant === 'destructive' && 'bg-rose-600 text-white',
                item.badge.variant === 'warning' && 'bg-brand-gold text-foreground',
                item.badge.variant === 'default' && (isActive ? 'bg-white/15 text-white' : 'bg-white/10 text-white/85'),
                // The pin star lands where the badge sits; fade the badge out
                // while the row is hovered so the two never overlap.
                pinnable &&
                  'transition-opacity duration-200 ease-spring group-hover/row:opacity-0 motion-reduce:transition-none',
              )}
            >
              {badgeCount}
            </span>
          )}
        </>
      )}
    </>
  );

  const content = (
    <Link
      ref={linkRef}
      href={item.href}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'sidebar-nav-link group relative flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium',
        'transition-[transform,background-color,color,box-shadow] duration-200 ease-spring motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70',
        collapsed ? 'justify-center px-2' : 'justify-start',
        // When the item has children, the chevron sits beside it; keep the link itself flex-1.
        hasChildren && !collapsed ? 'flex-1' : '',
        isActive
          ? 'sidebar-item-active'
          : 'text-white/70 hover:bg-[var(--sidebar-hover)] hover:text-white ltr:hover:translate-x-0.5 rtl:hover:-translate-x-0.5 motion-reduce:hover:translate-x-0',
      )}
    >
      {linkBody}
    </Link>
  );

  // ── Collapsed rail: icon-only with a tooltip (children are reachable once the
  //    sidebar is expanded). Applies to leaf and parent items alike. ───────────
  if (collapsed) {
    return (
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent
          side={direction === 'rtl' ? 'left' : 'right'}
          className="rounded-lg border border-primary/30 bg-auth-dark px-3 py-1.5 text-[13px] text-white shadow-lg"
        >
          <div className="flex items-center gap-2">
            <span>{item.label}</span>
            {showBadge && (
              <span className="rounded-full bg-rose-600 px-1.5 py-0.5 text-overline text-white">
                {badgeCount}
              </span>
            )}
          </div>
        </TooltipContent>
      </Tooltip>
    );
  }

  // ── Leaf item (no children): the link plus an optional pin star overlay. ───
  if (!hasChildren) {
    if (!pinnable || !onTogglePin) return content;
    const pinned = isPinned?.(item.id) ?? false;
    return (
      <div className="group/row relative">
        {content}
        <PinButton
          pinned={pinned}
          label={pinLabel(pinned, item.label)}
          onToggle={() => onTogglePin(item.id)}
        />
      </div>
    );
  }

  // ── Parent item with children: a header row (link + expand toggle) followed
  //    by an indented, collapsible sub-list. Auto-expands on the active route so
  //    nested admin pages (e.g. Integrations) are discoverable instead of hidden.
  return (
    <div>
      <div className="flex items-center gap-1">
        {content}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${item.label}`}
          className="sidebar-nav-disclosure flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white/55 transition-[background-color,color,box-shadow] hover:bg-[var(--sidebar-hover)] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70 motion-reduce:transition-none"
        >
          <ChevronDown
            className={cn(
              'h-4 w-4 transition-transform duration-200 ease-spring motion-reduce:transition-none',
              open ? 'rotate-0' : 'ltr:-rotate-90 rtl:rotate-90',
            )}
          />
        </button>
      </div>
      {open && (
        <ul className="mt-0.5 space-y-0.5 border-white/10 ps-3.5 ltr:ml-3 ltr:border-l rtl:mr-3 rtl:border-r">
          {children.map((child) => {
            const childIsActive = currentPath.startsWith(child.href);
            const ChildIcon = child.icon;
            const childPinned = isPinned?.(child.id) ?? false;
            const childPinnable = onTogglePin !== undefined;
            return (
              <li key={child.id} className={cn(childPinnable && 'group/row relative')}>
                <Link
                  href={child.href}
                  aria-current={childIsActive ? 'page' : undefined}
                  className={cn(
                    'sidebar-nav-link group relative flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium',
                    'transition-[transform,background-color,color] duration-200 ease-spring motion-reduce:transition-none',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70',
                    childIsActive
                      ? 'sidebar-item-active'
                      : 'text-white/70 hover:bg-[var(--sidebar-hover)] hover:text-white ltr:hover:translate-x-0.5 rtl:hover:-translate-x-0.5 motion-reduce:hover:translate-x-0',
                  )}
                >
                  <ChildIcon
                    className={cn(
                      'h-3.5 w-3.5 shrink-0 duration-200 ease-spring motion-reduce:transition-none',
                      childIsActive ? 'text-white' : '',
                    )}
                  />
                  <span className="flex-1 truncate tracking-[-0.01em]">{child.label}</span>
                </Link>
                {childPinnable && onTogglePin && (
                  <PinButton
                    pinned={childPinned}
                    label={pinLabel(childPinned, child.label)}
                    onToggle={() => onTogglePin(child.id)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});
