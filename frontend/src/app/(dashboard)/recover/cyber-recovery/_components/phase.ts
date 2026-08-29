// Shared phase presentation helpers for the Cyber Recovery workspace.
//
// Human-readable text is resolved through the 'recover' i18n namespace: callers
// pass the translator from `useRecoverT()` so labels localize (en/ar) while the
// pure enum → variant mappers below stay text-free.
import type { CyberRecoveryPhase, CyberRecoveryVerdict } from '@/types/recover-cyber';

/** A minimal translator shape (the namespaced translator from `useRecoverT`). */
type Translate = (key: string) => string;

/** Ordered linear phases for the clean-room recovery flow stepper. */
export const FLOW_STEPS: { phase: CyberRecoveryPhase; labelKey: string }[] = [
  { phase: 'clean_point_selected', labelKey: 'cyber.flowStepCleanPoint' },
  { phase: 'provisioned', labelKey: 'cyber.flowStepProvisioned' },
  { phase: 'recovered', labelKey: 'cyber.flowStepRecovered' },
  { phase: 'integrity_passed', labelKey: 'cyber.flowStepIntegrity' },
  { phase: 'approved', labelKey: 'cyber.flowStepApproval' },
  { phase: 'returned_to_production', labelKey: 'cyber.flowStepReturned' },
];

/** Human label for a phase, resolved via the 'recover' namespace translator. */
export function phaseLabel(t: Translate, phase: CyberRecoveryPhase): string {
  return t(`phase.${phase}`);
}

/** Badge variant for a phase. */
export function phaseVariant(
  phase: CyberRecoveryPhase,
): 'default' | 'secondary' | 'destructive' | 'warning' | 'success' | 'outline' {
  switch (phase) {
    case 'returned_to_production':
    case 'integrity_passed':
    case 'approved':
      return 'success';
    case 'integrity_failed':
    case 'aborted':
      return 'destructive';
    case 'awaiting_approval':
      return 'warning';
    default:
      return 'secondary';
  }
}

/** Badge variant for a clean-room verdict. */
export function verdictVariant(
  verdict?: CyberRecoveryVerdict | string,
): 'default' | 'secondary' | 'destructive' | 'warning' | 'success' | 'outline' {
  switch (verdict) {
    case 'clean':
      return 'success';
    case 'malware':
    case 'integrity_failed':
    case 'error':
      return 'destructive';
    default:
      return 'outline';
  }
}

/** Terminal phases — no further action is possible. */
export function isTerminalPhase(phase: CyberRecoveryPhase): boolean {
  return phase === 'returned_to_production' || phase === 'aborted';
}

/** Whether the integrity verdict permits proceeding to approval. */
export function integrityPassed(verdict?: CyberRecoveryVerdict | string): boolean {
  return verdict === 'clean';
}
