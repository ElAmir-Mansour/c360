// Cyber Recovery workspace (Recover · Prompt 6).
//
// Composes the existing dr/* cyber-recovery capabilities — clean room
// (internal/dr/cleanroom), ransomware detection (internal/dr/ransomware), clean
// points, and the immutable decision trail — into the distinguishing clean-room
// RECOVERY FLOW with its MANDATORY integrity gate:
//
//   select last-known-good clean point -> provision to clean/bare-metal target
//   -> run runbook recovery -> mandatory integrity-check gate -> explicit
//   approval before "return to production network".
//
// The integrity gate is a HARD, SERVER-SIDE blocker (enforced by
// internal/recover/cyberrecovery): return-to-production cannot proceed until the
// clean-room scan passes AND an authorized approver signs off. The server-side
// entitlement guard for this sub-solution lives in this route's layout.
import { CyberRecoveryWorkspace } from './_components/cyber-recovery-workspace';

export default function CyberRecoveryPage() {
  return <CyberRecoveryWorkspace />;
}
