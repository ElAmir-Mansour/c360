package bcm

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// Sentinel errors the store and service surface; the router maps them to HTTP
// status codes.
var (
	// ErrPackNotFound is returned when a requested pack key is not in the catalog.
	ErrPackNotFound = errors.New("bcm: pack not found")
	// ErrAssessmentNotFound is returned when a requested assessment id does not
	// exist in the tenant's scope.
	ErrAssessmentNotFound = errors.New("bcm: assessment not found")
	// ErrGroupNotFound is returned when an assessment is requested for a
	// consistency group that does not exist in the tenant's scope.
	ErrGroupNotFound = errors.New("bcm: consistency group not found")
)

// StoredAssessment is the persisted header row of a BCM assessment
// (dr_bcm_assessment). The scored detail (gaps, evidence refs) lives in the
// per-control result rows; this row carries the aggregate so listing/reporting
// is cheap. It mirrors the in-memory Assessment but with persistence identity
// and tenant fields.
type StoredAssessment struct {
	ID            uuid.UUID `json:"id"`
	TenantID      uuid.UUID `json:"tenant_id"`
	GroupID       uuid.UUID `json:"group_id"`
	PackKey       string    `json:"pack_key"`
	Standard      string    `json:"standard"`
	PackVersion   string    `json:"pack_version"`
	Score         float64   `json:"score"`
	Compliant     bool      `json:"compliant"`
	TotalControls int       `json:"total_controls"`
	Satisfied     int       `json:"satisfied"`
	Partial       int       `json:"partial"`
	Failed        int       `json:"failed"`
	CreatedBy     uuid.UUID `json:"created_by"`
	CreatedAt     time.Time `json:"created_at"`
}

// StoredControlResult is the persisted per-control outcome
// (dr_bcm_control_result). EvidenceRefs is stored as a JSONB array.
type StoredControlResult struct {
	ID           uuid.UUID `json:"id"`
	AssessmentID uuid.UUID `json:"assessment_id"`
	TenantID     uuid.UUID `json:"tenant_id"`
	ControlCode  string    `json:"control_code"`
	ControlTitle string    `json:"control_title"`
	Verdict      Verdict   `json:"verdict"`
	Reason       string    `json:"reason"`
	Mandatory    bool      `json:"mandatory"`
	Weight       int       `json:"weight"`
	EvidenceRefs []string  `json:"evidence_refs"`
}

// AssessmentReport is the full GET /bcm/assessments/{id} response: the persisted
// header, every control result, and the derived gap list (controls not fully
// satisfied). It is reconstructed from the stored rows, so a report is
// reproducible without re-running the scorer.
type AssessmentReport struct {
	Assessment     StoredAssessment      `json:"assessment"`
	ControlResults []StoredControlResult `json:"control_results"`
	Gaps           []Gap                 `json:"gaps"`
}

// gapsFromResults derives the gap list from stored control results: every
// control whose verdict is not satisfied, in stored order.
func gapsFromResults(results []StoredControlResult) []Gap {
	gaps := make([]Gap, 0)
	for _, r := range results {
		if r.Verdict == VerdictSatisfied {
			continue
		}
		gaps = append(gaps, Gap{
			Code:      r.ControlCode,
			Title:     r.ControlTitle,
			Verdict:   r.Verdict,
			Reason:    r.Reason,
			Mandatory: r.Mandatory,
		})
	}
	return gaps
}
