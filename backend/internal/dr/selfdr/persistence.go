package selfdr

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// Sentinel errors the store and service surface; the router maps them to HTTP
// status codes.
var (
	// ErrAssessmentNotFound is returned when a requested assessment id does not
	// exist in the tenant's scope.
	ErrAssessmentNotFound = errors.New("selfdr: assessment not found")
	// ErrSealingNotConfigured is returned by the operational backup / offline-
	// bundle paths when no WORM sealer is wired (Vault/WORM unset). Readiness
	// assessment still works; only the seal-to-immutable-storage operations are
	// unavailable.
	ErrSealingNotConfigured = errors.New("selfdr: immutable sealing is not configured")
	// ErrEmptyProfile is returned when an assess request resolves to a profile
	// with no components (neither supplied nor baseline).
	ErrEmptyProfile = errors.New("selfdr: profile has no components")
)

// DefaultBaselineRTOSeconds and DefaultBaselineRPOSeconds seed the recovery
// objectives of an auto-generated baseline profile so a baseline assessment is
// scored against concrete objectives rather than failing objective_missing for
// every component.
const (
	DefaultBaselineRTOSeconds = 3600
	DefaultBaselineRPOSeconds = 300
)

// StoredAssessment is the persisted header of one self-DR readiness assessment
// (dr_selfdr_assessment). The findings list and restore plan are stored as JSONB
// so a report reconstructs the full assessment without re-running the evaluator;
// the severity tallies are denormalised for cheap listing.
type StoredAssessment struct {
	ID          uuid.UUID   `json:"id"`
	TenantID    uuid.UUID   `json:"tenant_id"`
	ProfileID   string      `json:"profile_id"`
	Verdict     Verdict     `json:"verdict"`
	Critical    int         `json:"critical"`
	Warning     int         `json:"warning"`
	Info        int         `json:"info"`
	Findings    []Finding   `json:"findings"`
	RestorePlan RestorePlan `json:"restore_plan"`
	CreatedBy   uuid.UUID   `json:"created_by"`
	CreatedAt   time.Time   `json:"created_at"`
}

// StoredArtifact is the durable record of one WORM-sealed self-DR artifact
// (dr_selfdr_artifact): a control-plane backup or an offline restore bundle. The
// readiness evaluator never reads WORM directly — it reads the evidence captured
// here. Evidence holds the kind-specific evidence object (BackupEvidence for a
// backup, OfflineRestoreBundle for a bundle) so profile enrichment is a single
// row read.
type StoredArtifact struct {
	ID            uuid.UUID     `json:"id"`
	TenantID      uuid.UUID     `json:"tenant_id"`
	Kind          ArtifactKind  `json:"kind"`
	ComponentID   string        `json:"component_id,omitempty"`
	ComponentKind ComponentKind `json:"component_kind,omitempty"`
	Key           string        `json:"key,omitempty"`
	URI           string        `json:"uri,omitempty"`
	VersionID     string        `json:"version_id,omitempty"`
	SHA256        string        `json:"sha256"`
	SizeBytes     int64         `json:"size_bytes"`
	CapturedAt    time.Time     `json:"captured_at"`
	RetainUntil   time.Time     `json:"retain_until,omitempty"`
	LocationID    string        `json:"location_id,omitempty"`
	Immutable     bool          `json:"immutable"`
	Encrypted     bool          `json:"encrypted"`
	Evidence      any           `json:"evidence,omitempty"`
	CreatedBy     uuid.UUID     `json:"created_by"`
	CreatedAt     time.Time     `json:"created_at"`
}

// AssessmentReport is the full GET /selfdr/assessments/{id} response. The stored
// header already carries the findings and restore plan, so the report is the
// header plus the immutable artifacts that backed the evaluated evidence.
type AssessmentReport struct {
	Assessment StoredAssessment `json:"assessment"`
	Artifacts  []StoredArtifact `json:"artifacts"`
}

// toStoredAssessment converts an evaluator ReadinessAssessment into a persistence
// header, tallying finding severities.
func toStoredAssessment(a ReadinessAssessment, tenantID, actor uuid.UUID) *StoredAssessment {
	var critical, warning, info int
	for _, f := range a.Findings {
		switch f.Severity {
		case SeverityCritical:
			critical++
		case SeverityWarning:
			warning++
		default:
			info++
		}
	}
	findings := a.Findings
	if findings == nil {
		findings = []Finding{}
	}
	return &StoredAssessment{
		TenantID:    tenantID,
		ProfileID:   a.ProfileID,
		Verdict:     a.Verdict,
		Critical:    critical,
		Warning:     warning,
		Info:        info,
		Findings:    findings,
		RestorePlan: a.RestorePlan,
		CreatedBy:   actor,
	}
}

// BaselineProfile builds a profile covering the required control-plane component
// baseline, each seeded with default recovery objectives so an operator can run a
// readiness assessment without first describing the topology. The service then
// overlays the real sealed-artifact evidence it holds; the operator-facing gaps
// (no recovery location, no break-glass, missing backups) surface as findings.
func BaselineProfile(id string) SelfDRProfile {
	if id == "" {
		id = "control-plane-baseline"
	}
	kinds := RequiredComponentKinds()
	components := make([]Component, 0, len(kinds))
	for _, kind := range kinds {
		components = append(components, Component{
			ID:       string(kind),
			Name:     string(kind),
			Kind:     kind,
			Required: true,
			Objective: RecoveryObjective{
				RTOSeconds: DefaultBaselineRTOSeconds,
				RPOSeconds: DefaultBaselineRPOSeconds,
			},
		})
	}
	return SelfDRProfile{
		ID:         id,
		Name:       "Control-plane self-DR baseline",
		Components: components,
	}
}
