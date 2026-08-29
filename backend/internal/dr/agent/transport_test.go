package agent

import (
	"context"
	"crypto/tls"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/datastream/core"
	dringest "github.com/clario360/platform/internal/dr/ingest"
)

// testDEK returns a deterministic 32-byte AES-256 key.
func testDEK() []byte {
	k := make([]byte, core.AESKeySize256)
	for i := range k {
		k[i] = byte(i*7 + 1)
	}
	return k
}

// ingestTestServer mounts the real DR ingest handler behind a plain HTTP test
// server. It injects a fixed authenticated identity (the production server does
// this via mTLS middleware) so the test exercises the REAL frame intake +
// apply + ack wire path of internal/dr/ingest. It is not a stub: every frame
// flows through the genuine StreamTransport decode/decrypt and the recording
// applier records exactly what the control plane would apply.
type ingestTestServer struct {
	srv      *httptest.Server
	applier  *recordingApplier
	cp       *core.MemoryCheckpointer
	identity dringest.Identity
}

type recordingApplier struct {
	mu   sync.Mutex
	seqs []uint64
}

func (r *recordingApplier) Apply(_ context.Context, f core.Frame) (uint64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.seqs = append(r.seqs, f.Seq)
	return f.Seq, nil
}
func (r *recordingApplier) Kind() core.FrameKind            { return core.FrameKindWAL }
func (r *recordingApplier) AcceptsKind(core.FrameKind) bool { return true }
func (r *recordingApplier) snapshot() []uint64 {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]uint64, len(r.seqs))
	copy(out, r.seqs)
	return out
}

type fixedDEKProvider struct{ dek []byte }

func (f fixedDEKProvider) DEK(context.Context, dringest.Identity, string) ([]byte, error) {
	return f.dek, nil
}

type fixedApplierFactory struct{ a core.Applier }

func (f fixedApplierFactory) ApplierFor(context.Context, dringest.Identity, string) (core.Applier, error) {
	return f.a, nil
}

type fixedCheckpointerFactory struct{ cp core.Checkpointer }

func (f fixedCheckpointerFactory) CheckpointerFor(context.Context, dringest.Identity, string) (core.Checkpointer, error) {
	return f.cp, nil
}

func newIngestTestServer(t *testing.T, dek []byte) *ingestTestServer {
	t.Helper()
	applier := &recordingApplier{}
	cp := core.NewMemoryCheckpointer()
	identity := dringest.Identity{AgentID: uuid.New(), TenantID: uuid.New()}

	handler := dringest.NewHandler(dringest.Dependencies{
		DEKProvider: fixedDEKProvider{dek: dek},
		Appliers:    fixedApplierFactory{a: applier},
		Checkpoints: fixedCheckpointerFactory{cp: cp},
		Now:         func() time.Time { return time.Unix(1700000000, 0).UTC() },
	})

	// Inject the authenticated identity (mTLS middleware does this in production).
	inject := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := dringest.WithIdentity(r.Context(), identity)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
	routes := handler.Routes()
	srv := httptest.NewServer(inject(routes))
	t.Cleanup(srv.Close)
	return &ingestTestServer{srv: srv, applier: applier, cp: cp, identity: identity}
}

func TestShipTransport_ShipsFramesAndObservesAcks(t *testing.T) {
	dek := testDEK()
	server := newIngestTestServer(t, dek)

	var ackMu sync.Mutex
	var lastAck uint64
	var lastCheckpoint Checkpoint
	ship, err := NewShipTransport(ShipConfig{
		IngestURL:          server.srv.URL,
		StreamID:           "stream-1",
		DEK:                dek,
		InsecureSkipVerify: true, // plain-HTTP test server (no TLS); link path identical
	})
	if err != nil {
		t.Fatalf("NewShipTransport: %v", err)
	}
	// The test server is plain HTTP, so swap in its client (no TLS) to drive the
	// exact same Ship wire path without standing up certs in the unit test.
	ship.client = server.srv.Client()
	ship.SetAckObserver(func(seq uint64) {
		ackMu.Lock()
		if seq > lastAck {
			lastAck = seq
		}
		ackMu.Unlock()
	})
	ship.SetCheckpointObserver(func(cp Checkpoint) {
		ackMu.Lock()
		if cp.AckedSeq > lastCheckpoint.AckedSeq {
			lastCheckpoint = cp
		}
		ackMu.Unlock()
	})

	frames := make(chan core.Frame)
	go func() {
		defer close(frames)
		for i := 1; i <= 5; i++ {
			frames <- core.Frame{
				StreamID:  "stream-1",
				Seq:       uint64(i),
				Kind:      core.FrameKindWAL,
				Payload:   []byte{byte(i), byte(i * 2)},
				SourceLSN: fmt.Sprintf("0/%X", i*16),
				EmittedAt: time.Now().UTC(),
			}
		}
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := ship.Ship(ctx, frames); err != nil {
		t.Fatalf("Ship: %v", err)
	}

	if got := server.applier.snapshot(); len(got) != 5 {
		t.Fatalf("control plane applied %v, want 5 frames 1..5", got)
	}
	if rf := ship.ResumeFrom(); rf != 5 {
		t.Fatalf("ResumeFrom() = %d, want 5", rf)
	}
	ackMu.Lock()
	gotAck := lastAck
	ackMu.Unlock()
	if gotAck != 5 {
		t.Fatalf("observed ack = %d, want 5 (the ack observer must see the durable cursor)", gotAck)
	}
	if lastCheckpoint.AckedSeq != 5 || lastCheckpoint.SourceLSN != "0/50" {
		t.Fatalf("checkpoint observer = %+v, want seq 5 source_lsn 0/50", lastCheckpoint)
	}
}

func TestShipTransportUsesDynamicClientCertProvider(t *testing.T) {
	dek := testDEK()
	current := tls.Certificate{Certificate: [][]byte{[]byte("first")}}
	ship, err := NewShipTransport(ShipConfig{
		IngestURL:          "https://dr.example.com:8098",
		StreamID:           "stream-1",
		DEK:                dek,
		InsecureSkipVerify: true,
		ClientCertProvider: func() (tls.Certificate, error) {
			return current, nil
		},
	})
	if err != nil {
		t.Fatalf("NewShipTransport: %v", err)
	}
	httpTransport, ok := ship.client.Transport.(*http.Transport)
	if !ok || httpTransport.TLSClientConfig.GetClientCertificate == nil {
		t.Fatal("dynamic client cert provider was not wired into TLS config")
	}
	current = tls.Certificate{Certificate: [][]byte{[]byte("second")}}
	cert, err := httpTransport.TLSClientConfig.GetClientCertificate(nil)
	if err != nil {
		t.Fatalf("GetClientCertificate: %v", err)
	}
	if string(cert.Certificate[0]) != "second" {
		t.Fatalf("cert = %q, want latest provider value", cert.Certificate[0])
	}
	if !httpTransport.DisableKeepAlives {
		t.Fatal("transport must disable keep-alives so reconnects handshake with renewed certs")
	}
}
