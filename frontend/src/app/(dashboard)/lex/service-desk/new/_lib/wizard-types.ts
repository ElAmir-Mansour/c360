'use client';

/**
 * Shared type contract for the 4-step "New Legal Service Request" wizard.
 *
 * The wizard is: `service → details → attachments → review`, followed by a
 * distinct confirmation screen once the request is created. `page.tsx` owns ALL
 * form state + backend wiring (createRequest payload, eligibility, attachment
 * upload/scan/policy, SLA preview, draft autosave); each step component is
 * presentational and receives the slice of state + handlers it needs through the
 * prop interfaces declared here.
 *
 * Step agents implement the UI of a single step file against its interface —
 * they MUST NOT change these prop shapes without updating `page.tsx` in lock-step.
 */

import type {
  EligibilityDecision,
  LegalRequest,
  RequestPriority,
  ServiceCatalogEntry,
} from '@/lib/lex/requests';
import type { ServiceDeskLabels } from '../../_components/labels';
import type { BeneficiarySelection } from '../_components/beneficiary-picker';
import type { StagedAttachment } from './attachments-types';
import type { AttachmentPolicyState } from './attachment-policy';

/** Stable ids matched 1:1 by `<Wizard.Step id=…>` and the step config order. */
export const STEP_IDS = ['service', 'details', 'attachments', 'review'] as const;
export type WizardStepId = (typeof STEP_IDS)[number];

/** 1-based step number (mirrors the shared Wizard active index + 1). */
export type WizardStepNumber = 1 | 2 | 3 | 4;

/** Convenience alias re-exported so step files can `import type` from one place. */
export type { BeneficiarySelection } from '../_components/beneficiary-picker';

/**
 * Persisted draft envelope. `confirmed` is intentionally excluded — a resumed
 * draft must always re-attest at the review step. `step` is clampable to the new
 * 1–4 range (the shared provider clamps the derived index defensively).
 */
export interface WizardDraftState {
  step: WizardStepNumber;
  serviceId: string;
  beneficiary: BeneficiarySelection | null;
  titleEn: string;
  titleAr: string;
  description: string;
  requesterName: string;
  priority: RequestPriority;
  urgency: string;
  attachments: StagedAttachment[];
  notes?: string;
  requestedDueDate?: string;
}

/* -------------------------------------------------------------------------- */
/*  Per-step prop contracts                                                    */
/* -------------------------------------------------------------------------- */

/**
 * STEP 1 — Select Service. Renders the live catalog as a card grid, drives the
 * `serviceId` selection, and surfaces the eligibility decision for the resolved
 * service. The department picker lives on the DETAILS step (per mockup), so this
 * step is service-selection + eligibility only.
 */
export interface ServiceStepProps {
  labels: ServiceDeskLabels;
  /** Active, pre-filtered catalog entries. */
  services: ServiceCatalogEntry[];
  servicesLoading: boolean;
  servicesError: boolean;
  onRetryServices: () => void;
  /** Raw selected id (controlled). */
  serviceId: string;
  /** The id resolved against the loaded catalog (undefined for a stale id). */
  selectedService?: ServiceCatalogEntry;
  onServiceChange: (serviceId: string) => void;
  /** Ids to surface in a "recently used" group. */
  recentIds: string[];
  eligibility?: EligibilityDecision;
  eligibilityLoading: boolean;
  onRecheckEligibility: () => void;
  /** Validation error bag (reads `errors.service`). */
  errors: Record<string, string>;
}

/**
 * STEP 2 — Request Details. Gathers title.{en,ar}, requesting department,
 * description, priority (+ urgency justification), required requested due date,
 * notes, and the requester (defaults to the current user). Department is also
 * required and maps to the
 * `beneficiary` selection (payload `department` / `beneficiary_entity_id`).
 */
export interface DetailsStepProps {
  labels: ServiceDeskLabels;
  /** Selected service — used for SLA hints + description templating. */
  selectedService?: ServiceCatalogEntry;
  requesterName: string;
  onRequesterChange: (value: string) => void;
  /** Requesting department (org-entity picker). */
  beneficiary: BeneficiarySelection | null;
  onBeneficiaryChange: (selection: BeneficiarySelection | null) => void;
  titleEn: string;
  titleAr: string;
  onTitleEnChange: (value: string) => void;
  onTitleArChange: (value: string) => void;
  description: string;
  onDescriptionChange: (value: string) => void;
  priority: RequestPriority;
  onPriorityChange: (priority: RequestPriority) => void;
  urgency: string;
  onUrgencyChange: (value: string) => void;
  requestedDueDate: string;
  onDueDateChange: (value: string) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  /** Validation error bag (reads title/description/requester/beneficiary/requestedDueDate/urgency). */
  errors: Record<string, string>;
  /** Disables inputs while submitting / when the user lacks write permission. */
  disabled?: boolean;
}

/**
 * STEP 3 — Attachments. Wraps the existing `AttachmentsField` (upload / async
 * virus-scan poller / per-file policy slots). The attachment-policy blocking gate
 * + scan-clean gate are asserted by this step's validate() in `page.tsx`.
 */
export interface AttachmentsStepProps {
  labels: ServiceDeskLabels;
  attachments: StagedAttachment[];
  onAttachmentsChange: (next: StagedAttachment[]) => void;
  /** Applicable required-document policy verdict (fail-open). */
  policy: AttachmentPolicyState;
  /** Validation error bag (reads `errors.attachments`). */
  errors: Record<string, string>;
  disabled?: boolean;
}

/**
 * STEP 4 — Review & Submit. Read-only summary of everything gathered, the SLA
 * target-delivery projection, and the REQUIRED attestation checkbox (the final
 * submit gate). `onEditStep` jumps back to a 1-based step to amend a group.
 */
export interface ReviewStepContainerProps {
  labels: ServiceDeskLabels;
  selectedService?: ServiceCatalogEntry;
  titleEn: string;
  titleAr: string;
  description: string;
  requesterName: string;
  beneficiary: BeneficiarySelection | null;
  priority: RequestPriority;
  urgency: string;
  notes: string;
  /** Raw ISO due date (for logic). */
  requestedDueDate: string;
  /** Locale-formatted due date (for display). */
  requestedDueDateLabel?: string;
  attachments: StagedAttachment[];
  confirmed: boolean;
  onConfirmChange: (value: boolean) => void;
  confirmError?: string;
  /** Jump to a 1-based step: service=1, details=2, attachments=3. */
  onEditStep: (step: WizardStepNumber) => void;
}

/**
 * CONFIRMATION screen (post-submit). Currently satisfied by the existing
 * `SubmissionSuccess` component; shows the REAL `request.request_number`.
 */
export interface ConfirmationScreenProps {
  request: LegalRequest;
  onCreateAnother: () => void;
}

/** Presentational contract for the local 4-circle stepper. */
export interface WizardStepperItem {
  id: string;
  label: string;
}
