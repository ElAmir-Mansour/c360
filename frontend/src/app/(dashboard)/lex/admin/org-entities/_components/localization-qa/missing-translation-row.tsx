'use client';

/**
 * One row in the missing-translations list. Shows the owning entity (code +
 * deep-link), the scope (entity name vs role label, with role key when
 * applicable), a badge for which side is missing, and an RTL-correct preview of
 * the side that IS filled.
 *
 * Writes are out of scope: the row DEEP-LINKS to the entity so the existing
 * edit form can close the gap. No inline editing here.
 */
import Link from 'next/link';
import { ArrowUpRight, Building2, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { LocalizationGap } from '../../_lib/org-localization';
import type { LocalizationQaLabels } from '../../_lib/localization-qa-i18n';

interface MissingTranslationRowProps {
  gap: LocalizationGap;
  labels: LocalizationQaLabels;
}

export function MissingTranslationRow({
  gap,
  labels,
}: MissingTranslationRowProps) {
  const ScopeIcon = gap.scope === 'entity_name' ? Building2 : ShieldCheck;
  // The present side is Arabic exactly when the missing side is English.
  const presentIsArabic = gap.missing === 'en';
  const hasPresent = gap.present.trim().length > 0;

  return (
    <li className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/lex/admin/org-entities/${gap.entityId}`}
            className="font-mono text-sm font-semibold text-primary hover:underline"
          >
            {gap.entityCode}
          </Link>
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <ScopeIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {labels.scope[gap.scope]}
            {gap.scope === 'role_label' && gap.roleKey ? (
              <span className="font-mono text-caption text-foreground/70">
                · {labels.roleKeyPrefix}: {gap.roleKey}
              </span>
            ) : null}
          </span>
        </div>

        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">
            {labels.presentLabel}:
          </span>
          {hasPresent ? (
            <span
              dir={presentIsArabic ? 'rtl' : 'ltr'}
              lang={presentIsArabic ? 'ar' : 'en'}
              className="truncate font-medium text-foreground"
            >
              {gap.present}
            </span>
          ) : (
            <span className="italic text-muted-foreground">
              {labels.presentEmpty}
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Badge variant={gap.missing === 'ar' ? 'warning' : 'destructive'}>
          {labels.missingSide[gap.missing]}
        </Badge>
        <Link
          href={`/lex/admin/org-entities/${gap.entityId}`}
          className="inline-flex items-center gap-1 rounded-md border border-border/80 bg-card/70 px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          {labels.fixLink}
          <ArrowUpRight className="h-3.5 w-3.5 shrink-0" aria-hidden />
        </Link>
      </div>
    </li>
  );
}
