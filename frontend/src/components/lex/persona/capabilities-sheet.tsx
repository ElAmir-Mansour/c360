'use client';

/**
 * "MY LEX ACCESS" CAPABILITIES SHEET (§14) — a right-side sheet opened from the
 * Lex shell that shows the user's:
 *   - active legal role (tier + escalation level),
 *   - available legal roles,
 *   - effective permissions grouped by domain with ✓ (granted) markers.
 *
 * The grouped permission list derives every domain's row set from the SPEC's
 * full action verb set so a user sees both what they CAN do (✓) and what they
 * CANNOT (✗) for each domain they touch — matching the §14 example grouping.
 * Bilingual + RTL throughout.
 */

import { Check, X, ChevronRight } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import { useLexContext } from '@/lib/lex/use-lex-context';
import {
  groupPermissionsByDomain,
  useLexPersonaLabels,
} from './persona-labels';

/** Trigger + sheet. The trigger is a small chip suitable for the shell footer. */
export function LexCapabilitiesSheet({
  className,
  triggerClassName,
}: {
  className?: string;
  triggerClassName?: string;
}) {
  const { locale, direction } = useLocaleOrDefault();
  const labels = useLexPersonaLabels();
  const { activeRole, availableRoles, effectivePermissions } = useLexContext();

  const grouped = groupPermissionsByDomain(effectivePermissions);

  return (
    <Sheet>
      <SheetTrigger
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card/60 px-3 py-1.5',
          'text-[12px] font-medium text-foreground/75 transition-colors hover:border-primary/30 hover:bg-primary/5',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          triggerClassName,
        )}
        data-testid="lex-capabilities-trigger"
      >
        {labels.sheet.trigger}
        <ChevronRight className="h-3.5 w-3.5 text-foreground/45 rtl:rotate-180" aria-hidden />
      </SheetTrigger>
      <SheetContent
        side={direction === 'rtl' ? 'left' : 'right'}
        dir={direction}
        lang={locale}
        className={cn('flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md', className)}
        data-testid="lex-capabilities-sheet"
      >
        <SheetHeader className="text-start">
          <SheetTitle>{labels.sheet.title}</SheetTitle>
          <SheetDescription>{labels.sheet.description}</SheetDescription>
        </SheetHeader>

        <div className="mt-5 flex flex-col gap-6">
          {/* Active role */}
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/50">
              {labels.sheet.activeRoleHeading}
            </h3>
            {activeRole ? (
              <div className="rounded-xl border border-primary/20 bg-primary/[0.05] p-3">
                <p className="text-sm font-semibold text-foreground">
                  {locale === 'ar' ? activeRole.name_ar : activeRole.name_en}
                </p>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-[12px]">
                  <div>
                    <dt className="text-foreground/50">{labels.sheet.tierLabel}</dt>
                    <dd className="font-medium text-foreground/80">
                      {labels.tiers[activeRole.tier] ?? activeRole.tier}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-foreground/50">{labels.sheet.escalationLabel}</dt>
                    <dd className="font-medium text-foreground/80">
                      {activeRole.escalation_level}
                    </dd>
                  </div>
                </dl>
              </div>
            ) : (
              <p className="rounded-xl border border-border/60 bg-muted/40 p-3 text-[12px] text-foreground/60">
                {labels.sheet.noRole}
              </p>
            )}
          </section>

          {/* Available roles */}
          {availableRoles.length > 0 ? (
            <section>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/50">
                {labels.sheet.availableRolesHeading}
              </h3>
              <ul className="flex flex-wrap gap-1.5">
                {availableRoles.map((role) => (
                  <li key={role.slug}>
                    <Badge variant={role.slug === activeRole?.slug ? 'default' : 'outline'}>
                      {locale === 'ar' ? role.name_ar : role.name_en}
                    </Badge>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Effective permissions grouped by domain */}
          <section>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-foreground/50">
              {labels.sheet.permissionsHeading}
            </h3>
            {grouped.length === 0 ? (
              <p className="rounded-xl border border-border/60 bg-muted/40 p-3 text-[12px] text-foreground/60">
                {labels.sheet.noPermissions}
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {grouped.map(({ domain, verbs }) => (
                  <div key={domain}>
                    <p className="mb-1.5 text-[12px] font-semibold text-foreground/80">
                      {labels.domains[domain] ?? domain}
                    </p>
                    <ul className="space-y-1">
                      {verbs.map((verb) => (
                        <CapabilityRow
                          key={verb}
                          label={labels.verbs[verb] ?? verb}
                          granted
                          grantedLabel={labels.sheet.granted}
                        />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** A single ✓/✗ permission row. `granted` rows show a check; otherwise an X. */
function CapabilityRow({
  label,
  granted,
  grantedLabel,
}: {
  label: string;
  granted: boolean;
  grantedLabel: string;
}) {
  return (
    <li className="flex items-center gap-2 text-[13px] text-foreground/75">
      {granted ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-success-600" aria-hidden />
      ) : (
        <X className="h-3.5 w-3.5 shrink-0 text-foreground/40" aria-hidden />
      )}
      <span>{label}</span>
      <span className="sr-only">{grantedLabel}</span>
    </li>
  );
}
