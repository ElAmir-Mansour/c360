'use client';

/**
 * MobileNav — hamburger → full-height drawer with an accordion of the nav model.
 * =============================================================================
 *
 * Built on the Radix `Dialog` primitive (the same primitive the shared `Sheet`
 * wraps), which gives us a real modal drawer for free:
 *   - focus is TRAPPED inside the drawer while open,
 *   - Escape closes it and returns focus to the trigger,
 *   - the overlay is clickable to dismiss,
 *   - `aria-modal` + labelled title for assistive tech.
 *
 * Inside, each top-level item with columns becomes an accordion section; plain
 * items render as direct links. Everything is token-driven and RTL-first
 * (logical properties + the Tailwind `rtl:` variant; the drawer enters from the
 * inline-start under both LTR and RTL).
 */

import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ChevronDown, Menu, X } from 'lucide-react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { cn } from '@/lib/utils';
import type { NavItem, NavLink, NavModel } from './nav-model';

export interface MobileNavProps {
  /** Same navigation model the desktop MegaMenu consumes. */
  items: NavModel;
  /** Localized accessible label for the hamburger toggle (e.g. "Open menu"). */
  openLabel: string;
  /** Localized accessible label for the close button (e.g. "Close menu"). */
  closeLabel: string;
  /** Localized title announced for the dialog (e.g. "Menu"). */
  title: string;
  /** Localized hint appended to external links. */
  externalLinkLabel?: string;
  /**
   * Optional footer slot rendered at the bottom of the drawer — typically the
   * primary/secondary CTAs and the theme/locale switcher.
   */
  footerSlot?: React.ReactNode;
  className?: string;
}

function DrawerLink({
  link,
  externalLinkLabel,
}: {
  link: NavLink;
  externalLinkLabel?: string;
}) {
  const Icon = link.icon;
  return (
    <li>
      <a
        href={link.href}
        {...(link.external
          ? { target: '_blank', rel: 'noopener noreferrer' }
          : {})}
        className={cn(
          'flex items-start gap-3 rounded-card p-3 text-start',
          'text-content-secondary transition-colors duration-fast ease-standard',
          'hover:bg-bg-subtle hover:text-content-primary',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card',
        )}
      >
        {Icon ? (
          <span
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-button bg-brand-primary-50 text-brand-primary-600"
            aria-hidden
          >
            <Icon className="h-4 w-4" />
          </span>
        ) : null}
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-1.5 text-body-sm font-semibold text-content-primary">
            {link.label}
            {link.external && externalLinkLabel ? (
              <span className="sr-only">{externalLinkLabel}</span>
            ) : null}
          </span>
          {link.description ? (
            <span className="text-caption text-content-muted">
              {link.description}
            </span>
          ) : null}
        </span>
      </a>
    </li>
  );
}

function DrawerItem({
  item,
  externalLinkLabel,
}: {
  item: NavItem;
  externalLinkLabel?: string;
}) {
  // Plain link (no columns).
  if (!item.columns || item.columns.length === 0) {
    return (
      <a
        href={item.href ?? '#'}
        className={cn(
          'flex items-center rounded-card px-3 py-4 text-body font-semibold text-content-primary',
          'transition-colors duration-fast ease-standard hover:bg-bg-subtle',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card',
        )}
      >
        {item.label}
      </a>
    );
  }

  // Columns → accordion section.
  return (
    <AccordionItem
      value={item.id}
      className="border-b border-outline-subtle"
    >
      <AccordionTrigger
        className={cn(
          'rounded-card px-3 text-body font-semibold text-content-primary no-underline hover:no-underline',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card',
          '[&>svg]:text-content-muted',
        )}
      >
        {item.label}
      </AccordionTrigger>
      <AccordionContent className="px-1">
        <div className="flex flex-col gap-4">
          {item.columns.map((column) => (
            <div key={column.id} className="flex flex-col gap-1">
              <p className="px-3 text-overline font-semibold uppercase text-content-muted">
                {column.heading}
              </p>
              <ul className="flex flex-col">
                {column.links.map((link) => (
                  <DrawerLink
                    key={link.id}
                    link={link}
                    externalLinkLabel={externalLinkLabel}
                  />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}

/**
 * Mobile navigation. The hamburger trigger is hidden at `lg` and up (the
 * MegaMenu takes over). Open/close is fully controlled here so the trigger can
 * expose `aria-expanded` for assistive tech.
 */
export function MobileNav({
  items,
  openLabel,
  closeLabel,
  title,
  externalLinkLabel,
  footerSlot,
  className,
}: MobileNavProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label={openLabel}
          aria-expanded={open}
          aria-haspopup="dialog"
          data-testid="mobile-nav-trigger"
          className={cn(
            'inline-flex h-10 w-10 items-center justify-center rounded-button lg:hidden',
            'border border-outline-subtle bg-surface-card text-content-secondary',
            'transition-colors duration-fast ease-standard hover:bg-bg-subtle hover:text-content-primary',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-focus focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page',
            className,
          )}
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-state-info/0 backdrop-blur-sm',
            'bg-neutral-950/50',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out data-[state=open]:fade-in',
          )}
        />
        <Dialog.Content
          data-testid="mobile-nav-drawer"
          className={cn(
            // Full-height drawer pinned to the inline-start edge; logical
            // inset so it enters from the correct side under RTL.
            'fixed inset-block-0 start-0 z-50 flex h-full w-[min(22rem,calc(100vw-3rem))] flex-col',
            'border-e border-outline-subtle bg-surface-card shadow-elevation-5',
            'duration-normal ease-emphasized',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out data-[state=open]:fade-in',
            'data-[state=closed]:slide-out-to-start data-[state=open]:slide-in-from-start',
            'focus:outline-none',
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-outline-subtle px-4 py-4">
            <Dialog.Title
              className="text-h4 font-semibold text-content-primary"
            >
              {title}
            </Dialog.Title>
            <Dialog.Description className="sr-only">
              {openLabel}
            </Dialog.Description>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label={closeLabel}
                data-testid="mobile-nav-close"
                className={cn(
                  'inline-flex h-9 w-9 items-center justify-center rounded-button',
                  'text-content-secondary transition-colors duration-fast ease-standard',
                  'hover:bg-bg-subtle hover:text-content-primary',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card',
                )}
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </Dialog.Close>
          </div>

          <nav
            aria-label={title}
            className="flex-1 overflow-y-auto px-2 py-2"
          >
            <Accordion type="multiple" className="flex flex-col">
              {items.map((item) => (
                <DrawerItem
                  key={item.id}
                  item={item}
                  externalLinkLabel={externalLinkLabel}
                />
              ))}
            </Accordion>
          </nav>

          {footerSlot ? (
            <div className="border-t border-outline-subtle p-4">
              {footerSlot}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * A small decorative chevron used by consumers that want to render their own
 * disclosure affordance against the same icon set. Exported for reuse/testing.
 */
export { ChevronDown as MobileNavChevron };
