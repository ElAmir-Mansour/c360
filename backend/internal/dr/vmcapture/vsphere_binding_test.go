package vmcapture_test

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/clario360/platform/internal/dr/vmcapture"
)

// vsphereFake is an in-memory vCenter REST + block-gateway double. One
// httptest.Server serves both control plane (/api/session, /api/vcenter/...) and
// data plane (/disks/...), so a single base URL drives the whole binding the way
// a real appliance + co-located gateway would. It records the headers/requests
// seen so tests can assert the real wire contract (session header, range bytes,
// basic auth) was honored.
type vsphereFake struct {
	t    *testing.T
	disk []byte // the snapshot disk bytes served over range reads

	mu               sync.Mutex
	sessionID        string
	sessionDeleted   bool
	basicAuthSeen    bool
	createdSnapshots int
	rangeRequests    int
	sessionHeaders   []string // vmware-api-session-id seen on authenticated calls
}

func (f *vsphereFake) handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/api/session" && r.Method == http.MethodPost:
			f.handleSessionCreate(w, r)
		case r.URL.Path == "/api/session" && r.Method == http.MethodDelete:
			f.handleSessionDelete(w, r)
		case r.URL.Path == "/api/vcenter/vm" && r.Method == http.MethodGet:
			f.handleVMList(w, r)
		case strings.HasSuffix(r.URL.Path, "/snapshots") && r.Method == http.MethodGet:
			f.handleSnapshotList(w, r)
		case strings.HasSuffix(r.URL.Path, "/snapshots") && r.Method == http.MethodPost:
			f.handleSnapshotCreate(w, r)
		case strings.Contains(r.URL.Path, "/snapshots/") && r.Method == http.MethodGet:
			f.handleSnapshotGet(w, r)
		case strings.HasPrefix(r.URL.Path, "/disks/") && r.Method == http.MethodHead:
			f.handleDiskHead(w, r)
		case strings.HasPrefix(r.URL.Path, "/disks/") && r.Method == http.MethodGet:
			f.handleDiskRange(w, r)
		default:
			f.t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusInternalServerError)
		}
	})
}

func (f *vsphereFake) recordSessionHeader(r *http.Request) {
	f.mu.Lock()
	f.sessionHeaders = append(f.sessionHeaders, r.Header.Get("vmware-api-session-id"))
	f.mu.Unlock()
}

func (f *vsphereFake) handleSessionCreate(w http.ResponseWriter, r *http.Request) {
	user, pass, ok := r.BasicAuth()
	if !ok || user == "" || pass == "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	f.mu.Lock()
	f.basicAuthSeen = true
	f.sessionID = "sess-abc-123"
	f.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	// vCenter returns the session id as a bare JSON string.
	_ = json.NewEncoder(w).Encode("sess-abc-123")
}

func (f *vsphereFake) handleSessionDelete(w http.ResponseWriter, r *http.Request) {
	if got := r.Header.Get("vmware-api-session-id"); got != "sess-abc-123" {
		f.t.Errorf("session delete missing/incorrect session header: %q", got)
	}
	f.mu.Lock()
	f.sessionDeleted = true
	f.mu.Unlock()
	w.WriteHeader(http.StatusNoContent)
}

func (f *vsphereFake) handleVMList(w http.ResponseWriter, r *http.Request) {
	f.recordSessionHeader(r)
	names := r.URL.Query().Get("names")
	vms := r.URL.Query().Get("vms")
	w.Header().Set("Content-Type", "application/json")
	// Resolve "web-01" -> vm-42; a moid filter echoes the moid.
	if names == "web-01" {
		_ = json.NewEncoder(w).Encode([]map[string]string{{"vm": "vm-42", "name": "web-01"}})
		return
	}
	if vms == "vm-42" {
		_ = json.NewEncoder(w).Encode([]map[string]string{{"vm": "vm-42", "name": "web-01"}})
		return
	}
	// No match.
	_ = json.NewEncoder(w).Encode([]map[string]string{})
}

func (f *vsphereFake) handleSnapshotList(w http.ResponseWriter, r *http.Request) {
	f.recordSessionHeader(r)
	w.Header().Set("Content-Type", "application/json")
	// No pre-existing snapshot: force the create path.
	_ = json.NewEncoder(w).Encode([]map[string]string{})
}

func (f *vsphereFake) handleSnapshotCreate(w http.ResponseWriter, r *http.Request) {
	f.recordSessionHeader(r)
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body)
	if q, _ := body["quiesced"].(bool); !q {
		f.t.Errorf("snapshot create not quiesced: %v", body)
	}
	f.mu.Lock()
	f.createdSnapshots++
	f.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode("snapshot-7")
}

func (f *vsphereFake) handleSnapshotGet(w http.ResponseWriter, r *http.Request) {
	f.recordSessionHeader(r)
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{
		"snapshot":    "snapshot-7",
		"name":        "clario360-dr",
		"state":       "ready",
		"change_id":   "52 3f a1/8",
		"create_time": "2026-06-15T10:00:00Z",
	})
}

func (f *vsphereFake) handleDiskHead(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Disk-Size", strconv.Itoa(len(f.disk)))
	w.WriteHeader(http.StatusOK)
}

func (f *vsphereFake) handleDiskRange(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	f.rangeRequests++
	f.mu.Unlock()
	rng := r.Header.Get("Range")
	start, end, ok := parseByteRange(rng, len(f.disk))
	if !ok {
		w.WriteHeader(http.StatusRequestedRangeNotSatisfiable)
		return
	}
	w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, len(f.disk)))
	w.WriteHeader(http.StatusPartialContent)
	_, _ = w.Write(f.disk[start : end+1])
}

// parseByteRange parses "bytes=START-END", clamping END to the disk tail.
func parseByteRange(h string, size int) (int, int, bool) {
	h = strings.TrimPrefix(h, "bytes=")
	parts := strings.SplitN(h, "-", 2)
	if len(parts) != 2 {
		return 0, 0, false
	}
	start, err1 := strconv.Atoi(parts[0])
	end, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil || start < 0 {
		return 0, 0, false
	}
	if start >= size {
		return 0, 0, false
	}
	if end >= size {
		end = size - 1
	}
	return start, end, true
}

// TestVSphereBinding_OpenReadsSnapshotDisk drives the full Open path against the
// fake vCenter + gateway: real session auth, VM resolution, snapshot create/poll,
// and range reads. It asserts the BlockSource serves the exact disk bytes, the
// marker is built from the snapshot's change-id, and the session lifecycle and
// headers are correct.
func TestVSphereBinding_OpenReadsSnapshotDisk(t *testing.T) {
	t.Parallel()

	// A disk that is not a whole multiple of the block size, to exercise the
	// short final-block path.
	disk := make([]byte, 5000)
	for i := range disk {
		disk[i] = byte((i*31 + 7) % 251)
	}
	fake := &vsphereFake{t: t, disk: disk}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()

	binding, err := vmcapture.NewVSphereBinding(vmcapture.VSphereConfig{
		Endpoint:        srv.URL,
		Username:        "dr@vsphere.local",
		Token:           "secret-pw",
		VMName:          "web-01",
		BlockGatewayURL: srv.URL,
		BlockSize:       1024,
		HTTPClient:      srv.Client(),
	})
	if err != nil {
		t.Fatalf("NewVSphereBinding: %v", err)
	}

	src, marker, err := binding.Open(context.Background())
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = src.Close() }()

	// Block geometry.
	if got := src.BlockSize(); got != 1024 {
		t.Fatalf("BlockSize = %d, want 1024", got)
	}
	size, err := src.Size()
	if err != nil {
		t.Fatalf("Size: %v", err)
	}
	if size != int64(len(disk)) {
		t.Fatalf("Size = %d, want %d", size, len(disk))
	}

	// Read every block and reassemble; it must equal the served disk byte-exact.
	got := readAllBlocks(t, src, len(disk))
	if !bytesEqual(got, disk) {
		t.Fatalf("reassembled disk bytes differ from source")
	}

	// Marker is derived from the real snapshot's change-id and snapshot id.
	if !strings.Contains(marker, "snapshot=snapshot-7") {
		t.Fatalf("marker missing snapshot id: %q", marker)
	}
	if !strings.Contains(marker, "change=52 3f a1/8") {
		t.Fatalf("marker missing change-id: %q", marker)
	}
	if !strings.Contains(marker, "vm=vm-42") {
		t.Fatalf("marker missing resolved vm id: %q", marker)
	}

	// Session lifecycle + headers: basic auth used to open, session deleted, and
	// every authenticated control-plane call carried the session header.
	fake.mu.Lock()
	defer fake.mu.Unlock()
	if !fake.basicAuthSeen {
		t.Fatal("session was not opened with HTTP Basic auth")
	}
	if !fake.sessionDeleted {
		t.Fatal("session was not deleted after Open")
	}
	if fake.createdSnapshots != 1 {
		t.Fatalf("createdSnapshots = %d, want 1", fake.createdSnapshots)
	}
	if fake.rangeRequests == 0 {
		t.Fatal("no range reads were issued against the gateway")
	}
	for i, h := range fake.sessionHeaders {
		if h != "sess-abc-123" {
			t.Fatalf("authenticated call %d carried session header %q, want sess-abc-123", i, h)
		}
	}
}

// TestVSphereBinding_MarkerStableAcrossOpens proves the consistency marker is
// stable across repeated Opens of the same unchanged snapshot — the property the
// CBT engine relies on to pin a recovery point.
func TestVSphereBinding_MarkerStableAcrossOpens(t *testing.T) {
	t.Parallel()
	fake := &vsphereFake{t: t, disk: make([]byte, 2048)}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()

	binding, err := vmcapture.NewVSphereBinding(vmcapture.VSphereConfig{
		Endpoint:        srv.URL,
		Username:        "u",
		Token:           "p",
		VMName:          "vm-42", // resolve by moid this time
		BlockGatewayURL: srv.URL,
		HTTPClient:      srv.Client(),
	})
	if err != nil {
		t.Fatalf("NewVSphereBinding: %v", err)
	}

	src1, m1, err := binding.Open(context.Background())
	if err != nil {
		t.Fatalf("Open #1: %v", err)
	}
	_ = src1.Close()
	src2, m2, err := binding.Open(context.Background())
	if err != nil {
		t.Fatalf("Open #2: %v", err)
	}
	_ = src2.Close()

	if m1 != m2 {
		t.Fatalf("marker not stable across opens: %q vs %q", m1, m2)
	}
}

// TestVSphereBinding_OpenWithoutGateway proves the control plane runs for real
// (VM + snapshot resolved) but the missing data-mover gateway is surfaced as a
// clear ErrNotConfigured rather than a fake read — the honesty requirement.
func TestVSphereBinding_OpenWithoutGateway(t *testing.T) {
	t.Parallel()
	fake := &vsphereFake{t: t, disk: make([]byte, 1024)}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()

	binding, err := vmcapture.NewVSphereBinding(vmcapture.VSphereConfig{
		Endpoint:   srv.URL,
		Username:   "u",
		Token:      "p",
		VMName:     "web-01",
		HTTPClient: srv.Client(),
		// No BlockGatewayURL.
	})
	if err != nil {
		t.Fatalf("NewVSphereBinding: %v", err)
	}

	_, _, err = binding.Open(context.Background())
	if !errors.Is(err, vmcapture.ErrNotConfigured) {
		t.Fatalf("Open without gateway: err = %v, want ErrNotConfigured", err)
	}
	// The control plane still ran: a session was opened, the VM resolved, and a
	// snapshot created — proving the failure is only the data path, not the whole
	// binding.
	fake.mu.Lock()
	defer fake.mu.Unlock()
	if !fake.basicAuthSeen {
		t.Fatal("expected session to be opened even without a gateway")
	}
	if fake.createdSnapshots != 1 {
		t.Fatalf("createdSnapshots = %d, want 1 (control plane should still snapshot)", fake.createdSnapshots)
	}
	if !fake.sessionDeleted {
		t.Fatal("session should be released even on the no-gateway error path")
	}
}

// TestVSphereBinding_DrivesRealCBT plugs the binding into the actual RunCBT
// engine to prove the BlockSource it returns is a first-class participant: the
// content-hash changed-block math runs over the gateway-served bytes and the
// pass closes on the binding's marker.
func TestVSphereBinding_DrivesRealCBT(t *testing.T) {
	t.Parallel()
	disk := []byte(strings.Repeat("clario-dr-block-", 300)) // 4800 bytes
	fake := &vsphereFake{t: t, disk: disk}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()

	binding, err := vmcapture.NewVSphereBinding(vmcapture.VSphereConfig{
		Endpoint:        srv.URL,
		Username:        "u",
		Token:           "p",
		VMName:          "web-01",
		BlockGatewayURL: srv.URL,
		BlockSize:       512,
		HTTPClient:      srv.Client(),
	})
	if err != nil {
		t.Fatalf("NewVSphereBinding: %v", err)
	}

	src, marker, err := binding.Open(context.Background())
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = src.Close() }()

	// Base pass: no prior block map => every block ships.
	res, err := vmcapture.RunCBT(context.Background(), src, "11111111-1111-1111-1111-111111111111", 0, nil, marker)
	if err != nil {
		t.Fatalf("RunCBT: %v", err)
	}
	if res.ImageBytes != int64(len(disk)) {
		t.Fatalf("ImageBytes = %d, want %d", res.ImageBytes, len(disk))
	}
	wantBlocks := (len(disk) + 511) / 512
	if res.TotalBlocks != wantBlocks {
		t.Fatalf("TotalBlocks = %d, want %d", res.TotalBlocks, wantBlocks)
	}
	if res.ChangedBlocks != wantBlocks {
		t.Fatalf("base pass ChangedBlocks = %d, want %d (all)", res.ChangedBlocks, wantBlocks)
	}
	if res.SourceMarker != marker {
		t.Fatalf("SourceMarker = %q, want %q", res.SourceMarker, marker)
	}
	// The per-block hashes the engine computed must match a direct hash of the
	// served disk — i.e. the gateway path delivered the real bytes.
	for i, h := range res.BlockHashes {
		start := i * 512
		end := start + 512
		if end > len(disk) {
			end = len(disk)
		}
		sum := sha256.Sum256(disk[start:end])
		if h != hex.EncodeToString(sum[:]) {
			t.Fatalf("block %d hash mismatch: engine read different bytes than served", i)
		}
	}
}

// TestVSphereTestConnection_OpensAndDeletesSession verifies the bridge's
// connectivity probe opens a real session (Basic auth) and deletes it, with no
// VM/snapshot traffic.
func TestVSphereTestConnection_OpensAndDeletesSession(t *testing.T) {
	t.Parallel()
	fake := &vsphereFake{t: t, disk: nil}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()

	err := vmcapture.VSphereTestConnection(context.Background(), srv.URL, "probe@vsphere", "pw", "")
	if err != nil {
		t.Fatalf("VSphereTestConnection: %v", err)
	}
	fake.mu.Lock()
	defer fake.mu.Unlock()
	if !fake.basicAuthSeen {
		t.Fatal("test connection did not open a session with basic auth")
	}
	if !fake.sessionDeleted {
		t.Fatal("test connection did not delete the session")
	}
}

// TestVSphereTestConnection_RejectsBadCredentials proves a 401 from vCenter is
// surfaced as an invalid-input error, the way the bridge reports a failed probe.
func TestVSphereTestConnection_RejectsBadCredentials(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/session" && r.Method == http.MethodPost {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		t.Errorf("unexpected request after auth rejection: %s %s", r.Method, r.URL.Path)
	}))
	defer srv.Close()

	err := vmcapture.VSphereTestConnection(context.Background(), srv.URL, "bad", "creds", "")
	if !errors.Is(err, vmcapture.ErrInvalid) {
		t.Fatalf("err = %v, want ErrInvalid on 401", err)
	}
}

// TestVSphereBinding_VMNotFound proves an unresolvable VM is a clean ErrNotFound.
func TestVSphereBinding_VMNotFound(t *testing.T) {
	t.Parallel()
	fake := &vsphereFake{t: t, disk: make([]byte, 16)}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()

	binding, err := vmcapture.NewVSphereBinding(vmcapture.VSphereConfig{
		Endpoint:        srv.URL,
		Username:        "u",
		Token:           "p",
		VMName:          "does-not-exist",
		BlockGatewayURL: srv.URL,
		HTTPClient:      srv.Client(),
	})
	if err != nil {
		t.Fatalf("NewVSphereBinding: %v", err)
	}
	_, _, err = binding.Open(context.Background())
	if !errors.Is(err, vmcapture.ErrNotFound) {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

// TestVSphereBinding_ReusesExistingSnapshot proves Open reuses a same-named
// snapshot instead of creating a second one — the rolling-recovery-point design.
func TestVSphereBinding_ReusesExistingSnapshot(t *testing.T) {
	t.Parallel()
	disk := make([]byte, 4096)
	reuse := &reuseFake{vsphereFake: vsphereFake{t: t, disk: disk}}
	srv := httptest.NewServer(reuse.handler())
	defer srv.Close()

	binding, err := vmcapture.NewVSphereBinding(vmcapture.VSphereConfig{
		Endpoint:        srv.URL,
		Username:        "u",
		Token:           "p",
		VMName:          "web-01",
		BlockGatewayURL: srv.URL,
		HTTPClient:      srv.Client(),
	})
	if err != nil {
		t.Fatalf("NewVSphereBinding: %v", err)
	}
	src, _, err := binding.Open(context.Background())
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	_ = src.Close()

	reuse.mu.Lock()
	defer reuse.mu.Unlock()
	if reuse.createdSnapshots != 0 {
		t.Fatalf("createdSnapshots = %d, want 0 (existing snapshot must be reused)", reuse.createdSnapshots)
	}
}

// reuseFake overrides the snapshot-list handler to advertise an existing
// "clario360-dr" snapshot, exercising the reuse path.
type reuseFake struct {
	vsphereFake
}

func (f *reuseFake) handler() http.Handler {
	inner := f.vsphereFake.handler()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/snapshots") && r.Method == http.MethodGet {
			f.recordSessionHeader(r)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode([]map[string]string{
				{"snapshot": "snapshot-7", "name": "clario360-dr"},
			})
			return
		}
		inner.ServeHTTP(w, r)
	})
}

// TestNewVSphereBindingFromConfig_ParsesDecryptedConfig proves the bridge entry
// point maps a decrypted config map (with aliases + a numeric block size) onto a
// working binding.
func TestNewVSphereBindingFromConfig_ParsesDecryptedConfig(t *testing.T) {
	t.Parallel()
	disk := make([]byte, 2048)
	fake := &vsphereFake{t: t, disk: disk}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()

	binding, err := vmcapture.NewVSphereBindingFromConfig(map[string]any{
		"vcenter_url":       srv.URL,
		"user":              "svc",
		"password":          "pw",
		"vm":                "web-01",
		"block_gateway_url": srv.URL,
		"block_size":        json.Number("512"),
	})
	if err != nil {
		t.Fatalf("NewVSphereBindingFromConfig: %v", err)
	}
	// Replace the constructed client with the httptest client by re-opening via a
	// config that includes it is not possible (FromConfig builds its own client),
	// so just assert it constructed and resolves geometry through a real Open
	// against the in-process server (httptest's default client trusts the server
	// because the URL is http, not https).
	src, _, err := binding.Open(context.Background())
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = src.Close() }()
	if src.BlockSize() != 512 {
		t.Fatalf("BlockSize = %d, want 512 (from config)", src.BlockSize())
	}
}

// --- test helpers ------------------------------------------------------------

func readAllBlocks(t *testing.T, src vmcapture.BlockSource, total int) []byte {
	t.Helper()
	buf := make([]byte, src.BlockSize())
	out := make([]byte, 0, total)
	for idx := 0; ; idx++ {
		n, err := src.ReadBlock(idx, buf)
		if n > 0 {
			out = append(out, buf[:n]...)
		}
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			t.Fatalf("ReadBlock(%d): %v", idx, err)
		}
		if n == 0 {
			break
		}
	}
	return out
}

func bytesEqual(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
