'use client';

/**
 * Competent-court display resolution for every case surface — detail, list,
 * preview and the control panel. `GET /legal-cases` and `GET /legal-cases/{id}`
 * both hydrate the joined `court` object (see `legalCaseJSONSelect` in
 * `legal_case_repo.go`), so list rows resolve exactly like detail rows.
 *
 * The court is captured as a `legal_courts` reference row (`court_id`, hydrated
 * onto the case as `court`) since the intake form moved off free text. Rows
 * created before that migration only carry the legacy free-text
 * `competent_court`, so the reference name is preferred and the legacy string
 * is the fallback — a historical case keeps rendering its original court
 * instead of going blank.
 *
 * `court_number` is deliberately absent: the field was retired from intake and
 * from every display surface, so it must never re-enter a court label.
 */

import { useCallback } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { resolveLocalized } from '@/lib/i18n/localized';
import type { LegalCase } from '@/lib/lex/cases';

export type CaseCourtSource = Pick<LegalCase, 'court' | 'competent_court'>;

/**
 * Returns the court label for a case, or an empty string when neither the
 * reference row nor the legacy free text is set. Callers own the "not set"
 * wording so each surface keeps its own localized fallback.
 */
export function useCaseCourtName(): (legalCase: CaseCourtSource) => string {
  const { locale } = useLocaleOrDefault();

  return useCallback(
    (legalCase: CaseCourtSource) => {
      const referenced = legalCase.court
        ? resolveLocalized(legalCase.court.name, locale).trim()
        : '';
      if (referenced) return referenced;
      return legalCase.competent_court?.trim() ?? '';
    },
    [locale],
  );
}
