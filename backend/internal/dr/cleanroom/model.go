package cleanroom

import "time"

// Verdict is the terminal outcome of a clean-room scan (mirrors the
// dr_cleanroom_scan.verdict CHECK).
const (
	// VerdictClean means integrity + malware checks all passed; the recovery
	// point may be promoted to recoverable.
	VerdictClean = "clean"
	// VerdictMalware means a scanner flagged malicious content in a restored
	// chunk; promotion is blocked.
	VerdictMalware = "malware"
	// VerdictIntegrityFailed means a restored chunk's sha256 did not match the
	// recovery point's sealed content hash; promotion is blocked.
	VerdictIntegrityFailed = "integrity_failed"
	// VerdictError means the scan could not complete (restore or scanner
	// failure); promotion is blocked because the point is unverified.
	VerdictError = "error"
)

// ChunkVerdict is per-restored-chunk detail (integrity, signature). It is also
// the structured row stored in dr_cleanroom_scan.findings.
type ChunkVerdict struct {
	// StreamID is the replication stream whose sealed chunk this is.
	StreamID string `json:"stream_id"`
	// ObjectKey is the WORM object key the chunk was restored from.
	ObjectKey string `json:"object_key"`
	// SandboxPath is the isolated temp-dir path the chunk was restored to.
	SandboxPath string `json:"sandbox_path"`
	// Bytes is the restored (plaintext) size of the chunk.
	Bytes int64 `json:"bytes"`
	// SHA256 is the sha256 hex of the restored bytes.
	SHA256 string `json:"sha256"`
	// IntegrityOK reports whether SHA256 chained into the sealed content hash.
	IntegrityOK bool `json:"integrity_ok"`
	// Clean reports whether the malware scan passed for this chunk.
	Clean bool `json:"clean"`
	// Threat is the malware label when Clean is false.
	Threat string `json:"threat,omitempty"`
}

// Scan is a recorded clean-room scan verdict (a dr_cleanroom_scan row).
type Scan struct {
	ID              string         `json:"id"`
	TenantID        string         `json:"tenant_id"`
	RecoveryPointID string         `json:"recovery_point_id"`
	GroupID         string         `json:"group_id"`
	Verdict         string         `json:"verdict"`
	Scanner         string         `json:"scanner"`
	ChunksScanned   int            `json:"chunks_scanned"`
	BytesScanned    int64          `json:"bytes_scanned"`
	Detail          string         `json:"detail"`
	Findings        []ChunkVerdict `json:"findings"`
	StartedAt       time.Time      `json:"started_at"`
	FinishedAt      time.Time      `json:"finished_at"`
}

// Clean reports whether the scan's verdict permits promoting the recovery point.
func (s *Scan) Clean() bool { return s != nil && s.Verdict == VerdictClean }
