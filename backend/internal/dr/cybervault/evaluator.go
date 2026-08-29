package cybervault

import (
	"math"
	"strings"
	"time"
)

const (
	// DefaultRequiredRetentionDays is the minimum immutable retention expected
	// when a posture does not provide a stricter policy requirement.
	DefaultRequiredRetentionDays = 35
	// DefaultRestoreTestWindowDays is the maximum age for a successful restore
	// test before the evidence is considered stale.
	DefaultRestoreTestWindowDays = 90
	// DefaultBreakGlassTestWindowDays is the maximum age for testing emergency
	// access coverage.
	DefaultBreakGlassTestWindowDays = 180
)

// Evaluator evaluates vault posture with an injected clock so time-windowed
// checks remain deterministic in tests.
type Evaluator struct {
	now func() time.Time
}

// NewEvaluator constructs an Evaluator. A nil clock defaults to time.Now.
func NewEvaluator(clock func() time.Time) *Evaluator {
	if clock == nil {
		clock = time.Now
	}
	return &Evaluator{now: clock}
}

// Evaluate evaluates posture with the Evaluator's clock.
func (e *Evaluator) Evaluate(posture VaultPosture) PostureAssessment {
	return evaluate(posture, e.now())
}

// Evaluate scores posture at now. If now is zero, time.Now is used.
func Evaluate(posture VaultPosture, now time.Time) PostureAssessment {
	if now.IsZero() {
		now = time.Now()
	}
	return evaluate(posture, now)
}

type control struct {
	code         string
	title        string
	weight       int
	failSeverity FindingSeverity
	eval         func(VaultPosture, time.Time) controlOutcome
}

type controlOutcome struct {
	verdict     PostureVerdict
	message     string
	remediation string
}

var postureControls = []control{
	{
		code:         "CV-LOCK",
		title:        "immutable vault lock",
		weight:       20,
		failSeverity: SeverityHigh,
		eval:         evalVaultLock,
	},
	{
		code:         "CV-ISOLATION",
		title:        "administrative isolation",
		weight:       15,
		failSeverity: SeverityHigh,
		eval:         evalIsolation,
	},
	{
		code:         "CV-REPLICA",
		title:        "cross-region replica",
		weight:       10,
		failSeverity: SeverityWarning,
		eval:         evalReplica,
	},
	{
		code:         "CV-ENCRYPTION",
		title:        "customer-managed encryption",
		weight:       10,
		failSeverity: SeverityHigh,
		eval:         evalEncryption,
	},
	{
		code:         "CV-APPROVALS",
		title:        "multi-party approvals",
		weight:       15,
		failSeverity: SeverityHigh,
		eval:         evalApprovals,
	},
	{
		code:         "CV-RETENTION",
		title:        "retention minimum",
		weight:       10,
		failSeverity: SeverityHigh,
		eval:         evalRetention,
	},
	{
		code:         "CV-RESTORE-TEST",
		title:        "restore test recency",
		weight:       10,
		failSeverity: SeverityWarning,
		eval:         evalRestoreTest,
	},
	{
		code:         "CV-BREAKGLASS",
		title:        "break-glass coverage",
		weight:       10,
		failSeverity: SeverityWarning,
		eval:         evalBreakGlass,
	},
}

func evaluate(posture VaultPosture, now time.Time) PostureAssessment {
	findings := make([]VaultFinding, 0)
	totalWeight := 0
	earned := 0.0
	var satisfied, partial, failed int
	highest := VerdictSatisfied

	for _, c := range postureControls {
		totalWeight += c.weight
		out := c.eval(posture, now)
		earned += out.verdict.score() * float64(c.weight)

		switch out.verdict {
		case VerdictSatisfied:
			satisfied++
		case VerdictPartial:
			partial++
			if highest == VerdictSatisfied {
				highest = VerdictPartial
			}
		default:
			failed++
		}

		if out.verdict == VerdictSatisfied {
			continue
		}
		severity := SeverityWarning
		if out.verdict == VerdictFailed {
			severity = c.failSeverity
		}
		if severity == SeverityHigh {
			highest = VerdictFailed
		} else if highest == VerdictSatisfied {
			highest = VerdictPartial
		}
		findings = append(findings, VaultFinding{
			Code:        c.code,
			Title:       c.title,
			Verdict:     out.verdict,
			Severity:    severity,
			Weight:      c.weight,
			Message:     out.message,
			Remediation: out.remediation,
		})
	}

	score := 0.0
	if totalWeight > 0 {
		score = roundPct(earned / float64(totalWeight) * 100)
	}

	return PostureAssessment{
		VaultID:       posture.ID,
		Provider:      posture.Provider,
		Score:         score,
		Verdict:       highest,
		TotalControls: len(postureControls),
		Satisfied:     satisfied,
		Partial:       partial,
		Failed:        failed,
		Findings:      findings,
		EvaluatedAt:   now,
	}
}

func (v PostureVerdict) score() float64 {
	switch v {
	case VerdictSatisfied:
		return 1
	case VerdictPartial:
		return 0.5
	default:
		return 0
	}
}

func evalVaultLock(p VaultPosture, _ time.Time) controlOutcome {
	switch {
	case p.ImmutabilityEnabled && p.VaultLockEnabled:
		return satisfied()
	case p.ImmutabilityEnabled:
		return partial("vault immutability is enabled, but vault lock is not enforced", "enable vault lock or equivalent governance-mode bypass protection")
	case p.VaultLockEnabled:
		return partial("vault lock is configured, but immutable retention evidence is missing", "enforce immutable retention on protected recovery points")
	default:
		return failed("vault lacks immutable retention and enforced vault lock", "enable immutable retention and lock the vault against deletion or retention reduction")
	}
}

func evalIsolation(p VaultPosture, _ time.Time) controlOutcome {
	hasBoundary := p.Isolation.CrossAccount || p.Isolation.DisjointAdmins
	switch {
	case hasBoundary && p.Isolation.SourceAdminDenied:
		return satisfied()
	case hasBoundary:
		return partial("vault has an administrative boundary, but source administrators can still affect vault contents", "deny source-side principals delete, unlock, and retention-reduction rights on vault objects")
	case p.Isolation.SourceAdminDenied:
		return partial("source administrators are restricted, but no cross-account or disjoint-admin boundary is recorded", "place the vault in a separate account or assign disjoint vault administrators")
	default:
		return failed("vault administration is not isolated from the protected source environment", "use a separate account or disjoint admin roles and deny source-side destructive permissions")
	}
}

func evalReplica(p VaultPosture, _ time.Time) controlOutcome {
	if hasCrossRegionReplica(p.PrimaryRegion, p.ReplicaRegions) {
		return satisfied()
	}
	if len(nonEmptyRegions(p.ReplicaRegions)) > 0 {
		return partial("replica configuration exists, but no distinct cross-region replica was found", "replicate the vault to a region different from the primary region")
	}
	return failed("no cross-region vault replica is configured", "add at least one immutable replica in a separate region")
}

func evalEncryption(p VaultPosture, _ time.Time) controlOutcome {
	switch {
	case p.EncryptionEnabled && p.CustomerManagedKey:
		return satisfied()
	case p.EncryptionEnabled:
		return partial("vault encryption is enabled with provider-managed keys", "use customer-managed keys with restricted key administration for the vault")
	default:
		return failed("vault encryption is not enabled", "enable encryption and protect the key with customer-managed access controls")
	}
}

func evalApprovals(p VaultPosture, _ time.Time) controlOutcome {
	restoreOK := p.Approval.RequireRestoreApproval && p.Approval.RestoreApprovers >= 2
	destructiveOK := p.Approval.RequireDestructiveApproval && p.Approval.DestructiveApprovers >= 2

	switch {
	case restoreOK && destructiveOK && p.Approval.SeparationOfDuties:
		return satisfied()
	case restoreOK && destructiveOK:
		return partial("restore and destructive operations require multiple approvers, but separation of duties is not enforced", "require approvers to be separate from requesters and vault operators")
	case restoreOK || destructiveOK:
		return partial("multi-party approval is only enforced for one sensitive operation class", "require at least two approvers for both restore and destructive vault operations")
	default:
		return failed("restore and destructive vault operations do not require multi-party approval", "require at least two approvers for restore and destructive actions")
	}
}

func evalRetention(p VaultPosture, _ time.Time) controlOutcome {
	required := requiredRetentionDays(p.Retention)
	switch {
	case p.Retention.MinimumDays >= required:
		return satisfied()
	case p.Retention.MinimumDays > 0:
		return partial(
			"vault retention minimum is below the required cyber-recovery window",
			"increase minimum retention to at least the required number of days",
		)
	default:
		return failed("no minimum immutable retention is configured", "configure a minimum immutable retention window for vault recovery points")
	}
}

func evalRestoreTest(p VaultPosture, now time.Time) controlOutcome {
	window := daysOrDefault(p.RestoreTestWindowDays, DefaultRestoreTestWindowDays)
	switch {
	case !p.LastRestoreTestAt.IsZero() && p.LastRestoreTestPassed && withinDays(p.LastRestoreTestAt, now, window):
		return satisfied()
	case !p.LastRestoreTestAt.IsZero() && p.LastRestoreTestPassed:
		return partial("last successful restore test is stale", "run and record a successful restore test within the required recency window")
	case !p.LastRestoreTestAt.IsZero():
		return partial("latest restore test did not pass", "remediate restore failures and rerun the restore test")
	default:
		return failed("no restore test evidence is recorded", "perform a clean-room restore test and record the result")
	}
}

func evalBreakGlass(p VaultPosture, now time.Time) controlOutcome {
	window := daysOrDefault(p.BreakGlassTestWindowDays, DefaultBreakGlassTestWindowDays)
	switch {
	case p.BreakGlassEnabled && p.BreakGlassMFA && !p.BreakGlassLastTestedAt.IsZero() && withinDays(p.BreakGlassLastTestedAt, now, window):
		return satisfied()
	case p.BreakGlassEnabled && p.BreakGlassMFA:
		return partial("break-glass access exists with MFA, but recent test evidence is missing", "test break-glass access within the required recency window")
	case p.BreakGlassEnabled:
		return partial("break-glass access exists without MFA evidence", "enforce MFA on break-glass access and test it")
	default:
		return failed("no break-glass recovery access is recorded", "configure tightly controlled break-glass access with MFA and periodic tests")
	}
}

func satisfied() controlOutcome {
	return controlOutcome{verdict: VerdictSatisfied}
}

func partial(message, remediation string) controlOutcome {
	return controlOutcome{verdict: VerdictPartial, message: message, remediation: remediation}
}

func failed(message, remediation string) controlOutcome {
	return controlOutcome{verdict: VerdictFailed, message: message, remediation: remediation}
}

func requiredRetentionDays(p RetentionPolicy) int {
	if p.RequiredMinimumDays > 0 {
		return p.RequiredMinimumDays
	}
	return DefaultRequiredRetentionDays
}

func daysOrDefault(v, def int) int {
	if v > 0 {
		return v
	}
	return def
}

func withinDays(t, now time.Time, days int) bool {
	if t.IsZero() || t.After(now) {
		return false
	}
	return !t.Before(now.AddDate(0, 0, -days))
}

func hasCrossRegionReplica(primary string, replicas []string) bool {
	primary = strings.TrimSpace(strings.ToLower(primary))
	for _, r := range replicas {
		region := strings.TrimSpace(strings.ToLower(r))
		if region == "" {
			continue
		}
		if primary == "" || region != primary {
			return true
		}
	}
	return false
}

func nonEmptyRegions(regions []string) []string {
	out := make([]string, 0, len(regions))
	for _, r := range regions {
		if strings.TrimSpace(r) != "" {
			out = append(out, r)
		}
	}
	return out
}

func roundPct(v float64) float64 {
	return math.Round(v*100) / 100
}
