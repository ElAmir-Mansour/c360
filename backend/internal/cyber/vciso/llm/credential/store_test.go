package credential

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"
)

// fakeStore is an in-memory Store for tests -- NO database. It filters strictly
// by tenant_id so cross-tenant isolation can be proven at the data layer.
type fakeStore struct {
	mu   sync.Mutex
	rows map[uuid.UUID]CredentialRecord
}

func newFakeStore() *fakeStore {
	return &fakeStore{rows: make(map[uuid.UUID]CredentialRecord)}
}

func (f *fakeStore) Upsert(_ context.Context, tenantID uuid.UUID, provider, model, apiKeyCipher, dekRef string, kekVersion int) (CredentialRecord, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	now := time.Now()
	prev, ok := f.rows[tenantID]
	version := int64(1)
	if ok {
		version = prev.Version + 1
	}
	rec := CredentialRecord{
		TenantID:      tenantID,
		Provider:      provider,
		Model:         model,
		APIKeyCipher:  apiKeyCipher,
		DEKRef:        dekRef,
		KEKVersion:    kekVersion,
		Enabled:       true,
		Version:       version,
		LastRotatedAt: &now,
		UpdatedAt:     now,
	}
	f.rows[tenantID] = rec
	return rec, nil
}

func (f *fakeStore) Get(_ context.Context, tenantID uuid.UUID) (CredentialRecord, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rec, ok := f.rows[tenantID]
	if !ok {
		return CredentialRecord{}, false, nil
	}
	return rec, true, nil
}

func (f *fakeStore) Delete(_ context.Context, tenantID uuid.UUID) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	_, ok := f.rows[tenantID]
	delete(f.rows, tenantID)
	return ok, nil
}

func (f *fakeStore) SetEnabled(_ context.Context, tenantID uuid.UUID, enabled bool) (CredentialRecord, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	rec, ok := f.rows[tenantID]
	if !ok {
		return CredentialRecord{}, ErrNotConfigured
	}
	rec.Enabled = enabled
	rec.Version++
	rec.UpdatedAt = time.Now()
	f.rows[tenantID] = rec
	return rec, nil
}
