'use client';

import { ShieldAlert } from 'lucide-react';
import type { Consultation } from '@/lib/lex/consultations';
import { useConsultationLabels } from './labels';

/**
 * ConsultationLegalHoldBanner — top-of-page alert that a consultation is under
 * legal hold (#13).
 *
 * Renders a prominent rose/destructive banner ONLY when
 * `consultation.legal_hold === true`; returns null otherwise. Surfaces the
 * seeded copy (`legalHold.onHold` / `legalHold.bannerMessage`) and the
 * `legalHold.holdReason: {reason}` line when a reason is present. Accessible via
 * `role="alert"`; the accent bar uses a logical (`start`) edge for RTL.
 *
 * Public prop shape is stable: `{ consultation }`.
 */
export interface ConsultationLegalHoldBannerProps {
  consultation: Consultation;
}

export function ConsultationLegalHoldBanner({ consultation }: ConsultationLegalHoldBannerProps) {
  const L = useConsultationLabels();

  if (consultation.legal_hold !== true) {
    return null;
  }

  const reason = consultation.legal_hold_reason?.trim();

  return (
    <div
      role="alert"
      className="relative overflow-hidden rounded-lg border border-error-100 bg-error-50 px-4 py-3 ps-5 text-error-700 dark:border-error-700/60 dark:bg-error-700/40 dark:text-error-100"
    >
      <span className="absolute inset-y-0 start-0 w-1 bg-error-500" aria-hidden />
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
        <div className="min-w-0 space-y-1">
          <p className="font-semibold">{L.legalHold.onHold}</p>
          <p className="text-sm">{L.legalHold.bannerMessage}</p>
          {reason ? (
            <p className="text-sm">
              <span className="font-medium">{L.legalHold.holdReason}:</span> {reason}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
