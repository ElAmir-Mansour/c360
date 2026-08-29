'use client';

/**
 * ROLE BADGE (§18.5) — renders the active legal persona in the Lex shell:
 *
 *   Legal Director · Legal tier · Escalation level 2
 *   مدير الإدارة القانونية · الإدارة القانونية · مستوى التصعيد ٢
 *
 * Reads the active role from the persona context. Renders nothing when the user
 * holds no legal role (NO_LEX_ROLE_ASSIGNED) so a non-legal user sees no chrome.
 * Bilingual + RTL-safe: the role NAME is resolved from `name_en`/`name_ar` by
 * the active locale, tier + escalation copy come from the persona label bundle.
 */

import { ShieldCheck } from 'lucide-react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import { useLexContext } from '@/lib/lex/use-lex-context';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useLexPersonaLabels } from './persona-labels';

export function LexRoleBadge({ className }: { className?: string }) {
  const { locale } = useLocaleOrDefault();
  const labels = useLexPersonaLabels();
  const { activeRole, loading } = useLexContext();

  if (loading) {
    return (
      <span
        className={cn(
          'inline-flex h-7 w-40 animate-pulse rounded-full bg-muted/60',
          className,
        )}
        aria-hidden
      />
    );
  }

  if (!activeRole) return null;

  const roleName = locale === 'ar' ? activeRole.name_ar : activeRole.name_en;
  const tierName = labels.tiers[activeRole.tier] ?? activeRole.tier;
  // The Arabic tier already reads as a full phrase, so the EN "tier" suffix is
  // intentionally empty in the AR bundle.
  const tierText = labels.badge.tierSuffix
    ? `${tierName} ${labels.badge.tierSuffix}`
    : tierName;
  const escalationText = labels.badge.escalation(activeRole.escalation_level);

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-2 rounded-full border border-primary/20 bg-primary/[0.07] px-3 py-1.5',
        'text-[12px] font-medium text-foreground/80',
        className,
      )}
      aria-label={labels.badge.ariaLabel}
      data-testid="lex-role-badge"
    >
      <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
      <span className="truncate font-semibold text-foreground">{roleName}</span>
      <span className="text-foreground/35" aria-hidden>
        ·
      </span>
      <span className="shrink-0 text-foreground/80">{tierText}</span>
      <span className="text-foreground/35" aria-hidden>
        ·
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className="shrink-0 cursor-default text-foreground/80 underline decoration-dotted decoration-foreground/40 underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
          >
            {escalationText}
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[260px]">
          <p className="text-xs">{labels.badge.escalationHint}</p>
        </TooltipContent>
      </Tooltip>
    </span>
  );
}
