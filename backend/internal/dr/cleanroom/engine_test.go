package cleanroom

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/google/uuid"
)

// memChunkReader restores chunks from an in-memory map, exactly as the
// recovery-point store's ReadSealedChunk would after download+decrypt. It lets
// the engine test run the REAL restore path (write to a real sandbox temp dir,
// real sha256, real chain hash, real malware scan) without an object store.
type memChunkReader struct {
	// data maps stream ID -> restored plaintext bytes.
	data map[string][]byte
	// err, when set for a stream, simulates a download/decrypt failure.
	err map[string]error
}

func (m memChunkReader) ReadSealedChunk(_ context.Context, _ uuid.UUID, _ uuid.UUID, streamID string) ([]byte, error) {
	if e, ok := m.err[streamID]; ok && e != nil {
		return nil, e
	}
	b, ok := m.data[streamID]
	if !ok {
		return nil, errors.New("no such chunk")
	}
	out := make([]byte, len(b))
	copy(out, b)
	return out, nil
}

// sealedContentHash recomputes the recovery_point.content_hash the seal path
// would have stored for these chunks, so the engine's integrity check has a real
// reference to compare against (chain of per-chunk sha256 hex over sorted stream
// ids, NUL-separated).
func sealedContentHash(data map[string][]byte) string {
	hashes := make(map[string]string, len(data))
	for streamID, b := range data {
		hashes[streamID] = sha256Hex(b)
	}
	return chainContentHash(hashes)
}

func newRefFor(data map[string][]byte, contentHash string) RecoveryPointRef {
	keys := make(map[string]string, len(data))
	for streamID := range data {
		keys[streamID] = "tenant/2026/06/" + streamID + "/marker/obj.chunk"
	}
	return RecoveryPointRef{
		ID:          uuid.New(),
		GroupID:     uuid.New(),
		ContentHash: contentHash,
		ObjectKeys:  keys,
	}
}

func TestEngine_Validate(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	tenantID := uuid.New()

	cleanData := map[string][]byte{
		"stream-db":    []byte("rows=1000;checksum=abc;applied_seq=42"),
		"stream-files": []byte("file=/etc/app.conf;bytes=2048;ok=true"),
	}
	cleanHash := sealedContentHash(cleanData)

	eicarData := map[string][]byte{
		"stream-db":    []byte("rows=1000;checksum=abc"),
		"stream-files": []byte("infected payload:" + EICAR),
	}
	eicarHash := sealedContentHash(eicarData) // matches bytes, so integrity passes; malware fails

	tests := []struct {
		name        string
		data        map[string][]byte
		readErr     map[string]error
		contentHash string
		wantVerdict string
		// wantThreat, when set, is asserted in the offending chunk's finding.
		wantThreat string
	}{
		{
			name:        "clean payload passes",
			data:        cleanData,
			contentHash: cleanHash,
			wantVerdict: VerdictClean,
		},
		{
			name:        "eicar payload fails as malware",
			data:        eicarData,
			contentHash: eicarHash,
			wantVerdict: VerdictMalware,
			wantThreat:  "Dr.Test.EICAR",
		},
		{
			name:        "tampered chunk fails integrity",
			data:        cleanData,
			contentHash: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef00",
			wantVerdict: VerdictIntegrityFailed,
		},
		{
			name:        "unrestorable chunk yields error verdict",
			data:        cleanData,
			readErr:     map[string]error{"stream-db": errors.New("decrypt failed")},
			contentHash: cleanHash,
			wantVerdict: VerdictError,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			reader := memChunkReader{data: tt.data, err: tt.readErr}
			engine := NewEngine(reader, NewSignatureScanner())
			ref := newRefFor(tt.data, tt.contentHash)

			scan, err := engine.Validate(ctx, tenantID, ref)
			if err != nil {
				t.Fatalf("Validate returned transport error: %v", err)
			}
			if scan.Verdict != tt.wantVerdict {
				t.Fatalf("verdict: got %q want %q (detail: %s)", scan.Verdict, tt.wantVerdict, scan.Detail)
			}
			if scan.Clean() != (tt.wantVerdict == VerdictClean) {
				t.Fatalf("Clean(): got %v want %v", scan.Clean(), tt.wantVerdict == VerdictClean)
			}
			if scan.Scanner != "signature" {
				t.Fatalf("scanner: got %q want signature", scan.Scanner)
			}
			if scan.TenantID != tenantID.String() {
				t.Fatalf("tenant: got %q want %q", scan.TenantID, tenantID.String())
			}
			if scan.RecoveryPointID != ref.ID.String() {
				t.Fatalf("recovery point: got %q want %q", scan.RecoveryPointID, ref.ID.String())
			}
			if scan.FinishedAt.Before(scan.StartedAt) {
				t.Fatalf("finished_at %v before started_at %v", scan.FinishedAt, scan.StartedAt)
			}

			if tt.wantThreat != "" {
				found := false
				for _, f := range scan.Findings {
					if !f.Clean && f.Threat == tt.wantThreat {
						found = true
					}
				}
				if !found {
					t.Fatalf("expected a finding with threat %q, findings: %+v", tt.wantThreat, scan.Findings)
				}
			}

			// On a successful restore, work is quantified.
			if tt.wantVerdict != VerdictError {
				if scan.ChunksScanned != len(tt.data) {
					t.Fatalf("chunks_scanned: got %d want %d", scan.ChunksScanned, len(tt.data))
				}
				if scan.BytesScanned <= 0 {
					t.Fatalf("bytes_scanned should be > 0, got %d", scan.BytesScanned)
				}
			}
		})
	}
}

func TestEngine_Validate_IntegrityChecksEachChunk(t *testing.T) {
	t.Parallel()
	// Two clean chunks; flip one byte of the restored bytes for one stream so the
	// recomputed chain diverges from the sealed hash even though the data is
	// otherwise malware-clean. Proves integrity is enforced independently.
	original := map[string][]byte{
		"a": []byte("alpha-chunk-contents"),
		"b": []byte("beta-chunk-contents"),
	}
	sealed := sealedContentHash(original)

	tampered := map[string][]byte{
		"a": []byte("alpha-chunk-contents"),
		"b": []byte("beta-chunk-contentX"), // one byte changed at rest
	}
	engine := NewEngine(memChunkReader{data: tampered}, NewSignatureScanner())
	ref := newRefFor(tampered, sealed)

	scan, err := engine.Validate(context.Background(), uuid.New(), ref)
	if err != nil {
		t.Fatalf("Validate error: %v", err)
	}
	if scan.Verdict != VerdictIntegrityFailed {
		t.Fatalf("verdict: got %q want integrity_failed (detail %s)", scan.Verdict, scan.Detail)
	}
	for _, f := range scan.Findings {
		if f.IntegrityOK {
			t.Fatalf("expected all findings to be integrity-failed on a broken chain, got OK for %s", f.StreamID)
		}
	}
}

func TestEngine_Validate_NoChunksIsError(t *testing.T) {
	t.Parallel()
	engine := NewEngine(memChunkReader{data: map[string][]byte{}}, NewSignatureScanner())
	ref := RecoveryPointRef{ID: uuid.New(), GroupID: uuid.New(), ObjectKeys: map[string]string{}}
	scan, err := engine.Validate(context.Background(), uuid.New(), ref)
	if err != nil {
		t.Fatalf("Validate error: %v", err)
	}
	if scan.Verdict != VerdictError {
		t.Fatalf("empty point verdict: got %q want error", scan.Verdict)
	}
}

func TestEngine_Validate_ScannerUnavailableIsError(t *testing.T) {
	t.Parallel()
	data := map[string][]byte{"s": []byte("clean bytes")}
	engine := NewEngine(memChunkReader{data: data}, NewClamAVScanner(fakeClamd{
		err: errors.New("virus scan unavailable: clamd connect refused"),
	}))
	ref := newRefFor(data, sealedContentHash(data))
	scan, err := engine.Validate(context.Background(), uuid.New(), ref)
	if err != nil {
		t.Fatalf("Validate error: %v", err)
	}
	if scan.Verdict != VerdictError {
		t.Fatalf("scanner-unavailable verdict: got %q want error (detail %s)", scan.Verdict, scan.Detail)
	}
}

func TestEngine_Validate_SandboxCleanedUp(t *testing.T) {
	t.Parallel()
	data := map[string][]byte{"s": []byte("clean bytes")}
	engine := NewEngine(memChunkReader{data: data}, NewSignatureScanner())
	ref := newRefFor(data, sealedContentHash(data))
	scan, err := engine.Validate(context.Background(), uuid.New(), ref)
	if err != nil {
		t.Fatalf("Validate error: %v", err)
	}
	// The sandbox path recorded in findings must no longer exist after Validate
	// returns (the clean room is torn down).
	for _, f := range scan.Findings {
		if f.SandboxPath == "" {
			continue
		}
		if _, statErr := os.Stat(f.SandboxPath); !os.IsNotExist(statErr) {
			t.Fatalf("sandbox file %s should have been cleaned up, stat err: %v", f.SandboxPath, statErr)
		}
	}
}

func TestEngine_Validate_RequiresDeps(t *testing.T) {
	t.Parallel()
	if _, err := NewEngine(nil, NewSignatureScanner()).Validate(context.Background(), uuid.New(), RecoveryPointRef{ID: uuid.New()}); err == nil {
		t.Fatal("expected error for nil reader")
	}
	if _, err := NewEngine(memChunkReader{}, nil).Validate(context.Background(), uuid.New(), RecoveryPointRef{ID: uuid.New()}); err == nil {
		t.Fatal("expected error for nil scanner")
	}
	if _, err := NewEngine(memChunkReader{}, NewSignatureScanner()).Validate(context.Background(), uuid.New(), RecoveryPointRef{}); err == nil {
		t.Fatal("expected error for nil recovery point id")
	}
}
