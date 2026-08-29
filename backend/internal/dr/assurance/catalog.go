package assurance

// ControlInfo is one entry of the static assurance control catalog: the stable
// code, human title, scoring weight, and the severity a failure carries. It is
// the read-only description of what Evaluate checks, surfaced so a UI can render
// the control set without running an evaluation.
type ControlInfo struct {
	Code         string   `json:"code"`
	Title        string   `json:"title"`
	Weight       int      `json:"weight"`
	FailSeverity Severity `json:"fail_severity"`
}

// Controls returns the static assurance control catalog in deterministic
// evaluation order. The control set is code-of-record (assuranceControls), so
// this projection always matches what Evaluate scores.
func Controls() []ControlInfo {
	out := make([]ControlInfo, 0, len(assuranceControls))
	for _, c := range assuranceControls {
		out = append(out, ControlInfo{
			Code:         c.code,
			Title:        c.title,
			Weight:       c.weight,
			FailSeverity: c.failSeverity,
		})
	}
	return out
}
