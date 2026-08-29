'use client';

/**
 * PERSONA SWITCHER (§18.6) — only rendered when the user holds more than one
 * legal role. Picking a role:
 *   1. POSTs `/api/v1/lex/persona` via `switchPersona` (refreshes the context +
 *      re-merges the new persona's effective permissions),
 *   2. reroutes to the new persona's landing — but ONLY when it is a
 *      known-existing route; otherwise to `/lex` (the persona-aware home), so a
 *      switch never 404s (§6 deep-link safety).
 *
 * Bilingual + RTL: role names resolve by active locale; chrome from the persona
 * label bundle. The active role is marked and disabled in the menu.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronsUpDown, Check, Loader2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import { useLexContext } from '@/lib/lex/use-lex-context';
import { resolvePersonaLanding } from '@/lib/lex/persona-landing';
import { useLexPersonaLabels } from './persona-labels';

export function LexPersonaSwitcher({ className }: { className?: string }) {
  const router = useRouter();
  const { locale } = useLocaleOrDefault();
  const labels = useLexPersonaLabels();
  const { activeRole, availableRoles, switchPersona, switching } = useLexContext();
  const [errored, setErrored] = useState(false);

  // §18.6 — show ONLY when the user has more than one legal role.
  if (availableRoles.length <= 1) return null;

  const handleSelect = async (slug: string) => {
    if (slug === activeRole?.slug || switching) return;
    setErrored(false);
    try {
      const me = await switchPersona(slug);
      // Route to the new persona landing when it exists, else /lex (never 404).
      router.push(resolvePersonaLanding(me.persona_landing));
    } catch {
      setErrored(true);
    }
  };

  const triggerName = activeRole
    ? locale === 'ar'
      ? activeRole.name_ar
      : activeRole.name_en
    : labels.switcher.trigger;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card/60 px-3 py-1.5',
          'text-[12px] font-medium text-foreground/80 transition-colors hover:border-primary/30 hover:bg-primary/5',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          className,
        )}
        aria-label={labels.switcher.heading}
        data-testid="lex-persona-switcher"
      >
        {switching ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden />
        ) : (
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-foreground/50" aria-hidden />
        )}
        <span className="max-w-[10rem] truncate">
          {switching ? labels.switcher.switching : triggerName}
        </span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[15rem]">
        <DropdownMenuLabel>{labels.switcher.heading}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {availableRoles.map((role) => {
          const isActive = role.slug === activeRole?.slug;
          const name = locale === 'ar' ? role.name_ar : role.name_en;
          return (
            <DropdownMenuItem
              key={role.slug}
              disabled={isActive || switching}
              onSelect={(event) => {
                // Keep the menu's selection from racing the async switch.
                event.preventDefault();
                void handleSelect(role.slug);
              }}
              className="flex items-center justify-between gap-3"
            >
              <span className="truncate">{name}</span>
              {isActive ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary">
                  <Check className="h-3.5 w-3.5" aria-hidden />
                  {labels.switcher.activeBadge}
                </span>
              ) : null}
            </DropdownMenuItem>
          );
        })}
        {errored ? (
          <>
            <DropdownMenuSeparator />
            <p className="px-2 py-1.5 text-[11px] text-destructive" role="alert">
              {labels.switcher.error}
            </p>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
