import type { ReturnIncompleteReasonCode } from '@/lib/lex/requests';

/**
 * RETURN_REASON_CODES is the controlled deficiency list from the Al Othaim intake
 * workflow (PRD 7.0 / Diagram B). It is the single source of ordering for the
 * four PRD return-reason codes shared by both the execution "return incomplete"
 * dialog and the approval-gate reject dialog. AR/EN labels for each code live in
 * `labels.ts` under `returnDialog.reasons` and are reused by both dialogs.
 */
export const RETURN_REASON_CODES: ReturnIncompleteReasonCode[] = [
  'missing_information',
  'doa_non_compliance',
  'incomplete_referral_procedures',
  'invalid_attachments',
];
