package credential

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/cyber/vciso/llm/provider"
	"github.com/clario360/platform/internal/siem/store/crypto"
)

// OutboxEmitter publishes an audit/outbox event on credential changes. The
// payload NEVER contains the key or ciphertext. A nil emitter is tolerated (the
// service treats it as a no-op) so services without outbox wiring still work.
type OutboxEmitter interface {
	Emit(ctx context.Context, eventType string, payload map[string]any) error
}

// Service is the per-tenant LLM credential manager. It encrypts on write and
// decrypts on resolve using the injected SecretCrypto, persists via the injected
// Store, and emits key-free audit events via the injected OutboxEmitter. All
// dependencies are interfaces so tests can fake crypto + db + outbox with no
// Vault, no network, and no real database.
type Service struct {
	store  Store
	crypto crypto.SecretCrypto
	emit   OutboxEmitter
}

// NewService builds a credential Service. store and crypto are required; emit may
// be nil (events are skipped).
func NewService(store Store, sc crypto.SecretCrypto, emit OutboxEmitter) (*Service, error) {
	if store == nil {
		return nil, fmt.Errorf("credential: Service requires a Store")
	}
	if sc == nil {
		return nil, fmt.Errorf("credential: Service requires a SecretCrypto")
	}
	return &Service{store: store, crypto: sc, emit: emit}, nil
}

// Set creates or replaces the tenant's LLM credential. apiKey is owned by the
// caller; Set zeroes the validated copy it makes after encryption. The plaintext
// is NEVER persisted, logged, or returned. Returns a key-free Status.
func (s *Service) Set(ctx context.Context, tenantID uuid.UUID, provider, model string, apiKey []byte) (Status, error) {
	provider, err := validateProvider(provider)
	if err != nil {
		return Status{}, err
	}
	keyBytes, err := validateKey(provider, apiKey)
	if err != nil {
		return Status{}, err
	}
	rec, err := s.encryptAndStore(ctx, tenantID, provider, model, keyBytes)
	zeroBytes(keyBytes)
	if err != nil {
		return Status{}, err
	}
	s.emitEvent(ctx, "llm.credential.set", tenantID, rec)
	return statusFromRecord(rec, true), nil
}

// Rotate replaces the API key for an already-configured tenant, reusing the
// stored provider/model. Returns ErrNotConfigured if no credential exists.
func (s *Service) Rotate(ctx context.Context, tenantID uuid.UUID, apiKey []byte) (Status, error) {
	current, found, err := s.store.Get(ctx, tenantID)
	if err != nil {
		return Status{}, err
	}
	if !found {
		return Status{}, ErrNotConfigured
	}
	keyBytes, err := validateKey(current.Provider, apiKey)
	if err != nil {
		return Status{}, err
	}
	rec, err := s.encryptAndStore(ctx, tenantID, current.Provider, current.Model, keyBytes)
	zeroBytes(keyBytes)
	if err != nil {
		return Status{}, err
	}
	s.emitEvent(ctx, "llm.credential.rotated", tenantID, rec)
	return statusFromRecord(rec, true), nil
}

// Delete removes the tenant's credential. Idempotent: deleting an absent
// credential is not an error. Emits an event only when a row was removed.
func (s *Service) Delete(ctx context.Context, tenantID uuid.UUID) error {
	existed, err := s.store.Delete(ctx, tenantID)
	if err != nil {
		return err
	}
	if existed {
		s.emitEvent(ctx, "llm.credential.deleted", tenantID, CredentialRecord{TenantID: tenantID})
	}
	return nil
}

// SetEnabled toggles whether the credential is active. A disabled credential
// causes ResolveCredential to return (nil, nil) -> manager falls back.
func (s *Service) SetEnabled(ctx context.Context, tenantID uuid.UUID, enabled bool) (Status, error) {
	rec, err := s.store.SetEnabled(ctx, tenantID, enabled)
	if err != nil {
		return Status{}, err
	}
	event := "llm.credential.enabled"
	if !enabled {
		event = "llm.credential.disabled"
	}
	s.emitEvent(ctx, event, tenantID, rec)
	return statusFromRecord(rec, true), nil
}

// GetStatus returns the tenant's credential metadata, NEVER the key. When no
// credential exists it returns a zero-value (Configured=false) Status.
func (s *Service) GetStatus(ctx context.Context, tenantID uuid.UUID) (Status, error) {
	rec, found, err := s.store.Get(ctx, tenantID)
	if err != nil {
		return Status{}, err
	}
	if !found {
		return Status{Configured: false}, nil
	}
	return statusFromRecord(rec, true), nil
}

// ResolveCredential returns the tenant's DECRYPTED credential for in-memory use,
// or (nil, nil) when the tenant has no enabled credential (manager then falls
// back to env / fail-closed). The returned APIKey is owned by the CALLER, which
// MUST zero it after copying it into the provider. The return type is
// *provider.ResolvedCredential so *Service satisfies provider.TenantCredentialResolver
// and can be injected directly into NewManagerWithCredentials (STAGE 2). The
// Version field carries the row version so the manager keys its provider cache by
// (tenant, version) -- a rotation bumps version and invalidates the stale entry.
func (s *Service) ResolveCredential(ctx context.Context, tenantID uuid.UUID) (*provider.ResolvedCredential, error) {
	rec, found, err := s.store.Get(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	if !found || !rec.Enabled {
		return nil, nil
	}
	plaintext, err := s.crypto.Decrypt(ctx, tenantID, crypto.LLMCredentialIndex(tenantID), rec.APIKeyCipher)
	if err != nil {
		return nil, fmt.Errorf("decrypt tenant llm credential: %w", err)
	}
	return &provider.ResolvedCredential{
		Provider: rec.Provider,
		Model:    rec.Model,
		APIKey:   plaintext,
		Enabled:  true,
		Version:  rec.Version,
	}, nil
}

// compile-time assertion: *Service is a provider.TenantCredentialResolver.
var _ provider.TenantCredentialResolver = (*Service)(nil)

// encryptAndStore encrypts keyBytes under the tenant's DEK and upserts the row.
// keyBytes is NOT zeroed here -- the caller owns and zeroes it.
func (s *Service) encryptAndStore(ctx context.Context, tenantID uuid.UUID, provider, model string, keyBytes []byte) (CredentialRecord, error) {
	cipher, dekRef, kekVersion, err := s.crypto.Encrypt(ctx, tenantID, crypto.LLMCredentialIndex(tenantID), keyBytes)
	if err != nil {
		return CredentialRecord{}, fmt.Errorf("encrypt tenant llm credential: %w", err)
	}
	return s.store.Upsert(ctx, tenantID, provider, model, cipher, string(dekRef), kekVersion)
}

func (s *Service) emitEvent(ctx context.Context, eventType string, tenantID uuid.UUID, rec CredentialRecord) {
	if s.emit == nil {
		return
	}
	// Payload carries metadata only -- NEVER the key or ciphertext.
	_ = s.emit.Emit(ctx, eventType, map[string]any{
		"tenant_id": tenantID.String(),
		"provider":  rec.Provider,
		"model":     rec.Model,
		"version":   rec.Version,
		"action":    eventType,
	})
}

func statusFromRecord(rec CredentialRecord, configured bool) Status {
	updated := rec.UpdatedAt
	return Status{
		Configured:    configured,
		Enabled:       rec.Enabled,
		Provider:      rec.Provider,
		Model:         rec.Model,
		Version:       rec.Version,
		LastRotatedAt: rec.LastRotatedAt,
		UpdatedAt:     &updated,
	}
}

// zeroBytes overwrites b with zeros. The explicit loop prevents dead-store
// elimination so the secret is actually wiped from memory.
func zeroBytes(b []byte) {
	for i := range b {
		b[i] = 0
	}
}
