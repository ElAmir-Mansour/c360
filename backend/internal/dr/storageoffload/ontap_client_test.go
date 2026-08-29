package storageoffload

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// ontapFake is a canned ONTAP REST v9 endpoint sufficient to drive every Do
// mapping: volume lookup, snapshot create/get/list/delete, and a SnapMirror
// transfer. It records the auth header it last saw so tests can assert the
// client authenticates correctly.
type ontapFake struct {
	mu         sync.Mutex
	lastAuth   string
	lastPaths  []string
	transferOK bool // flipped true once a transfer POST is received
}

func (f *ontapFake) record(r *http.Request) {
	f.mu.Lock()
	f.lastAuth = r.Header.Get("Authorization")
	f.lastPaths = append(f.lastPaths, r.Method+" "+r.URL.Path)
	f.mu.Unlock()
}

func (f *ontapFake) handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.record(r)
		w.Header().Set("Content-Type", "application/json")
		path := r.URL.Path
		q := r.URL.Query()
		switch {
		// --- cluster connectivity probe ---
		case r.Method == http.MethodGet && path == "/api/cluster":
			_ = json.NewEncoder(w).Encode(ontapCluster{Name: "clario-cluster"})

		// --- volume name -> uuid ---
		case r.Method == http.MethodGet && path == "/api/storage/volumes":
			if q.Get("name") != "vol-1" {
				_ = json.NewEncoder(w).Encode(ontapVolumeList{})
				return
			}
			_ = json.NewEncoder(w).Encode(ontapVolumeList{
				Records: []ontapVolume{{UUID: "vuuid-1", Name: "vol-1"}},
			})

		// --- create snapshot ---
		case r.Method == http.MethodPost && path == "/api/storage/volumes/vuuid-1/snapshots":
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			name, _ := body["name"].(string)
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(ontapSnapshot{Name: name, State: "creating"})

		// --- list snapshots / get-by-name (collection) ---
		case r.Method == http.MethodGet && path == "/api/storage/volumes/vuuid-1/snapshots":
			_ = json.NewEncoder(w).Encode(ontapSnapshotList{
				Records: []ontapSnapshot{
					{UUID: "snap-uuid-a", Name: "clario360_20260101T000000Z", State: "valid"},
					{UUID: "snap-uuid-b", Name: "clario360_20260102T000000Z", State: "valid"},
				},
			})

		// --- get one snapshot by name ---
		case r.Method == http.MethodGet && strings.HasPrefix(path, "/api/storage/volumes/vuuid-1/snapshots/"):
			name := strings.TrimPrefix(path, "/api/storage/volumes/vuuid-1/snapshots/")
			if name == "missing-snap" {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			_ = json.NewEncoder(w).Encode(ontapSnapshot{UUID: "snap-uuid-a", Name: name, State: "valid", Size: 8192})

		// --- delete snapshot ---
		case r.Method == http.MethodDelete && strings.HasPrefix(path, "/api/storage/volumes/vuuid-1/snapshots/"):
			w.WriteHeader(http.StatusOK)

		// --- snapmirror relationship lookup by destination path (non-uuid target) ---
		case r.Method == http.MethodGet && path == "/api/snapmirror/relationships":
			_ = json.NewEncoder(w).Encode(ontapSnapMirrorList{
				Records: []ontapSnapMirrorRelationship{{UUID: "rel-uuid-1", State: "snapmirrored"}},
			})

		// --- snapmirror relationship lookup by uuid ---
		case r.Method == http.MethodGet && path == "/api/snapmirror/relationships/rel-uuid-1":
			rel := ontapSnapMirrorRelationship{UUID: "rel-uuid-1", State: "snapmirrored"}
			if f.transferOK {
				rel.Transfer.State = "success"
				rel.Transfer.BytesTransferred = 65536
			}
			_ = json.NewEncoder(w).Encode(rel)

		// --- snapmirror transfer (update/initialize) ---
		case r.Method == http.MethodPost && path == "/api/snapmirror/relationships/rel-uuid-1/transfers":
			f.mu.Lock()
			f.transferOK = true
			f.mu.Unlock()
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{"uuid": "transfer-1"})

		default:
			w.WriteHeader(http.StatusNotFound)
		}
	})
}

func (f *ontapFake) auth() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.lastAuth
}

// TestONTAPClient_DoMappings exercises each generic (method, path) the
// arrayProvider produces against a canned ONTAP server, asserting the translated
// ONTAP REST calls run and the generic response shapes decode back correctly.
func TestONTAPClient_DoMappings(t *testing.T) {
	t.Parallel()
	fake := &ontapFake{}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()

	c, err := NewONTAPClient(srv.URL, "svc-account", "", "", srv.Client())
	if err != nil {
		t.Fatalf("NewONTAPClient: %v", err)
	}
	c.password = "s3cret" // Basic auth password companion to the username.
	ctx := context.Background()

	// 1) POST /snapshots -> create. Resolves vol-1 -> vuuid-1, POSTs a snapshot.
	var created arraySnapshotResponse
	if err := c.Do(ctx, http.MethodPost, "/snapshots",
		map[string]any{"volume": "vol-1", "source": "lun0"}, &created); err != nil {
		t.Fatalf("Do create: %v", err)
	}
	if !strings.HasPrefix(created.Handle, "clario360_") {
		t.Fatalf("created handle = %q, want clario360_ prefix", created.Handle)
	}
	if created.State != string(ProviderSnapshotCreating) {
		t.Fatalf("created state = %q, want creating", created.State)
	}

	// Auth header must be HTTP Basic with the configured username/password.
	gotAuth := fake.auth()
	if !strings.HasPrefix(gotAuth, "Basic ") {
		t.Fatalf("auth header = %q, want Basic", gotAuth)
	}

	// 2) GET /snapshots/{handle} -> get one. Volume uuid recovered from cache.
	var got arraySnapshotResponse
	if err := c.Do(ctx, http.MethodGet, "/snapshots/"+created.Handle, nil, &got); err != nil {
		t.Fatalf("Do get: %v", err)
	}
	if got.Handle != created.Handle || got.State != string(ProviderSnapshotReady) {
		t.Fatalf("got = %+v, want ready handle=%s", got, created.Handle)
	}

	// 2b) GET a missing snapshot -> missing state (not an error).
	var missing arraySnapshotResponse
	if err := c.Do(ctx, http.MethodGet, "/snapshots/missing-snap", nil, &missing); err != nil {
		t.Fatalf("Do get missing: %v", err)
	}
	if missing.State != string(ProviderSnapshotMissing) {
		t.Fatalf("missing state = %q, want missing", missing.State)
	}

	// 3) GET /volumes/{vol}/snapshots -> list handles.
	var list struct {
		Handles []string `json:"handles"`
	}
	if err := c.Do(ctx, http.MethodGet, "/volumes/vol-1/snapshots", nil, &list); err != nil {
		t.Fatalf("Do list: %v", err)
	}
	if len(list.Handles) != 2 || list.Handles[0] != "clario360_20260101T000000Z" {
		t.Fatalf("list handles = %v", list.Handles)
	}

	// 4) POST /snapshots/{handle}/replicate -> SnapMirror transfer + byte count.
	var rep struct {
		BytesTransferred int64 `json:"bytes_transferred"`
	}
	if err := c.Do(ctx, http.MethodPost, "/snapshots/"+created.Handle+"/replicate",
		map[string]any{"target": "rel-uuid-1", "base_target": ""}, &rep); err != nil {
		t.Fatalf("Do replicate: %v", err)
	}
	if rep.BytesTransferred != 65536 {
		t.Fatalf("bytes_transferred = %d, want 65536", rep.BytesTransferred)
	}

	// 5) DELETE /snapshots/{handle} -> delete (idempotent).
	if err := c.Do(ctx, http.MethodDelete, "/snapshots/"+created.Handle, nil, nil); err != nil {
		t.Fatalf("Do delete: %v", err)
	}

	// Verify the SnapMirror transfers path was actually exercised.
	fake.mu.Lock()
	joined := strings.Join(fake.lastPaths, "\n")
	fake.mu.Unlock()
	if !strings.Contains(joined, "POST /api/snapmirror/relationships/rel-uuid-1/transfers") {
		t.Fatalf("snapmirror transfer not called; paths:\n%s", joined)
	}
}

// TestONTAPClient_ThroughArrayProvider proves the client plugs into the real
// arrayProvider end-to-end: NewArrayProvider(ProviderNetAppONTAP, ontapClient)
// drives the StorageOffloadProvider operations and the generic shapes decode.
func TestONTAPClient_ThroughArrayProvider(t *testing.T) {
	t.Parallel()
	fake := &ontapFake{}
	srv := httptest.NewServer(fake.handler())
	defer srv.Close()

	c, err := NewONTAPClientFromConfig(srv.URL, "svc", "tok", "")
	if err != nil {
		t.Fatalf("NewONTAPClientFromConfig: %v", err)
	}
	// With both username and token, config-based construction uses Basic auth
	// (token as password companion).
	if c.username != "svc" || c.password != "tok" || c.token != "" {
		t.Fatalf("config auth wiring: user=%q pass=%q token=%q", c.username, c.password, c.token)
	}

	p := NewArrayProvider(ProviderNetAppONTAP, c)
	if p.Name() != ProviderNetAppONTAP {
		t.Fatalf("Name = %q", p.Name())
	}
	ctx := context.Background()
	req := SnapshotRequest{VolumeName: "vol-1", SourceLocation: "lun0"}

	created, err := p.CreateSnapshot(ctx, req)
	if err != nil {
		t.Fatalf("CreateSnapshot: %v", err)
	}
	if created.State != ProviderSnapshotCreating || !strings.HasPrefix(created.Handle, "clario360_") {
		t.Fatalf("created = %+v", created)
	}

	status, err := p.SnapshotStatus(ctx, req, created.Handle)
	if err != nil {
		t.Fatalf("SnapshotStatus: %v", err)
	}
	if status.State != ProviderSnapshotReady {
		t.Fatalf("status state = %v, want ready", status.State)
	}

	handles, err := p.ListSnapshots(ctx, req)
	if err != nil || len(handles) != 2 {
		t.Fatalf("ListSnapshots = %v, err=%v", handles, err)
	}

	transferred, err := p.ReplicateSnapshot(ctx, req, created.Handle, "rel-uuid-1", "")
	if err != nil || transferred != 65536 {
		t.Fatalf("ReplicateSnapshot = %d, err=%v", transferred, err)
	}

	if err := p.DeleteSnapshot(ctx, req, created.Handle); err != nil {
		t.Fatalf("DeleteSnapshot: %v", err)
	}
}

// TestONTAPTestConnection covers the bridge-facing connectivity probe against
// both a healthy cluster and an unauthorized one.
func TestONTAPTestConnection(t *testing.T) {
	t.Parallel()

	t.Run("ok", func(t *testing.T) {
		fake := &ontapFake{}
		srv := httptest.NewServer(fake.handler())
		defer srv.Close()
		if err := ONTAPTestConnection(context.Background(), srv.URL, "svc", "tok", ""); err != nil {
			t.Fatalf("ONTAPTestConnection: %v", err)
		}
		if !strings.HasPrefix(fake.auth(), "Basic ") {
			t.Fatalf("probe auth = %q, want Basic", fake.auth())
		}
	})

	t.Run("unauthorized", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":{"message":"invalid credentials"}}`))
		}))
		defer srv.Close()
		err := ONTAPTestConnection(context.Background(), srv.URL, "svc", "bad", "")
		if err == nil {
			t.Fatal("expected error for 401, got nil")
		}
		if !strings.Contains(err.Error(), "connectivity test failed") {
			t.Fatalf("err = %v, want connectivity test failed", err)
		}
	})

	t.Run("token-only bearer auth", func(t *testing.T) {
		var gotAuth string
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			gotAuth = r.Header.Get("Authorization")
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(ontapCluster{Name: "c"})
		}))
		defer srv.Close()
		// Empty username + token -> bearer auth.
		if err := ONTAPTestConnection(context.Background(), srv.URL, "", "mytoken", ""); err != nil {
			t.Fatalf("ONTAPTestConnection: %v", err)
		}
		if gotAuth != "Bearer mytoken" {
			t.Fatalf("auth = %q, want Bearer mytoken", gotAuth)
		}
	})
}

// TestNewONTAPClient_Validation covers constructor input handling: empty base
// URL, /api normalization, and CA-cert PEM validation.
func TestNewONTAPClient_Validation(t *testing.T) {
	t.Parallel()

	if _, err := NewONTAPClient("", "u", "", "", nil); err == nil {
		t.Fatal("expected error for empty baseURL")
	}

	// Trailing /api must be normalized away (so do() re-adds exactly one).
	c, err := NewONTAPClient("https://cluster.example/api/", "u", "", "", nil)
	if err != nil {
		t.Fatalf("NewONTAPClient: %v", err)
	}
	if c.baseURL != "https://cluster.example" {
		t.Fatalf("baseURL = %q, want https://cluster.example", c.baseURL)
	}

	// A malformed CA PEM must be rejected (not silently ignored).
	if _, err := NewONTAPClient("https://cluster.example", "u", "", "not-a-pem", nil); err == nil {
		t.Fatal("expected error for malformed caCertPEM")
	}
}

// TestONTAPClient_UnsupportedCall asserts an unknown generic call is rejected
// rather than silently passing through.
func TestONTAPClient_UnsupportedCall(t *testing.T) {
	t.Parallel()
	c, err := NewONTAPClient("https://cluster.example", "u", "", "", nil)
	if err != nil {
		t.Fatalf("NewONTAPClient: %v", err)
	}
	err = c.Do(context.Background(), http.MethodPut, "/something/weird", nil, nil)
	if err == nil || !strings.Contains(err.Error(), "unsupported generic call") {
		t.Fatalf("err = %v, want unsupported generic call", err)
	}
}

// TestLooksLikeUUID covers the SnapMirror target discriminator.
func TestLooksLikeUUID(t *testing.T) {
	t.Parallel()
	cases := map[string]bool{
		"123e4567-e89b-12d3-a456-426614174000": true,
		"not-a-uuid":                           false,
		"svm1:dst_vol":                         false,
		"123e4567e89b12d3a456426614174000":     false, // no dashes
		"123e4567-e89b-12d3-a456-42661417400g": false, // non-hex
	}
	for in, want := range cases {
		if got := looksLikeUUID(in); got != want {
			t.Errorf("looksLikeUUID(%q) = %v, want %v", in, got, want)
		}
	}
}
