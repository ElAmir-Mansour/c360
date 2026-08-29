'use client';

/**
 * dr-error-boundary-labels.ts — feature-local bilingual copy for the ClarioDR
 * route-segment error boundary (`/dr/error.tsx`).
 *
 * Per the console's i18n convention, feature-local user-facing strings live
 * beside the feature (NOT the shared `_lib/dr-i18n.ts`). All copy is held in a
 * `DRBilingual<DRErrorBoundaryLabels>` bundle — two full, same-shaped copies of
 * the label object (English + professional Modern Standard Arabic) — and resolved
 * against the active locale by the {@link useDRErrorBoundaryLabels} hook
 * (`useLocaleOrDefault`-based, mirroring {@link useDRLabels}). Resolution defaults
 * to English (the `resolveDRBilingual` cross-locale fallback) so isolated tests
 * and the `renderWithQuery` `en` default keep the English surface; an Arabic user
 * sees the full MSA surface with logical RTL props.
 *
 * `referenceLabel` is a function so the digest interpolation is locale-correct in
 * both directions (no ICU runtime — the `{digest}` is substituted manually).
 */

import { useMemo } from 'react';
import { useLocaleOrDefault } from '@/components/providers/locale-provider';
import { type DRBilingual, resolveDRBilingual } from '../../_lib/dr-i18n';

export interface DRErrorBoundaryLabels {
  /** Heading announced to assistive tech via the alert region. */
  title: string;
  /** Reassuring explanation that the rest of the platform is unaffected. */
  description: string;
  /** Re-mount the failed segment (Next.js error-boundary `reset`). */
  retryAction: string;
  /** Navigate back to the console overview. */
  backAction: string;
  /** Optional digest reference line; `digest` is interpolated manually. */
  referenceLabel: (digest: string) => string;
}

export const drErrorBoundaryLabelBundle: DRBilingual<DRErrorBoundaryLabels> = {
  en: {
    title: 'The recovery console hit an unexpected error',
    description:
      'Something went wrong while rendering this part of the Recovery Operations Console. Your recovery data is unaffected — retry this view, or return to the console overview.',
    retryAction: 'Try again',
    backAction: 'Back to recovery console',
    referenceLabel: (digest) => `Reference: ${digest}`,
  },
  ar: {
    title: 'واجه وحدة تحكّم التعافي خطأً غير متوقّع',
    description:
      'حدث خطأ أثناء عرض هذا الجزء من وحدة تحكّم عمليات التعافي. بيانات التعافي الخاصة بك غير متأثّرة — أعِد المحاولة لهذا العرض، أو عُد إلى نظرة عامة على وحدة التحكّم.',
    retryAction: 'إعادة المحاولة',
    backAction: 'العودة إلى وحدة تحكّم التعافي',
    referenceLabel: (digest) => `المرجع: ${digest}`,
  },
};

/**
 * useDRErrorBoundaryLabels resolves the error-boundary copy against the active
 * locale (English fallback), mirroring {@link useDRLabels}. Memoised by locale.
 */
export function useDRErrorBoundaryLabels(): DRErrorBoundaryLabels {
  const { locale } = useLocaleOrDefault();
  return useMemo(
    () => resolveDRBilingual(drErrorBoundaryLabelBundle, locale),
    [locale],
  );
}
