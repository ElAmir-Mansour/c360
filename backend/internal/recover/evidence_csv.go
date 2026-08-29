package recover

import (
	"bytes"
	"encoding/csv"
	"strconv"
	"time"
)

// RenderEvidenceCSV renders an EvidenceReport as a single regulator-ready CSV
// document. It is a flat, section-tagged layout (a "section" column groups the
// header block, the runbook RTO-vs-RTA block, the approvals, the integrity
// checks, and the full timeline) so the whole record is one downloadable file
// that opens cleanly in any spreadsheet. Every value comes from the report's real
// data; there are no placeholder rows.
func RenderEvidenceCSV(rep *EvidenceReport) ([]byte, error) {
	var buf bytes.Buffer
	w := csv.NewWriter(&buf)

	write := func(rec ...string) error { return w.Write(rec) }

	// Column header: a stable schema a regulator's tooling can parse.
	if err := write("section", "field", "value", "detail"); err != nil {
		return nil, err
	}

	// --- Header section: the event identity + provenance. --------------------
	header := [][2]string{
		{"event_id", rep.EventID.String()},
		{"tenant_id", rep.TenantID.String()},
		{"sub_solution", rep.SubSolution},
		{"application_id", rep.ApplicationID},
		{"application_key", rep.ApplicationKey},
		{"application_name", rep.ApplicationName},
		{"recovery_tier", rep.RecoveryTier},
		{"generated_at", fmtTime(rep.GeneratedAt)},
	}
	for _, kv := range header {
		if err := write("report", kv[0], kv[1], ""); err != nil {
			return nil, err
		}
	}

	if rep.Proof != nil {
		proof := [][2]string{
			{"status", rep.Proof.Status},
			{"reason", rep.Proof.Reason},
			{"payload_hash_algorithm", rep.Proof.PayloadHashAlgorithm},
			{"payload_hash", rep.Proof.PayloadHash},
			{"generated_at", fmtTime(rep.Proof.GeneratedAt)},
			{"generated_by", rep.Proof.GeneratedBy},
			{"signature_status", rep.Proof.Signature.Status},
			{"signature_algorithm", rep.Proof.Signature.Algorithm},
		}
		for _, kv := range proof {
			if err := write("proof", kv[0], kv[1], ""); err != nil {
				return nil, err
			}
		}
		if rep.Proof.HashChain != nil {
			hc := rep.Proof.HashChain
			rows := [][2]string{
				{"ledger", hc.Ledger},
				{"entry_type", hc.EntryType},
				{"subject_id", hc.SubjectID},
				{"seq", strconv.FormatInt(hc.Seq, 10)},
				{"previous_hash", hc.PreviousHash},
				{"entry_hash", hc.EntryHash},
				{"anchored_root", hc.AnchoredRoot},
				{"root_hash", hc.RootHash},
			}
			for _, kv := range rows {
				if err := write("proof_hash_chain", kv[0], kv[1], ""); err != nil {
					return nil, err
				}
			}
		}
		if rep.Proof.Anchor != nil {
			a := rep.Proof.Anchor
			rows := [][2]string{
				{"status", a.Status},
				{"from_seq", fmtInt64(a.FromSeq)},
				{"to_seq", fmtInt64(a.ToSeq)},
				{"merkle_root", a.MerkleRoot},
				{"worm_object_key", a.WORMObjectKey},
				{"worm_version_id", a.WORMVersionID},
			}
			for _, kv := range rows {
				if err := write("proof_anchor", kv[0], kv[1], ""); err != nil {
					return nil, err
				}
			}
		}
	}

	// --- Runbook execution + RTO vs RTA. -------------------------------------
	if rep.RunbookExecution != nil {
		e := rep.RunbookExecution
		rows := [][2]string{
			{"run_id", e.RunID.String()},
			{"runbook_id", e.RunbookID.String()},
			{"runbook_name", e.RunbookName},
			{"mode", e.Mode},
			{"status", e.Status},
			{"succeeded", strconv.FormatBool(e.Succeeded)},
			{"started_at", fmtTime(e.StartedAt)},
			{"completed_at", fmtTimePtr(e.CompletedAt)},
			{"rto_target_seconds", strconv.Itoa(e.RTOTargetSeconds)},
			{"rta_actual_seconds", fmtIntPtr(e.RTAActualSeconds)},
			{"rta_breach", strconv.FormatBool(e.RTABreach)},
			{"breach_seconds", strconv.Itoa(e.BreachSeconds)},
		}
		for _, kv := range rows {
			if err := write("runbook_execution", kv[0], kv[1], ""); err != nil {
				return nil, err
			}
		}
	}

	// --- Approvals. ----------------------------------------------------------
	for i := range rep.Approvals {
		a := &rep.Approvals[i]
		if err := write("approval", a.Action, a.Approver, approvalDetail(a)); err != nil {
			return nil, err
		}
	}

	// --- Integrity checks (cyber recovery). ----------------------------------
	for i := range rep.IntegrityChecks {
		c := &rep.IntegrityChecks[i]
		val := c.Verdict
		detail := "passed=" + strconv.FormatBool(c.Passed) + "; checked_at=" + fmtTime(c.CheckedAt)
		if c.ScanID != "" {
			detail += "; scan_id=" + c.ScanID
		}
		if c.Detail != "" {
			detail += "; " + c.Detail
		}
		if err := write("integrity_check", "verdict", val, detail); err != nil {
			return nil, err
		}
	}

	// --- Full timeline (chronological). --------------------------------------
	for i := range rep.Timeline {
		t := &rep.Timeline[i]
		detail := t.Summary
		if t.Actor != "" {
			detail = "actor=" + t.Actor + "; " + detail
		}
		if err := write("timeline", fmtTime(t.At), t.Action, detail); err != nil {
			return nil, err
		}
	}

	w.Flush()
	if err := w.Error(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func approvalDetail(a *Approval) string {
	out := "approved_at=" + fmtTime(a.ApprovedAt)
	if a.ScanID != "" {
		out += "; scan_id=" + a.ScanID
	}
	if a.Note != "" {
		out += "; note=" + a.Note
	}
	return out
}

func fmtTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

func fmtTimePtr(t *time.Time) string {
	if t == nil {
		return ""
	}
	return fmtTime(*t)
}

func fmtIntPtr(n *int) string {
	if n == nil {
		return ""
	}
	return strconv.Itoa(*n)
}

func fmtInt64(n int64) string {
	if n == 0 {
		return ""
	}
	return strconv.FormatInt(n, 10)
}
