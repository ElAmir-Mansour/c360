package selfdr

import (
	"fmt"
	"sort"
	"time"
)

const (
	// DefaultRestoreTestWindow is used when a profile does not set an explicit
	// restore-test freshness window.
	DefaultRestoreTestWindow = 90 * 24 * time.Hour

	FindingMissingRequiredComponent = "missing_required_component"
	FindingBackupMissing            = "backup_missing"
	FindingBackupNotImmutable       = "backup_not_immutable"
	FindingBackupNotEncrypted       = "backup_not_encrypted"
	FindingRestoreTestFailed        = "restore_test_failed"
	FindingRestoreTestMissing       = "restore_test_missing"
	FindingRestoreTestStale         = "restore_test_stale"
	FindingObjectiveMissing         = "objective_missing"
	FindingRTOEvidenceMissing       = "rto_evidence_missing"
	FindingRTOExceedsObjective      = "rto_exceeds_objective"
	FindingRPOEvidenceMissing       = "rpo_evidence_missing"
	FindingRPOExceedsObjective      = "rpo_exceeds_objective"
	FindingDependencyGraphInvalid   = "dependency_graph_invalid"
	FindingNoIndependentLocation    = "no_independent_recovery_location"
	FindingBreakGlassMissing        = "break_glass_missing"
	FindingBreakGlassDependent      = "break_glass_control_plane_dependent"
	FindingOfflineBundleMissing     = "offline_restore_bundle_missing"
	FindingOfflineBundleIncomplete  = "offline_restore_bundle_incomplete"
)

// Evaluator evaluates self-DR readiness with an injectable clock.
type Evaluator struct {
	now     func() time.Time
	planner *Planner
}

// NewEvaluator constructs an Evaluator. A nil clock uses time.Now.
func NewEvaluator(clock func() time.Time) *Evaluator {
	if clock == nil {
		clock = time.Now
	}
	return &Evaluator{now: clock, planner: NewPlanner()}
}

// EvaluateSelfDR evaluates a profile with the default evaluator.
func EvaluateSelfDR(profile SelfDRProfile) ReadinessAssessment {
	return NewEvaluator(nil).Evaluate(profile)
}

// Evaluate checks every required control-plane component, global independent
// recovery controls, and the dependency graph. It returns findings instead of
// errors so callers can present all gaps in one report.
func (e *Evaluator) Evaluate(profile SelfDRProfile) ReadinessAssessment {
	clock := e.now
	if clock == nil {
		clock = time.Now
	}
	planner := e.planner
	if planner == nil {
		planner = NewPlanner()
	}

	now := clock()
	assessment := ReadinessAssessment{
		ProfileID:   profile.ID,
		EvaluatedAt: now,
		Verdict:     VerdictReady,
	}

	requiredKinds := effectiveRequiredKinds(profile)
	requiredSet := componentKindSet(requiredKinds)
	byKind := make(map[ComponentKind]int, len(profile.Components))
	for _, component := range profile.Components {
		byKind[component.Kind]++
	}
	for _, kind := range requiredKinds {
		if byKind[kind] == 0 {
			assessment.addFinding(Finding{
				Code:          FindingMissingRequiredComponent,
				Severity:      SeverityCritical,
				ComponentKind: kind,
				Message:       fmt.Sprintf("required control-plane component %q is not present", kind),
			})
		}
	}

	window := profile.RestoreTestWindow
	if window <= 0 {
		window = DefaultRestoreTestWindow
	}
	for _, component := range requiredComponents(profile.Components, requiredSet) {
		assessment.evaluateComponent(component, now, window)
	}

	plan, err := planner.Plan(profile)
	if err != nil {
		assessment.addFinding(Finding{
			Code:     FindingDependencyGraphInvalid,
			Severity: SeverityCritical,
			Message:  err.Error(),
		})
	} else {
		assessment.RestorePlan = plan
	}

	if !hasIndependentLocation(profile.RecoveryLocations) {
		assessment.addFinding(Finding{
			Code:     FindingNoIndependentLocation,
			Severity: SeverityCritical,
			Message:  "profile has no available recovery location independent of the control plane",
		})
	}

	if !profile.BreakGlass.Available {
		assessment.addFinding(Finding{
			Code:     FindingBreakGlassMissing,
			Severity: SeverityCritical,
			Message:  "break-glass access is not available",
		})
	} else if !profile.BreakGlass.ControlPlaneIndependent {
		assessment.addFinding(Finding{
			Code:     FindingBreakGlassDependent,
			Severity: SeverityCritical,
			Message:  "break-glass access depends on the control plane it must recover",
		})
	}

	if !profile.OfflineBundle.Available {
		assessment.addFinding(Finding{
			Code:     FindingOfflineBundleMissing,
			Severity: SeverityCritical,
			Message:  "offline restore bundle is not available",
		})
	} else if !profile.OfflineBundle.Complete {
		assessment.addFinding(Finding{
			Code:     FindingOfflineBundleIncomplete,
			Severity: SeverityCritical,
			Message:  "offline restore bundle is not complete",
		})
	}

	assessment.Verdict = verdictForFindings(assessment.Findings)
	return assessment
}

func (a *ReadinessAssessment) evaluateComponent(component Component, now time.Time, window time.Duration) {
	if !component.Backup.Available {
		a.componentFinding(component, FindingBackupMissing, SeverityCritical, "backup evidence is not available")
	} else {
		if !component.Backup.Immutable {
			a.componentFinding(component, FindingBackupNotImmutable, SeverityCritical, "backup evidence is not immutable")
		}
		if !component.Backup.Encrypted {
			a.componentFinding(component, FindingBackupNotEncrypted, SeverityCritical, "backup evidence is not encrypted")
		}
	}

	if !component.Restore.Passed {
		a.componentFinding(component, FindingRestoreTestFailed, SeverityCritical, "restore test has not passed")
	} else if component.Restore.TestedAt.IsZero() {
		a.componentFinding(component, FindingRestoreTestMissing, SeverityCritical, "restore test timestamp is missing")
	} else if now.Sub(component.Restore.TestedAt) > window {
		a.componentFinding(component, FindingRestoreTestStale, SeverityCritical, "restore test is outside the accepted freshness window")
	}

	if component.Objective.RTOSeconds <= 0 || component.Objective.RPOSeconds <= 0 {
		a.componentFinding(component, FindingObjectiveMissing, SeverityCritical, "recovery objectives must include positive RTO and RPO seconds")
		return
	}

	if component.Restore.Passed {
		if component.Restore.RTOSeconds <= 0 {
			a.componentFinding(component, FindingRTOEvidenceMissing, SeverityCritical, "restore evidence does not prove RTO coverage")
		} else if component.Restore.RTOSeconds > component.Objective.RTOSeconds {
			a.componentFinding(component, FindingRTOExceedsObjective, SeverityCritical, "restore RTO exceeds the component objective")
		}
		if component.Restore.RPOSeconds > 0 && component.Restore.RPOSeconds > component.Objective.RPOSeconds {
			a.componentFinding(component, FindingRPOExceedsObjective, SeverityCritical, "restore RPO exceeds the component objective")
		}
	}

	if component.Backup.Available {
		if component.Backup.MaxRPOSeconds <= 0 {
			a.componentFinding(component, FindingRPOEvidenceMissing, SeverityCritical, "backup evidence does not prove RPO coverage")
		} else if component.Backup.MaxRPOSeconds > component.Objective.RPOSeconds {
			a.componentFinding(component, FindingRPOExceedsObjective, SeverityCritical, "backup RPO exceeds the component objective")
		}
	}
}

func (a *ReadinessAssessment) componentFinding(component Component, code string, severity Severity, message string) {
	a.addFinding(Finding{
		Code:          code,
		Severity:      severity,
		ComponentID:   component.ID,
		ComponentKind: component.Kind,
		Message:       message,
	})
}

func (a *ReadinessAssessment) addFinding(f Finding) {
	a.Findings = append(a.Findings, f)
}

func effectiveRequiredKinds(profile SelfDRProfile) []ComponentKind {
	if len(profile.RequiredKinds) == 0 {
		return RequiredComponentKinds()
	}
	out := append([]ComponentKind(nil), profile.RequiredKinds...)
	return out
}

func componentKindSet(kinds []ComponentKind) map[ComponentKind]struct{} {
	out := make(map[ComponentKind]struct{}, len(kinds))
	for _, kind := range kinds {
		out[kind] = struct{}{}
	}
	return out
}

func requiredComponents(components []Component, requiredKinds map[ComponentKind]struct{}) []Component {
	out := make([]Component, 0, len(components))
	for _, component := range components {
		_, requiredKind := requiredKinds[component.Kind]
		if component.Required || requiredKind {
			out = append(out, component)
		}
	}
	sortComponents(out)
	return out
}

func sortComponents(components []Component) {
	sort.Slice(components, func(i, j int) bool {
		return componentLess(components[i], components[j])
	})
}

func hasIndependentLocation(locations []RecoveryLocation) bool {
	for _, location := range locations {
		if location.Available && location.Independent {
			return true
		}
	}
	return false
}

func verdictForFindings(findings []Finding) Verdict {
	verdict := VerdictReady
	for _, finding := range findings {
		switch finding.Severity {
		case SeverityCritical:
			return VerdictNotReady
		case SeverityWarning:
			verdict = VerdictDegraded
		}
	}
	return verdict
}
