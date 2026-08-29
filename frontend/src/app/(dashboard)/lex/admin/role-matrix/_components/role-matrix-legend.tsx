'use client';

import { useLocale } from '@/components/providers/locale-provider';
import { cn } from '@/lib/utils';
import { VERB_AUTHORITY } from '../_lib/legal-role-matrix';
import { useRoleMatrixLabels } from '../_lib/role-matrix-labels';
import { verbSwatchClass } from './verb-style';

/**
 * Permission legend — the six verbs (highest→lowest authority) plus the
 * no-access marker, each with its bilingual name + meaning. Colour swatches
 * mirror the cell colouring used by the grid.
 */
export function RoleMatrixLegend() {
  const { locale, direction } = useLocale();
  const t = useRoleMatrixLabels();

  return (
    <section
      dir={direction}
      lang={locale}
      aria-label={t.legendTitle}
      className="card p-5"
    >
      <h2 className="text-sm font-semibold tracking-tight text-foreground">{t.legendTitle}</h2>
      <ul className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {VERB_AUTHORITY.map((verb) => (
          <li key={verb} className="flex items-start gap-2.5">
            <span
              className={cn(
                'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white',
                verbSwatchClass(verb),
              )}
              aria-hidden
            >
              {verb}
            </span>
            <span className="min-w-0 text-sm leading-5">
              <span className="font-medium text-foreground">{t.verbName[verb]}</span>
              <span className="text-muted-foreground"> — {t.verbMeaning[verb]}</span>
            </span>
          </li>
        ))}
        <li className="flex items-start gap-2.5">
          <span
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-dashed border-border text-xs font-bold text-muted-foreground"
            aria-hidden
          >
            —
          </span>
          <span className="min-w-0 text-sm leading-5">
            <span className="font-medium text-foreground">{t.legendNoAccess}</span>
          </span>
        </li>
      </ul>
    </section>
  );
}
