package assurance

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// Sentinel errors the store and service surface; the router maps them to HTTP
// status codes.
var (
	// ErrGroupNotFound is returned when an evaluation is requested for a
	// consistency group that does not exist in the tenant's scope.
	ErrGroupNotFound = errors.New("assurance: consistency group not found")
	// ErrAssessmentNotFound is returned when a requested assessment id does not
	// exist in the tenant's scope.
	ErrAssessmentNotFound = errors.New("assurance: assessment not found")
	// ErrServiceUnavailable is returned when the assurance service is mounted
	// without the runtime dependencies needed for the requested operation.
	ErrServiceUnavailable = errors.New("assurance: service dependencies unavailable")
)

// StoredAssessment is the persisted header row of one recovery-assurance
// evaluation (dr_assurance_assessment). The scored detail (per-control verdicts,
// findings, evidence refs) lives in the per-control result rows; this row carries
// the aggregate so listing/reporting is cheap. It mirrors the in-memory
// AssuranceAssessment but with persistence identity and tenant fields.
type StoredAssessment struct {
	ID          uuid.UUID `json:"id"`
	TenantID    uuid.UUID `json:"tenant_id"`
	GroupID     uuid.UUID `json:"group_id"`
	ProfileID   string    `json:"profile_id,omitempty"`
	WorkloadID  string    `json:"workload_id,omitempty"`
	Score       float64   `json:"score"`
	Verdict     Verdict   `json:"verdict"`
	TotalChecks int       `json:"total_checks"`
	Satisfied   int       `json:"satisfied"`
	Partial     int       `json:"partial"`
	Failed      int       `json:"failed"`
	// EvidenceSnapshot is the normalised evidence bundle used to compute this
	// score, stored with the header so the assessment remains auditable even
	// after source tables change.
	EvidenceSnapshot AssuranceEvidence `json:"evidence_snapshot"`
	CreatedBy        uuid.UUID         `json:"created_by"`
	CreatedAt        time.Time         `json:"created_at"`
}

// StoredResult is the persisted per-control outcome (dr_assurance_result).
// EvidenceRefs is stored as a JSONB array. The rows are inserted in deterministic
// control order so a report reconstructs the same ordering the evaluator emits.
type StoredResult struct {
	ID             uuid.UUID `json:"id"`
	AssessmentID   uuid.UUID `json:"assessment_id"`
	TenantID       uuid.UUID `json:"tenant_id"`
	Code           string    `json:"code"`
	Title          string    `json:"title"`
	Verdict        Verdict   `json:"verdict"`
	Severity       Severity  `json:"severity,omitempty"`
	Weight         int       `json:"weight"`
	Message        string    `json:"message,omitempty"`
	Recommendation string    `json:"recommendation,omitempty"`
	EvidenceRefs   []string  `json:"evidence_refs"`
}

// AssessmentReport is the full GET /assurance/assessments/{id} response: the
// persisted header, every control result, and the derived findings +
// machine-readable recommendations. It is reconstructed from the stored rows, so
// a report is reproducible without re-running the evaluator.
type AssessmentReport struct {
	Assessment      StoredAssessment `json:"assessment"`
	Results         []StoredResult   `json:"results"`
	Findings        []Finding        `json:"findings"`
	Recommendations []string         `json:"recommendations"`
}

// toStoredResults maps the scored check results to persistence rows. The
// assessment_id and tenant_id are filled by the store at insert time.
func toStoredResults(in []CheckResult) []StoredResult {
	out := make([]StoredResult, 0, len(in))
	for _, r := range in {
		refs := r.EvidenceRefs
		if refs == nil {
			refs = []string{}
		}
		out = append(out, StoredResult{
			Code:           r.Code,
			Title:          r.Title,
			Verdict:        r.Verdict,
			Severity:       r.Severity,
			Weight:         r.Weight,
			Message:        r.Message,
			Recommendation: r.Recommendation,
			EvidenceRefs:   refs,
		})
	}
	return out
}

// findingsFromResults derives the findings and the de-duplicated, control-ordered
// recommendation list from stored control results: every control whose verdict is
// not satisfied, in stored order. This reconstructs the same Findings /
// Recommendations the evaluator produced, from the persisted rows alone.
func findingsFromResults(results []StoredResult) ([]Finding, []string) {
	findings := make([]Finding, 0)
	recommendations := make([]string, 0)
	seen := make(map[string]struct{})
	for _, r := range results {
		if r.Verdict == VerdictSatisfied {
			continue
		}
		findings = append(findings, Finding{
			Code:           r.Code,
			Title:          r.Title,
			Verdict:        r.Verdict,
			Severity:       r.Severity,
			Weight:         r.Weight,
			Message:        r.Message,
			Recommendation: r.Recommendation,
			EvidenceRefs:   append([]string(nil), r.EvidenceRefs...),
		})
		if r.Recommendation != "" {
			if _, ok := seen[r.Recommendation]; !ok {
				seen[r.Recommendation] = struct{}{}
				recommendations = append(recommendations, r.Recommendation)
			}
		}
	}
	return findings, recommendations
}
