package byok

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
)

const eventSource = "clario-dr-service/byok"

// Custody lifecycle event types emitted on datastream.dr.events. They follow the
// com.clario360.datastream.dr.<entity>.<verb> convention used across DR. Every
// custody mutation is staged to the outbox transactionally with its DB write so
// the custody ledger and its event commit together.
const (
	EventTypeKEKEnrolled    = "com.clario360.datastream.dr.byok.kek.enrolled"
	EventTypeDEKWrapped     = "com.clario360.datastream.dr.byok.dek.wrapped"
	EventTypeDEKUnwrapped   = "com.clario360.datastream.dr.byok.dek.unwrapped"
	EventTypeRotationBegan  = "com.clario360.datastream.dr.byok.rotation.began"
	EventTypeDEKRewrapped   = "com.clario360.datastream.dr.byok.dek.rewrapped"
	EventTypeRotationDone   = "com.clario360.datastream.dr.byok.rotation.completed"
	EventTypeUnwrapRejected = "com.clario360.datastream.dr.byok.dek.unwrap_rejected"
)

// drEventsTopic is the existing lifecycle topic (events.Topics.DREvents); kept as
// a literal-backed reference so this package does not edit shared files.
var drEventsTopic = events.Topics.DREvents

// TenantRunner runs read/write functions against the tenant-scoped DB so RLS sees
// app.current_tenant_id. The request path uses it. The DR service's
// pgxTenantRunner satisfies it (same uuid.UUID signature).
type TenantRunner interface {
	RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error
	RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error
}

// SystemRunner runs functions on the cross-tenant system path (RLS bypassed), as
// the leader-singleton rotation loop does everywhere in dr_db. The DR service's
// PGXSystemRunner satisfies it.
type SystemRunner interface {
	RunSystemTx(ctx context.Context, fn func(repository.DBTX) error) error
	RunSystemRead(ctx context.Context, fn func(repository.DBTX) error) error
}

// custodyStore is the persistence surface the service drives (satisfied by
// *Store; an interface so the service is unit-testable without a database).
type custodyStore interface {
	CreateKEK(ctx context.Context, db repository.DBTX, k *TenantKEK) error
	GetActiveKEK(ctx context.Context, db repository.DBTX, tenantID uuid.UUID) (*TenantKEK, error)
	GetActiveKEKSystem(ctx context.Context, db repository.DBTX, tenantID uuid.UUID) (*TenantKEK, error)
	GetKEKByVersion(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, version int) (*TenantKEK, error)
	ListKEKs(ctx context.Context, db repository.DBTX, tenantID uuid.UUID) ([]*TenantKEK, error)
	MaxKEKVersion(ctx context.Context, db repository.DBTX, tenantID uuid.UUID) (int, error)
	SetKEKState(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, version int, state string) (bool, error)
	UpsertWrappedDEK(ctx context.Context, db repository.DBTX, w *WrappedDEK) error
	GetWrappedDEK(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, dekID string) (*WrappedDEK, error)
	ListWrappedDEKsSystem(ctx context.Context, db repository.DBTX, tenantID uuid.UUID) ([]*WrappedDEK, error)
	CountWrappedNotAtVersion(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, version int) (int, error)
	AppendCustody(ctx context.Context, db repository.DBTX, e *CustodyEntry) error
	CustodyTip(ctx context.Context, db repository.DBTX, tenantID uuid.UUID) (int64, string, error)
	ListCustody(ctx context.Context, db repository.DBTX, tenantID uuid.UUID) ([]*CustodyEntry, error)
}

// ProviderFactory builds the KeyProvider that custodies a given KEK version for a
// tenant. It is the bridge between the persisted dr_tenant_kek row (provider kind
// + reference) and the in-process/remote key material:
//
//   - software: load the 32-byte KEK referenced by ref from the operator keystore
//     and return a SoftwareKeyProvider; on enroll/rotate (newKEK=true) MINT a fresh
//     random KEK, persist it to the keystore under a new ref, and return it.
//   - hsm/kms : return a RemoteKeyProvider pointed at the remote key handle.
//
// Declaring it as a func keeps the Service independent of how an operator chooses
// to custody the software KEK (file, Vault, sealed box). The bundled
// MemoryProviderFactory (factory.go) is a fully-real software implementation for
// tests and the software custody mode.
type ProviderFactory interface {
	// Provider returns the KeyProvider for (tenant, version). provider is the
	// dr_tenant_kek.provider kind; ref is dr_tenant_kek.reference. When newKEK is
	// true the factory must materialize a NEW key (enroll/rotate) and return the
	// reference to persist; otherwise it loads the existing key by ref.
	Provider(ctx context.Context, tenantID uuid.UUID, provider, ref string, version int, newKEK bool) (kp KeyProvider, newRef string, err error)
}

// Deps wires the BYOK custody orchestrator.
type Deps struct {
	Store     custodyStore
	Runner    TenantRunner
	System    SystemRunner
	Factory   ProviderFactory
	DEKSource DEKSource
	Metrics   *Metrics
	Logger    zerolog.Logger
	Now       func() time.Time
}

// Service is the BYOK custody orchestrator. It enrolls a tenant KEK, wraps DEKs
// under it, unwraps them on demand, and ROTATES the KEK — introducing a new
// version and rewrapping every DEK from the old KEK to the new one atomically.
// Every custody mutation appends a hash-chained audit entry AND stages a
// datastream.dr.events outbox event in the same transaction.
type Service struct {
	store     custodyStore
	runner    TenantRunner
	system    SystemRunner
	factory   ProviderFactory
	deks      DEKSource
	metrics   *Metrics
	logger    zerolog.Logger
	now       func() time.Time
	rotateMu  sync.Mutex // serializes rotations within this process
	rotateSet map[uuid.UUID]struct{}
}

// NewService constructs the custody orchestrator.
func NewService(d Deps) (*Service, error) {
	if d.Store == nil {
		return nil, errors.New("byok service: store is required")
	}
	if d.Runner == nil {
		return nil, errors.New("byok service: tenant runner is required")
	}
	if d.System == nil {
		return nil, errors.New("byok service: system runner is required")
	}
	if d.Factory == nil {
		return nil, errors.New("byok service: provider factory is required")
	}
	now := d.Now
	if now == nil {
		now = func() time.Time { return time.Now().UTC() }
	}
	return &Service{
		store:     d.Store,
		runner:    d.Runner,
		system:    d.System,
		factory:   d.Factory,
		deks:      d.DEKSource,
		metrics:   d.Metrics,
		logger:    d.Logger.With().Str("component", "dr_byok").Logger(),
		now:       now,
		rotateSet: make(map[uuid.UUID]struct{}),
	}, nil
}

// Enroll registers a tenant's first KEK version (version 1) under the chosen
// custody provider and materializes the key via the factory. It is rejected with
// ErrAlreadyEnrolled if the tenant already has an active KEK (use Rotate instead).
// The KEK row + enroll custody entry + enroll event commit together.
func (s *Service) Enroll(ctx context.Context, tenantID uuid.UUID, provider, reference string) (*TenantKEK, error) {
	switch provider {
	case "":
		provider = ProviderSoftware
	case ProviderSoftware, ProviderHSM, ProviderKMS:
	default:
		return nil, fmt.Errorf("%w: unknown provider %q", ErrValidation, provider)
	}

	var kek *TenantKEK
	err := s.runner.RunWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		maxVer, mverr := s.store.MaxKEKVersion(ctx, db, tenantID)
		if mverr != nil {
			return mverr
		}
		if _, gerr := s.store.GetActiveKEK(ctx, db, tenantID); gerr == nil {
			return ErrAlreadyEnrolled
		} else if !errors.Is(gerr, ErrNotEnrolled) {
			return gerr
		}
		version := maxVer + 1
		// Materialize the key (mint for software, point at remote for hsm/kms).
		_, newRef, perr := s.factory.Provider(ctx, tenantID, provider, reference, version, true)
		if perr != nil {
			return fmt.Errorf("byok: materializing KEK: %w", perr)
		}
		ref := reference
		if newRef != "" {
			ref = newRef
		}
		kek = &TenantKEK{
			TenantID:   tenantID,
			KeyVersion: version,
			Provider:   provider,
			Reference:  ref,
			State:      KEKStateActive,
		}
		if cerr := s.store.CreateKEK(ctx, db, kek); cerr != nil {
			return cerr
		}
		if aerr := s.appendCustody(ctx, db, tenantID, ActionEnroll, version, "", fmt.Sprintf("enrolled %s KEK v%d", provider, version)); aerr != nil {
			return aerr
		}
		return s.emit(ctx, db, EventTypeKEKEnrolled, tenantID, map[string]any{
			"key_version": version,
			"provider":    provider,
		})
	})
	if err != nil {
		return nil, err
	}
	s.metrics.IncEnroll(provider)
	s.logger.Info().Str("tenant_id", tenantID.String()).Int("version", kek.KeyVersion).
		Str("provider", provider).Msg("byok KEK enrolled")
	return kek, nil
}

// WrapDEK wraps a DEK (sourced by dekID from the platform DEK source) under the
// tenant's active KEK and persists the wrapped form. If a wrapped record for the
// DEK already exists at the active version it is returned idempotently (the same
// DEK is not re-wrapped to a different ciphertext). The DEK plaintext is zeroed
// after wrapping and never persisted.
func (s *Service) WrapDEK(ctx context.Context, tenantID uuid.UUID, dekID string) (*WrappedDEK, error) {
	if dekID == "" {
		return nil, fmt.Errorf("%w: dek_id is required", ErrValidation)
	}
	if s.deks == nil {
		return nil, fmt.Errorf("%w: no DEK source wired", ErrValidation)
	}

	var out *WrappedDEK
	err := s.runner.RunWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		active, gerr := s.store.GetActiveKEK(ctx, db, tenantID)
		if gerr != nil {
			return gerr
		}
		// Idempotency: if already wrapped at the active version, return it.
		if existing, eerr := s.store.GetWrappedDEK(ctx, db, tenantID, dekID); eerr == nil {
			if existing.KEKVersion == active.KeyVersion {
				out = existing
				return nil
			}
		} else if !errors.Is(eerr, ErrNotFound) {
			return eerr
		}

		kp, _, perr := s.factory.Provider(ctx, tenantID, active.Provider, active.Reference, active.KeyVersion, false)
		if perr != nil {
			return fmt.Errorf("byok: loading active KEK: %w", perr)
		}
		dek, derr := s.deks.GetDEK(ctx, tenantID, dekID)
		if derr != nil {
			return fmt.Errorf("byok: fetching DEK %q: %w", dekID, derr)
		}
		wrapped, nonce, werr := kp.WrapDEK(ctx, dek)
		zero(dek)
		if werr != nil {
			return fmt.Errorf("byok: wrapping DEK %q: %w", dekID, werr)
		}
		rec := &WrappedDEK{
			TenantID:   tenantID,
			DEKID:      dekID,
			KEKVersion: active.KeyVersion,
			WrappedDEK: wrapped,
			Nonce:      nonce,
		}
		if uerr := s.store.UpsertWrappedDEK(ctx, db, rec); uerr != nil {
			return uerr
		}
		if aerr := s.appendCustody(ctx, db, tenantID, ActionWrap, active.KeyVersion, dekID, "wrapped DEK"); aerr != nil {
			return aerr
		}
		out = rec
		return s.emit(ctx, db, EventTypeDEKWrapped, tenantID, map[string]any{
			"key_version": active.KeyVersion,
			"dek_id":      dekID,
		})
	})
	if err != nil {
		return nil, err
	}
	s.metrics.IncWrap()
	return out, nil
}

// UnwrapDEK returns the DEK plaintext for dekID by loading its wrapped record and
// the KEK version that produced it, then envelope-opening it. A tampered
// ciphertext / wrong KEK fails authenticated decryption (ErrUnwrap) and is
// recorded as a rejected-unwrap custody entry. The returned plaintext is owned by
// the caller, who MUST zero it after use.
func (s *Service) UnwrapDEK(ctx context.Context, tenantID uuid.UUID, dekID string) ([]byte, error) {
	if dekID == "" {
		return nil, fmt.Errorf("%w: dek_id is required", ErrValidation)
	}
	var (
		rec *WrappedDEK
		kek *TenantKEK
	)
	if err := s.runner.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		var gerr error
		rec, gerr = s.store.GetWrappedDEK(ctx, db, tenantID, dekID)
		if gerr != nil {
			return gerr
		}
		kek, gerr = s.store.GetKEKByVersion(ctx, db, tenantID, rec.KEKVersion)
		return gerr
	}); err != nil {
		return nil, err
	}

	kp, _, perr := s.factory.Provider(ctx, tenantID, kek.Provider, kek.Reference, kek.KeyVersion, false)
	if perr != nil {
		return nil, fmt.Errorf("byok: loading KEK v%d: %w", kek.KeyVersion, perr)
	}
	dek, uerr := kp.UnwrapDEK(ctx, rec.WrappedDEK, rec.Nonce)
	if uerr != nil {
		s.metrics.IncUnwrapFailure()
		// Record the rejected unwrap (tamper-evidence) without aborting on a
		// secondary audit failure.
		_ = s.runner.RunWithTenant(ctx, tenantID, func(db repository.DBTX) error {
			if aerr := s.appendCustody(ctx, db, tenantID, ActionUnwrap, kek.KeyVersion, dekID, "unwrap REJECTED"); aerr != nil {
				return aerr
			}
			return s.emit(ctx, db, EventTypeUnwrapRejected, tenantID, map[string]any{
				"key_version": kek.KeyVersion,
				"dek_id":      dekID,
				"reason":      uerr.Error(),
			})
		})
		return nil, uerr
	}

	if aerr := s.runner.RunWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		if cerr := s.appendCustody(ctx, db, tenantID, ActionUnwrap, kek.KeyVersion, dekID, "unwrapped DEK"); cerr != nil {
			return cerr
		}
		return s.emit(ctx, db, EventTypeDEKUnwrapped, tenantID, map[string]any{
			"key_version": kek.KeyVersion,
			"dek_id":      dekID,
		})
	}); aerr != nil {
		zero(dek)
		return nil, aerr
	}
	s.metrics.IncUnwrap()
	return dek, nil
}

// Rotate introduces a NEW KEK version for the tenant and rewraps EVERY DEK from
// the old KEK to the new one (unwrap-with-old -> wrap-with-new), then atomically
// advances the active version and retires the old one. The new version is created
// in state 'rotating' and the old version remains 'active' until every DEK is
// rewrapped; the active flip + old-version retirement happens in a SINGLE
// transaction at the end, so a mid-rotation failure leaves the OLD version active
// with NO partial promotion (the per-DEK rewraps already committed are simply
// re-applied idempotently on the next attempt — they unwrap fine under either
// version because the new version is real and the records carry their version).
//
// Atomicity guarantee: the only point at which the tenant's ACTIVE KEK changes is
// the final transaction, which also verifies that zero DEKs remain at the old
// version before flipping. If any rewrap fails, that transaction never runs and
// the active version is unchanged.
func (s *Service) Rotate(ctx context.Context, tenantID uuid.UUID) (*TenantKEK, error) {
	// Serialize rotations per tenant within this process; the DB partial unique
	// index on (tenant) WHERE state='active' is the cross-process backstop.
	s.rotateMu.Lock()
	if _, busy := s.rotateSet[tenantID]; busy {
		s.rotateMu.Unlock()
		return nil, fmt.Errorf("%w: a rotation is already in progress for this tenant", ErrInvalidState)
	}
	s.rotateSet[tenantID] = struct{}{}
	s.rotateMu.Unlock()
	defer func() {
		s.rotateMu.Lock()
		delete(s.rotateSet, tenantID)
		s.rotateMu.Unlock()
	}()

	start := s.now()

	// Phase 1: load the current active KEK and any already-created rotating
	// successor. A previous Rotate call may have crashed after rotate_begin; a
	// manual retry should converge by finishing that rotation, not fail on the
	// duplicate (tenant, version) row.
	var (
		oldKEK *TenantKEK
		newKEK *TenantKEK
		oldKP  KeyProvider
		newKP  KeyProvider
	)
	var err error
	oldKEK, newKEK, err = s.loadRotationState(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	var perr error
	oldKP, _, perr = s.factory.Provider(ctx, tenantID, oldKEK.Provider, oldKEK.Reference, oldKEK.KeyVersion, false)
	if perr != nil {
		return nil, fmt.Errorf("byok: loading old KEK v%d: %w", oldKEK.KeyVersion, perr)
	}

	newVersion := 0
	if newKEK != nil {
		newVersion = newKEK.KeyVersion
		newKP, _, perr = s.factory.Provider(ctx, tenantID, newKEK.Provider, newKEK.Reference, newKEK.KeyVersion, false)
		if perr != nil {
			return nil, fmt.Errorf("byok: loading existing rotating KEK v%d: %w", newKEK.KeyVersion, perr)
		}
	} else {
		newVersion = oldKEK.KeyVersion + 1

		// Phase 2: materialize the new KEK and create its row in 'rotating' state,
		// transactionally with the rotate_begin custody entry + event. The old KEK
		// stays active.
		var newRef string
		newKP, newRef, perr = s.factory.Provider(ctx, tenantID, oldKEK.Provider, "", newVersion, true)
		if perr != nil {
			return nil, fmt.Errorf("byok: materializing new KEK v%d: %w", newVersion, perr)
		}
		if err := s.system.RunSystemTx(ctx, func(db repository.DBTX) error {
			newKEK = &TenantKEK{
				TenantID:   tenantID,
				KeyVersion: newVersion,
				Provider:   oldKEK.Provider,
				Reference:  newRef,
				State:      KEKStateRotating,
			}
			if cerr := s.store.CreateKEK(ctx, db, newKEK); cerr != nil {
				return cerr
			}
			if aerr := s.appendCustody(ctx, db, tenantID, ActionRotateBegin, newVersion, "", fmt.Sprintf("rotation v%d -> v%d began", oldKEK.KeyVersion, newVersion)); aerr != nil {
				return aerr
			}
			return s.emit(ctx, db, EventTypeRotationBegan, tenantID, map[string]any{
				"old_version": oldKEK.KeyVersion,
				"new_version": newVersion,
			})
		}); err != nil {
			if !errors.Is(err, ErrAlreadyEnrolled) {
				return nil, err
			}
			// A concurrent process won the rotate_begin insert. Converge on its
			// rotating row and finish the idempotent rewrap/flip path.
			var lerr error
			oldKEK, newKEK, lerr = s.loadRotationState(ctx, tenantID)
			if lerr != nil {
				return nil, lerr
			}
			if newKEK == nil {
				return nil, err
			}
			newVersion = newKEK.KeyVersion
			newKP, _, perr = s.factory.Provider(ctx, tenantID, newKEK.Provider, newKEK.Reference, newKEK.KeyVersion, false)
			if perr != nil {
				return nil, fmt.Errorf("byok: loading concurrent rotating KEK v%d: %w", newKEK.KeyVersion, perr)
			}
		}
	}

	// Phase 3: rewrap every DEK old -> new. Each rewrap commits in its own
	// transaction (unwrap-with-old in memory, wrap-with-new, upsert to the new
	// version, append a rewrap custody entry + event). The old KEK is STILL active
	// throughout, so a failure here leaves the active version unchanged.
	var deks []*WrappedDEK
	if err := s.system.RunSystemRead(ctx, func(db repository.DBTX) error {
		var lerr error
		deks, lerr = s.store.ListWrappedDEKsSystem(ctx, db, tenantID)
		return lerr
	}); err != nil {
		return nil, err
	}
	rewrapped := 0
	for _, rec := range deks {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if rec.KEKVersion == newVersion {
			continue // already rewrapped (idempotent resume)
		}
		if err := s.rewrapOne(ctx, tenantID, rec, oldKP, newKP, newVersion); err != nil {
			return nil, fmt.Errorf("byok: rewrapping DEK %q during rotation: %w", rec.DEKID, err)
		}
		rewrapped++
	}

	// Phase 4: the atomic flip. Re-check that NO DEK remains at any non-new
	// version, then in one transaction retire the old KEK and activate the new
	// one, append rotate_complete, and emit. If the count check fails the flip
	// does not happen and the old version stays active.
	if err := s.system.RunSystemTx(ctx, func(db repository.DBTX) error {
		remaining, cerr := s.store.CountWrappedNotAtVersion(ctx, db, tenantID, newVersion)
		if cerr != nil {
			return cerr
		}
		if remaining != 0 {
			return fmt.Errorf("%w: %d DEKs not yet rewrapped to v%d", ErrInvalidState, remaining, newVersion)
		}
		if _, rerr := s.store.SetKEKState(ctx, db, tenantID, oldKEK.KeyVersion, KEKStateRetired); rerr != nil {
			return rerr
		}
		if _, aerr := s.store.SetKEKState(ctx, db, tenantID, newVersion, KEKStateActive); aerr != nil {
			return aerr
		}
		if cerr := s.appendCustody(ctx, db, tenantID, ActionRotateComplete, newVersion, "", fmt.Sprintf("rotation v%d -> v%d completed (%d DEKs rewrapped)", oldKEK.KeyVersion, newVersion, rewrapped)); cerr != nil {
			return cerr
		}
		return s.emit(ctx, db, EventTypeRotationDone, tenantID, map[string]any{
			"old_version":    oldKEK.KeyVersion,
			"new_version":    newVersion,
			"deks_rewrapped": rewrapped,
		})
	}); err != nil {
		return nil, err
	}

	newKEK.State = KEKStateActive
	s.metrics.IncRewrap(rewrapped)
	s.metrics.IncRotation()
	s.metrics.ObserveRotate(s.now().Sub(start).Seconds())
	s.logger.Info().Str("tenant_id", tenantID.String()).Int("old", oldKEK.KeyVersion).
		Int("new", newVersion).Int("rewrapped", rewrapped).Msg("byok KEK rotated")
	return newKEK, nil
}

// rewrapOne rewraps a single DEK from oldKP to newKP and persists it at
// newVersion, transactionally with a rewrap custody entry + event. The DEK
// plaintext lives only transiently in memory and is zeroed after rewrapping.
func (s *Service) rewrapOne(ctx context.Context, tenantID uuid.UUID, rec *WrappedDEK, oldKP, newKP KeyProvider, newVersion int) error {
	dek, uerr := oldKP.UnwrapDEK(ctx, rec.WrappedDEK, rec.Nonce)
	if uerr != nil {
		return fmt.Errorf("unwrap-with-old: %w", uerr)
	}
	wrapped, nonce, werr := newKP.WrapDEK(ctx, dek)
	zero(dek)
	if werr != nil {
		return fmt.Errorf("wrap-with-new: %w", werr)
	}
	return s.system.RunSystemTx(ctx, func(db repository.DBTX) error {
		newRec := &WrappedDEK{
			TenantID:   tenantID,
			DEKID:      rec.DEKID,
			KEKVersion: newVersion,
			WrappedDEK: wrapped,
			Nonce:      nonce,
		}
		if uperr := s.store.UpsertWrappedDEK(ctx, db, newRec); uperr != nil {
			return uperr
		}
		if aerr := s.appendCustody(ctx, db, tenantID, ActionRewrap, newVersion, rec.DEKID, fmt.Sprintf("rewrapped DEK to v%d", newVersion)); aerr != nil {
			return aerr
		}
		return s.emit(ctx, db, EventTypeDEKRewrapped, tenantID, map[string]any{
			"key_version": newVersion,
			"dek_id":      rec.DEKID,
		})
	})
}

// ResumeRotation completes a rotation that began but did not finish — a tenant
// whose newest KEK version is in 'rotating' state while the prior version is
// still 'active' (e.g. the process crashed mid-rewrap). It re-derives both
// providers, rewraps any DEKs still at the old version, and performs the same
// atomic flip as Rotate. It is idempotent: a DEK already at the new version is
// skipped, and the flip's count re-check ensures the old version is retired only
// after every DEK is rewrapped. Used by the recovery loop.
func (s *Service) ResumeRotation(ctx context.Context, tenantID uuid.UUID) error {
	s.rotateMu.Lock()
	if _, busy := s.rotateSet[tenantID]; busy {
		s.rotateMu.Unlock()
		return nil // an in-process Rotate owns it
	}
	s.rotateSet[tenantID] = struct{}{}
	s.rotateMu.Unlock()
	defer func() {
		s.rotateMu.Lock()
		delete(s.rotateSet, tenantID)
		s.rotateMu.Unlock()
	}()

	var (
		oldKEK *TenantKEK
		newKEK *TenantKEK
	)
	var err error
	oldKEK, newKEK, err = s.loadRotationState(ctx, tenantID)
	if err != nil {
		return err
	}
	if newKEK == nil {
		return nil // nothing to resume
	}

	oldKP, _, perr := s.factory.Provider(ctx, tenantID, oldKEK.Provider, oldKEK.Reference, oldKEK.KeyVersion, false)
	if perr != nil {
		return fmt.Errorf("byok: resume loading old KEK v%d: %w", oldKEK.KeyVersion, perr)
	}
	newKP, _, perr := s.factory.Provider(ctx, tenantID, newKEK.Provider, newKEK.Reference, newKEK.KeyVersion, false)
	if perr != nil {
		return fmt.Errorf("byok: resume loading new KEK v%d: %w", newKEK.KeyVersion, perr)
	}

	var deks []*WrappedDEK
	if err := s.system.RunSystemRead(ctx, func(db repository.DBTX) error {
		var lerr error
		deks, lerr = s.store.ListWrappedDEKsSystem(ctx, db, tenantID)
		return lerr
	}); err != nil {
		return err
	}
	rewrapped := 0
	for _, rec := range deks {
		if err := ctx.Err(); err != nil {
			return err
		}
		if rec.KEKVersion == newKEK.KeyVersion {
			continue
		}
		if err := s.rewrapOne(ctx, tenantID, rec, oldKP, newKP, newKEK.KeyVersion); err != nil {
			return fmt.Errorf("byok: resume rewrapping DEK %q: %w", rec.DEKID, err)
		}
		rewrapped++
	}

	if err := s.system.RunSystemTx(ctx, func(db repository.DBTX) error {
		remaining, cerr := s.store.CountWrappedNotAtVersion(ctx, db, tenantID, newKEK.KeyVersion)
		if cerr != nil {
			return cerr
		}
		if remaining != 0 {
			return fmt.Errorf("%w: %d DEKs not yet rewrapped to v%d", ErrInvalidState, remaining, newKEK.KeyVersion)
		}
		if _, rerr := s.store.SetKEKState(ctx, db, tenantID, oldKEK.KeyVersion, KEKStateRetired); rerr != nil {
			return rerr
		}
		if _, aerr := s.store.SetKEKState(ctx, db, tenantID, newKEK.KeyVersion, KEKStateActive); aerr != nil {
			return aerr
		}
		if cerr := s.appendCustody(ctx, db, tenantID, ActionRotateComplete, newKEK.KeyVersion, "", fmt.Sprintf("rotation v%d -> v%d completed on resume (%d DEKs rewrapped)", oldKEK.KeyVersion, newKEK.KeyVersion, rewrapped)); cerr != nil {
			return cerr
		}
		return s.emit(ctx, db, EventTypeRotationDone, tenantID, map[string]any{
			"old_version":    oldKEK.KeyVersion,
			"new_version":    newKEK.KeyVersion,
			"deks_rewrapped": rewrapped,
			"resumed":        true,
		})
	}); err != nil {
		return err
	}
	s.metrics.IncRewrap(rewrapped)
	s.metrics.IncRotation()
	s.logger.Info().Str("tenant_id", tenantID.String()).Int("old", oldKEK.KeyVersion).
		Int("new", newKEK.KeyVersion).Int("rewrapped", rewrapped).Msg("byok rotation resumed and completed")
	return nil
}

// loadRotationState returns the active KEK and, when present, the single
// rotating successor for a tenant. Multiple rotating versions or a non-successor
// rotating version indicate a broken custody invariant and must not be guessed
// around.
func (s *Service) loadRotationState(ctx context.Context, tenantID uuid.UUID) (*TenantKEK, *TenantKEK, error) {
	var (
		active   *TenantKEK
		rotating *TenantKEK
	)
	err := s.system.RunSystemRead(ctx, func(db repository.DBTX) error {
		var err error
		active, err = s.store.GetActiveKEKSystem(ctx, db, tenantID)
		if err != nil {
			return err
		}
		keks, err := s.store.ListKEKs(ctx, db, tenantID)
		if err != nil {
			return err
		}
		rotating, err = singleRotatingKEK(keks, active.KeyVersion)
		return err
	})
	return active, rotating, err
}

func singleRotatingKEK(keks []*TenantKEK, activeVersion int) (*TenantKEK, error) {
	var out *TenantKEK
	for _, k := range keks {
		if k.State != KEKStateRotating {
			continue
		}
		if k.KeyVersion <= activeVersion {
			return nil, fmt.Errorf("%w: rotating KEK v%d does not exceed active v%d", ErrInvalidState, k.KeyVersion, activeVersion)
		}
		if out != nil {
			return nil, fmt.Errorf("%w: multiple rotating KEK versions present", ErrInvalidState)
		}
		out = k
	}
	return out, nil
}

// ListKEKs returns the tenant's KEK versions and states.
func (s *Service) ListKEKs(ctx context.Context, tenantID uuid.UUID) ([]*TenantKEK, error) {
	var out []*TenantKEK
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		var lerr error
		out, lerr = s.store.ListKEKs(ctx, db, tenantID)
		return lerr
	})
	return out, err
}

// CustodyLog returns the tenant's hash-chained custody entries (ascending seq).
func (s *Service) CustodyLog(ctx context.Context, tenantID uuid.UUID) ([]*CustodyEntry, error) {
	var out []*CustodyEntry
	err := s.runner.RunReadWithTenant(ctx, tenantID, func(db repository.DBTX) error {
		var lerr error
		out, lerr = s.store.ListCustody(ctx, db, tenantID)
		return lerr
	})
	return out, err
}

// VerifyCustody loads the tenant's custody chain and verifies its hash linkage,
// returning whether it is intact, the seq of the first break (0 if intact), and
// the current Merkle root over all entries.
func (s *Service) VerifyCustody(ctx context.Context, tenantID uuid.UUID) (intact bool, brokenSeq int64, merkleRoot string, err error) {
	entries, lerr := s.CustodyLog(ctx, tenantID)
	if lerr != nil {
		return false, 0, "", lerr
	}
	intact, brokenSeq = VerifyChain(entries)
	return intact, brokenSeq, MerkleRoot(entries), nil
}

// appendCustody computes the hash-chained entry over the tenant's current tip and
// persists it within the caller's transaction, advancing the chain. It reads the
// tip inside the same transaction so concurrent appends serialize on the
// (tenant, seq) unique constraint.
func (s *Service) appendCustody(ctx context.Context, db repository.DBTX, tenantID uuid.UUID, action string, kekVersion int, dekID, detail string) error {
	tipSeq, tipHash, terr := s.store.CustodyTip(ctx, db, tenantID)
	if terr != nil {
		return terr
	}
	entry := &CustodyEntry{
		TenantID:   tenantID,
		Seq:        tipSeq + 1,
		Action:     action,
		KEKVersion: kekVersion,
		DEKID:      dekID,
		Detail:     detail,
		PrevHash:   tipHash,
	}
	entry.EntryHash = ComputeEntryHash(tipHash, entry)
	if aerr := s.store.AppendCustody(ctx, db, entry); aerr != nil {
		return aerr
	}
	s.metrics.IncCustody()
	return nil
}

// emit stages a custody lifecycle event to the DR events outbox within the
// caller's transaction so the ledger state + event commit atomically.
func (s *Service) emit(ctx context.Context, db repository.DBTX, eventType string, tenantID uuid.UUID, data map[string]any) error {
	if _, ok := data["tenant_id"]; !ok {
		data["tenant_id"] = tenantID.String()
	}
	evt, err := events.NewEvent(eventType, eventSource, tenantID.String(), data)
	if err != nil {
		return fmt.Errorf("byok: building %s event: %w", eventType, err)
	}
	if err := outbox.Write(ctx, db, drEventsTopic, evt); err != nil {
		return fmt.Errorf("byok: staging %s event: %w", eventType, err)
	}
	return nil
}

// zero overwrites a byte slice (best-effort wiping of transient DEK plaintext).
func zero(b []byte) {
	for i := range b {
		b[i] = 0
	}
}
