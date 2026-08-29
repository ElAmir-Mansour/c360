package appconsistent

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/repository"
)

// memReadRunner runs read fns with a nil DBTX (the in-memory store ignores it).
type memReadRunner struct {
	reads   int
	tenants []uuid.UUID
}

func (r *memReadRunner) RunReadWithTenant(_ context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	r.reads++
	r.tenants = append(r.tenants, tenantID)
	return fn(nil)
}

// memReadStore is an in-memory ReadStore returning a canned list.
type memReadStore struct {
	barriers []*Barrier
	err      error
}

func (s *memReadStore) ListBarriersByGroup(_ context.Context, _ repository.DBTX, _, _ string) ([]*Barrier, error) {
	return s.barriers, s.err
}

func newTestService(t *testing.T, store *memReadStore) (*Service, *memReadRunner) {
	t.Helper()
	sealer := &fakeSealer{point: &model.RecoveryPoint{ID: uuid.NewString()}}
	coord, _, _, _ := newTestCoordinator(t, sealer, fakeLSN{lsn: "0/1"})
	read := &memReadRunner{}
	svc, err := NewService(ServiceConfig{
		Coordinator: coord,
		Read:        read,
		Store:       store,
		Logger:      zerolog.Nop(),
	})
	if err != nil {
		t.Fatalf("NewService: %v", err)
	}
	return svc, read
}

func TestService_BuildProvider(t *testing.T) {
	svc, _ := newTestService(t, &memReadStore{})

	tests := []struct {
		name    string
		req     TriggerRequest
		wantNil bool
		wantErr bool
		assert  func(t *testing.T, p QuiesceProvider)
	}{
		{
			name:    "empty provider is crash-consistent (nil)",
			req:     TriggerRequest{Provider: ""},
			wantNil: true,
		},
		{
			name:    "none provider is crash-consistent (nil)",
			req:     TriggerRequest{Provider: ProviderNone},
			wantNil: true,
		},
		{
			name: "script provider built with timeout",
			req: TriggerRequest{
				Provider: ProviderScript,
				Script:   &ScriptProviderRequest{FreezeCmd: "fsfreeze --freeze /data", ThawCmd: "fsfreeze --unfreeze /data", TimeoutSec: 12},
			},
			assert: func(t *testing.T, p QuiesceProvider) {
				sp, ok := p.(*ScriptQuiesceProvider)
				if !ok {
					t.Fatalf("expected *ScriptQuiesceProvider, got %T", p)
				}
				if sp.FreezeCmd != "fsfreeze --freeze /data" || sp.ThawCmd != "fsfreeze --unfreeze /data" {
					t.Fatalf("commands not threaded: %+v", sp)
				}
				if sp.Timeout != 12*time.Second {
					t.Fatalf("timeout = %s, want 12s", sp.Timeout)
				}
				if sp.Kind() != ProviderScript {
					t.Fatalf("kind = %q", sp.Kind())
				}
			},
		},
		{
			name:    "script provider missing config rejected",
			req:     TriggerRequest{Provider: ProviderScript},
			wantErr: true,
		},
		{
			name:    "script provider missing commands rejected",
			req:     TriggerRequest{Provider: ProviderScript, Script: &ScriptProviderRequest{FreezeCmd: "true"}},
			wantErr: true,
		},
		{
			name: "http provider built with default timeout",
			req: TriggerRequest{
				Provider: ProviderHTTP,
				HTTP:     &HTTPProviderRequest{BaseURL: "http://agent:9099", AuthToken: "tok"},
			},
			assert: func(t *testing.T, p QuiesceProvider) {
				hp, ok := p.(*HTTPQuiesceProvider)
				if !ok {
					t.Fatalf("expected *HTTPQuiesceProvider, got %T", p)
				}
				if hp.BaseURL != "http://agent:9099" || hp.AuthToken != "tok" {
					t.Fatalf("http config not threaded: %+v", hp)
				}
				if hp.Timeout != 30*time.Second {
					t.Fatalf("default timeout = %s, want 30s", hp.Timeout)
				}
			},
		},
		{
			name:    "http provider missing base url rejected",
			req:     TriggerRequest{Provider: ProviderHTTP, HTTP: &HTTPProviderRequest{}},
			wantErr: true,
		},
		{
			name:    "unknown provider rejected",
			req:     TriggerRequest{Provider: "smoke-signals"},
			wantErr: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			p, err := svc.buildProvider(tc.req)
			if tc.wantErr {
				if !errors.Is(err, ErrInvalidInput) {
					t.Fatalf("expected ErrInvalidInput, got %v", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tc.wantNil {
				if p != nil {
					t.Fatalf("expected nil provider, got %T", p)
				}
				return
			}
			if p == nil {
				t.Fatal("expected a provider, got nil")
			}
			if tc.assert != nil {
				tc.assert(t, p)
			}
		})
	}
}

func TestService_ListConsistencyBarriers(t *testing.T) {
	rp := uuid.NewString()
	store := &memReadStore{barriers: []*Barrier{
		{ID: "b2", ConsistencyLevel: ConsistencyApplication, RecoveryPointID: &rp, Success: true, Quiesced: true, Thawed: true},
		{ID: "b1", ConsistencyLevel: ConsistencyCrash},
	}}
	svc, read := newTestService(t, store)

	tenantID, groupID := uuid.New(), uuid.New()
	got, err := svc.ListConsistencyBarriers(context.Background(), tenantID, groupID)
	if err != nil {
		t.Fatalf("ListConsistencyBarriers: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d barriers, want 2", len(got))
	}
	if read.reads != 1 {
		t.Fatalf("read transactions = %d, want 1 (must run under tenant RLS)", read.reads)
	}
	if len(read.tenants) != 1 || read.tenants[0] != tenantID {
		t.Fatalf("read not scoped to tenant: %v", read.tenants)
	}
}

func TestService_ListConsistencyBarriers_PropagatesError(t *testing.T) {
	store := &memReadStore{err: errors.New("db unavailable")}
	svc, _ := newTestService(t, store)

	_, err := svc.ListConsistencyBarriers(context.Background(), uuid.New(), uuid.New())
	if err == nil {
		t.Fatal("expected error to propagate")
	}
}

func TestNewService_Validation(t *testing.T) {
	if _, err := NewService(ServiceConfig{}); !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("missing coordinator: expected ErrNotConfigured, got %v", err)
	}
}
