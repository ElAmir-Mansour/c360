package service_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/audit/consumer"
	"github.com/clario360/platform/internal/audit/hash"
	"github.com/clario360/platform/internal/audit/model"
	auditservice "github.com/clario360/platform/internal/audit/service"
	"github.com/clario360/platform/internal/events"
)

type fakeAuditRepository struct {
	inserted   []model.AuditEntry
	chainState *model.ChainState
}

func (r *fakeAuditRepository) BatchInsert(_ context.Context, entries []model.AuditEntry) (int64, error) {
	r.inserted = append([]model.AuditEntry(nil), entries...)
	return int64(len(entries)), nil
}

func (r *fakeAuditRepository) GetChainState(_ context.Context, _ string) (*model.ChainState, error) {
	if r.chainState == nil {
		return nil, nil
	}
	state := *r.chainState
	return &state, nil
}

func (r *fakeAuditRepository) UpsertChainState(_ context.Context, cs *model.ChainState) error {
	state := *cs
	r.chainState = &state
	return nil
}

func TestWatheeqLexCloudEventIngestsWithHashChain(t *testing.T) {
	ctx := context.Background()
	tenantID := uuid.NewString()
	userID := uuid.NewString()
	envelopeID := uuid.NewString()
	fileID := uuid.NewString()

	event := &events.Event{
		ID:              "watheeq-lex-custody-event-001",
		Source:          "clario360/lex-service",
		SpecVersion:     "1.0",
		Type:            "com.clario360.lex.signature.custody_recorded",
		DataContentType: "application/json",
		Subject:         "signature/" + envelopeID,
		Time:            time.Date(2026, 6, 14, 9, 30, 0, 0, time.UTC),
		TenantID:        tenantID,
		UserID:          userID,
		CorrelationID:   "corr-watheeq-lex-001",
		Data: json.RawMessage(`{
			"id": "` + envelopeID + `",
			"file_id": "` + fileID + `",
			"content_hash": "sha256:watheeq-content",
			"evidence_hash": "sha256:watheeq-evidence"
		}`),
		Metadata: map[string]string{
			"tenant_id": tenantID,
			"user_id":   userID,
			"action":    "signature.custody_recorded",
			"product":   "watheeq",
			"suite":     "lex",
		},
	}

	entry, err := consumer.NewEventMapper().Map(event)
	if err != nil {
		t.Fatalf("map Watheeq Lex event: %v", err)
	}

	redisServer := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: redisServer.Addr()})
	t.Cleanup(func() { _ = rdb.Close() })

	repo := &fakeAuditRepository{}
	svc := auditservice.NewAuditService(repo, rdb, zerolog.Nop(), 10, time.Hour)
	svc.IngestFromEvent(*entry)
	if err := svc.Flush(ctx); err != nil {
		t.Fatalf("flush audit service: %v", err)
	}

	if len(repo.inserted) != 1 {
		t.Fatalf("inserted entries = %d, want 1", len(repo.inserted))
	}
	got := repo.inserted[0]
	if got.Service != "lex-service" {
		t.Fatalf("service = %q, want lex-service", got.Service)
	}
	if got.Action != "signature.custody_recorded" {
		t.Fatalf("action = %q, want signature.custody_recorded", got.Action)
	}
	if got.ResourceType != "signature" {
		t.Fatalf("resource_type = %q, want signature", got.ResourceType)
	}
	if got.ResourceID != envelopeID {
		t.Fatalf("resource_id = %q, want %s", got.ResourceID, envelopeID)
	}
	if got.EventID != event.ID {
		t.Fatalf("event_id = %q, want %s", got.EventID, event.ID)
	}

	var metadata map[string]any
	if err := json.Unmarshal(got.Metadata, &metadata); err != nil {
		t.Fatalf("metadata json: %v", err)
	}
	if metadata["product"] != "watheeq" || metadata["suite"] != "lex" {
		t.Fatalf("metadata missing Watheeq product markers: %+v", metadata)
	}

	if got.PreviousHash != hash.GenesisHash {
		t.Fatalf("previous_hash = %q, want genesis hash", got.PreviousHash)
	}
	if len(got.EntryHash) != 64 {
		t.Fatalf("entry_hash length = %d, want 64", len(got.EntryHash))
	}
	if want := hash.ComputeEntryHash(&got, got.PreviousHash); got.EntryHash != want {
		t.Fatalf("entry_hash = %q, want recomputed %q", got.EntryHash, want)
	}
	if repo.chainState == nil {
		t.Fatal("expected chain state update")
	}
	if repo.chainState.LastEntryID != got.ID || repo.chainState.LastHash != got.EntryHash {
		t.Fatalf("chain state = %+v, want entry %s hash %s", repo.chainState, got.ID, got.EntryHash)
	}
}
