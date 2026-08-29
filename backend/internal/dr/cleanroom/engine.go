package cleanroom

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Engine performs the pure clean-room validation: restore a recovery point's
// sealed chunks into an isolated sandbox, check per-chunk integrity against the
// sealed content hash, and run the malware Scanner over every restored chunk.
// It produces a Scan verdict but does NOT persist it or emit events — that is
// the Service's job — which keeps the algorithm fully unit-testable.
type Engine struct {
	reader  ChunkReader
	scanner Scanner
	// now is injectable so tests get deterministic timestamps.
	now func() time.Time
}

// NewEngine constructs the validation engine over a chunk reader (restore path)
// and a malware Scanner. Both are required.
func NewEngine(reader ChunkReader, scanner Scanner) *Engine {
	return &Engine{
		reader:  reader,
		scanner: scanner,
		now:     func() time.Time { return time.Now().UTC() },
	}
}

// Validate restores ref's chunks into a fresh sandbox, verifies integrity and
// scans for malware, and returns a Scan verdict. The sandbox is always cleaned
// up before returning, even on error. The verdict is one of:
//
//   - VerdictError: a chunk could not be restored, or the scanner was
//     unavailable — the point is unverified and must be blocked.
//   - VerdictIntegrityFailed: a restored chunk's sha256 broke the sealed
//     content-hash chain — the bytes at rest no longer match what was sealed.
//   - VerdictMalware: a restored chunk tripped the malware Scanner.
//   - VerdictClean: every chunk restored, hashed into the sealed chain, and
//     passed the scanner.
//
// Integrity and malware are independent gates: a chunk that fails integrity is
// still scanned (so the verdict detail is complete), but the overall verdict
// fails. The first hard failure (error/integrity/malware) sets the verdict;
// remaining chunks are still recorded in findings for the audit report.
func (e *Engine) Validate(ctx context.Context, tenantID uuid.UUID, ref RecoveryPointRef) (*Scan, error) {
	if e.reader == nil {
		return nil, errors.New("cleanroom engine: chunk reader is required")
	}
	if e.scanner == nil {
		return nil, errors.New("cleanroom engine: scanner is required")
	}
	if ref.ID == uuid.Nil {
		return nil, errors.New("cleanroom engine: recovery point id is required")
	}

	started := e.now()
	scan := &Scan{
		TenantID:        tenantID.String(),
		RecoveryPointID: ref.ID.String(),
		GroupID:         ref.GroupID.String(),
		Scanner:         e.scanner.Name(),
		StartedAt:       started,
		Findings:        []ChunkVerdict{},
	}

	sandbox, err := NewSandbox(ref.ID)
	if err != nil {
		scan.Verdict = VerdictError
		scan.Detail = err.Error()
		scan.FinishedAt = e.now()
		return scan, nil
	}
	defer func() { _ = sandbox.Cleanup() }()

	ref.tenant = tenantID
	chunks, err := restore(ctx, e.reader, ref, sandbox)
	if err != nil {
		// A point with no restorable chunks (or a download/decrypt failure) cannot
		// be validated; record an error verdict so promotion is blocked.
		scan.Verdict = VerdictError
		scan.Detail = err.Error()
		scan.FinishedAt = e.now()
		return scan, nil
	}
	if len(chunks) == 0 {
		// An empty recovery point is not "clean" — there is nothing proven
		// recoverable. Block it explicitly rather than vacuously passing.
		scan.Verdict = VerdictError
		scan.Detail = "recovery point has no sealed chunks to restore"
		scan.FinishedAt = e.now()
		return scan, nil
	}

	// First pass: per-chunk sha256, integrity-chain hashes, and malware scan.
	hashByStream := make(map[string]string, len(chunks))
	var (
		firstThreat       string
		sawMalware        bool
		scannerUnavail    bool
		scannerUnavailMsg string
	)
	for _, c := range chunks {
		hashByStream[c.streamID] = c.sha256
		cv := ChunkVerdict{
			StreamID:    c.streamID,
			ObjectKey:   c.objectKey,
			SandboxPath: c.path,
			Bytes:       int64(len(c.data)),
			SHA256:      c.sha256,
			Clean:       true,
		}
		scan.BytesScanned += int64(len(c.data))
		scan.ChunksScanned++

		if scanErr := e.scanner.Scan(ctx, c.data, c.path); scanErr != nil {
			switch {
			case errors.Is(scanErr, ErrMalwareDetected):
				cv.Clean = false
				cv.Threat = VirusName(scanErr)
				sawMalware = true
				if firstThreat == "" {
					firstThreat = cv.Threat
				}
			case errors.Is(scanErr, ErrScannerUnavailable):
				cv.Clean = false
				scannerUnavail = true
				if scannerUnavailMsg == "" {
					scannerUnavailMsg = scanErr.Error()
				}
			default:
				cv.Clean = false
				scannerUnavail = true
				if scannerUnavailMsg == "" {
					scannerUnavailMsg = scanErr.Error()
				}
			}
		}
		scan.Findings = append(scan.Findings, cv)
	}

	// Integrity: recompute the chained content hash over the restored chunks and
	// compare against the sealed hash. Per-chunk IntegrityOK is set so the
	// findings show which chunk(s) diverged when the chain breaks.
	recomputed := chainContentHash(hashByStream)
	integrityOK := ref.ContentHash == "" || recomputed == ref.ContentHash
	for i := range scan.Findings {
		// When the chain matches, every chunk is integrity-clean. When it does
		// not, we cannot attribute the break to a single chunk from the chain
		// alone, so all chunks are marked failed for the chained recovery point.
		scan.Findings[i].IntegrityOK = integrityOK
	}

	scan.FinishedAt = e.now()

	// Verdict precedence: a scanner outage means the point is unverified (worst —
	// we cannot claim it is clean OR prove it is malware-free). Then integrity,
	// then malware. Clean requires all gates to pass.
	switch {
	case scannerUnavail:
		scan.Verdict = VerdictError
		scan.Detail = "malware scan could not complete: " + scannerUnavailMsg
	case !integrityOK:
		scan.Verdict = VerdictIntegrityFailed
		scan.Detail = fmt.Sprintf("restored content hash %s does not match sealed content hash %s", recomputed, ref.ContentHash)
	case sawMalware:
		scan.Verdict = VerdictMalware
		scan.Detail = "malware detected in restored chunk: " + firstThreat
	default:
		scan.Verdict = VerdictClean
		scan.Detail = fmt.Sprintf("%d chunk(s) restored, integrity-verified and malware-clean", scan.ChunksScanned)
	}

	return scan, nil
}
