'use client';

/**
 * STEP 4 — Review & Submit (step-level container).
 *
 * SKELETON: thin wrapper over the lower-level `ReviewBody` (grouped read-only
 * summary in the left column + a right aside stacking the SLA Target Delivery
 * card and the REQUIRED attestation checkbox). The attestation is the final
 * submit gate; the per-group "Edit" affordance jumps back via `onEditStep`
 * (1-based step).
 *
 * STEP AGENT: restyle to the mockup (see new-request-wizard-mockup-spec.md
 * STEP 4) — a two-column layout with a "Request Information" summary sub-card,
 * an "Attached Supporting Documents" sub-card, and a right-aside "SLA Target
 * Delivery" card computed from the real turnaround. Keep the attestation gate
 * and the edit-to-jump behaviour. NOTE: with attachments now at step 3, the
 * lower-level `review-step.tsx` still maps its attachments "Edit" to step 2 —
 * the review agent should repoint that group to step 3.
 */

import type { ReviewStepContainerProps } from '../../_lib/wizard-types';
import ReviewBody from '../review-step';

export default function ReviewSubmitStep({
  selectedService,
  titleEn,
  titleAr,
  description,
  requesterName,
  beneficiary,
  priority,
  urgency,
  notes,
  requestedDueDateLabel,
  attachments,
  confirmed,
  onConfirmChange,
  confirmError,
  onEditStep,
}: ReviewStepContainerProps) {
  return (
    <ReviewBody
      service={selectedService}
      titleEn={titleEn}
      titleAr={titleAr}
      description={description}
      requesterName={requesterName}
      beneficiaryName={beneficiary?.name}
      priority={priority}
      urgency={urgency}
      notes={notes}
      requestedDueDate={requestedDueDateLabel}
      attachments={attachments}
      confirmed={confirmed}
      onConfirmChange={onConfirmChange}
      confirmError={confirmError}
      onEditStep={onEditStep}
    />
  );
}
