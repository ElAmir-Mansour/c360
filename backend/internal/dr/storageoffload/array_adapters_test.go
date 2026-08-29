package storageoffload

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestArrayProvider_OverHTTP exercises the production array adapter against a
// real httptest server speaking the conventional REST shape, proving the
// stdlib-only client maps the StorageOffloadProvider operations onto array API
// calls without any vendor SDK.
func TestArrayProvider_OverHTTP(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/snapshots":
			_ = json.NewEncoder(w).Encode(arraySnapshotResponse{Handle: "ontap-snap-1", State: "creating"})
		case r.Method == http.MethodGet && r.URL.Path == "/snapshots/ontap-snap-1":
			_ = json.NewEncoder(w).Encode(arraySnapshotResponse{
				Handle: "ontap-snap-1", State: "ready",
				Files: []ManifestEntry{{Path: "lun0", Hash: "abc", Size: 4096}},
			})
		case r.Method == http.MethodGet && r.URL.Path == "/volumes/vol-1/snapshots":
			_ = json.NewEncoder(w).Encode(map[string][]string{"handles": {"ontap-snap-1"}})
		case r.Method == http.MethodPost && r.URL.Path == "/snapshots/ontap-snap-1/replicate":
			_ = json.NewEncoder(w).Encode(map[string]int64{"bytes_transferred": 4096})
		case r.Method == http.MethodDelete && r.URL.Path == "/snapshots/ontap-snap-1":
			w.WriteHeader(http.StatusNoContent)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	client := NewHTTPArrayClient(srv.URL, "token-xyz", srv.Client())
	p := NewArrayProvider(ProviderNetAppONTAP, client)
	if p.Name() != ProviderNetAppONTAP {
		t.Fatalf("Name = %q", p.Name())
	}
	ctx := context.Background()
	req := SnapshotRequest{VolumeName: "vol-1", SourceLocation: "lun0"}

	created, err := p.CreateSnapshot(ctx, req)
	if err != nil {
		t.Fatalf("CreateSnapshot: %v", err)
	}
	if created.Handle != "ontap-snap-1" || created.State != ProviderSnapshotCreating {
		t.Fatalf("created = %+v", created)
	}

	status, err := p.SnapshotStatus(ctx, req, "ontap-snap-1")
	if err != nil {
		t.Fatalf("SnapshotStatus: %v", err)
	}
	if status.State != ProviderSnapshotReady || status.Manifest == nil || len(status.Manifest.Entries) != 1 {
		t.Fatalf("status = %+v", status)
	}
	if status.ChangedBytes != 4096 {
		t.Errorf("ChangedBytes = %d, want 4096", status.ChangedBytes)
	}

	handles, err := p.ListSnapshots(ctx, req)
	if err != nil || len(handles) != 1 || handles[0] != "ontap-snap-1" {
		t.Fatalf("ListSnapshots = %v, err=%v", handles, err)
	}

	transferred, err := p.ReplicateSnapshot(ctx, req, "ontap-snap-1", "dr://target", "")
	if err != nil || transferred != 4096 {
		t.Fatalf("ReplicateSnapshot = %d, err=%v", transferred, err)
	}

	if err := p.DeleteSnapshot(ctx, req, "ontap-snap-1"); err != nil {
		t.Fatalf("DeleteSnapshot: %v", err)
	}
}

// TestArrayProvider_UnconfiguredClient proves a declared-but-unwired adapter
// surfaces ErrProviderUnavailable rather than panicking.
func TestArrayProvider_UnconfiguredClient(t *testing.T) {
	t.Parallel()
	p := NewArrayProvider(ProviderDellPowerStore, nil)
	_, err := p.CreateSnapshot(context.Background(), SnapshotRequest{VolumeName: "v"})
	if !errors.Is(err, ErrProviderUnavailable) {
		t.Fatalf("err = %v, want ErrProviderUnavailable", err)
	}
}
