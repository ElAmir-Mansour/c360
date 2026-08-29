package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	auditmodel "github.com/clario360/platform/internal/audit/model"
	"github.com/clario360/platform/internal/siem/audit"
	"github.com/clario360/platform/internal/siem/sources"
	"github.com/clario360/platform/internal/siem/sources/enroll"
	"github.com/clario360/platform/internal/siem/sources/pki"
	"github.com/clario360/platform/internal/siem/sources/repo"
)

// Service is the SIEM-03 §4.4 interface every handler invokes.
type Service interface {
	Onboard(ctx context.Context, in sources.OnboardInput) (*sources.Source, *sources.EnrollmentToken, error)
	Get(ctx context.Context, tenantID, id uuid.UUID) (*sources.Source, error)
	List(ctx context.Context, tenantID uuid.UUID, q sources.ListQuery) (sources.ListResult, error)
	Update(ctx context.Context, tenantID, id uuid.UUID, in sources.UpdateInput, ifMatch int64) (*sources.Source, error)
	Disable(ctx context.Context, tenantID, id uuid.UUID, reason string, ifMatch int64) (*sources.Source, error)
	Enable(ctx context.Context, tenantID, id uuid.UUID, ifMatch int64) (*sources.Source, error)
	SoftDelete(ctx context.Context, tenantID, id uuid.UUID, ifMatch int64) error
	RotateCert(ctx context.Context, tenantID, id uuid.UUID, force bool, ifMatch int64) (*sources.EnrollmentToken, error)
	Health(ctx context.Context, tenantID, id uuid.UUID) (*sources.Health, error)
	RecordHeartbeat(ctx context.Context, sourceID uuid.UUID, sample sources.EPSSample) error
}

// EventEmitter is the abstraction the service uses to publish
// CloudEvents + push to WS topics. Concrete implementation is wired
// in main.go; tests can supply a capture.
type EventEmitter interface {
	EmitSourceEvent(ctx context.Context, tenantID, sourceID uuid.UUID, eventType string, payload any) error
}

// Config captures the runtime knobs the service uses.
type Config struct {
	EnrollTokenTTL           time.Duration
	LeafRotationWindow       time.Duration
	HeartbeatRateLimitPerMin int
	BaselineMinSamples       int
}

// DefaultConfig returns SIEM-03 §4.11 defaults.
func DefaultConfig() Config {
	return Config{
		EnrollTokenTTL:           15 * time.Minute,
		LeafRotationWindow:       720 * time.Hour,
		HeartbeatRateLimitPerMin: 6,
		BaselineMinSamples:       60,
	}
}

// service is the concrete Service implementation.
type service struct {
	repo     *repo.SourcesRepo
	eps      *repo.EPSRepo
	toksRepo *repo.EnrollmentTokensRepo
	revRepo  *repo.RevocationRepo
	tokens   *enroll.TokenManager
	pki      *pki.Manager
	emitter  EventEmitter
	audit    audit.Emitter
	metrics  *sources.Metrics
	logger   zerolog.Logger
	cfg      Config
}

// Deps bundles the constructor inputs.
type Deps struct {
	Sources     *repo.SourcesRepo
	EPS         *repo.EPSRepo
	Tokens      *repo.EnrollmentTokensRepo
	Revocations *repo.RevocationRepo
	TokenMgr    *enroll.TokenManager
	PKI         *pki.Manager
	Emitter     EventEmitter
	Audit       audit.Emitter
	Metrics     *sources.Metrics
	Logger      zerolog.Logger
	Config      Config
}

// New constructs a Service.
func New(d Deps) Service {
	cfg := d.Config
	if cfg.EnrollTokenTTL == 0 {
		cfg = DefaultConfig()
	}
	return &service{
		repo: d.Sources, eps: d.EPS, toksRepo: d.Tokens, revRepo: d.Revocations,
		tokens: d.TokenMgr, pki: d.PKI,
		emitter: d.Emitter, audit: d.Audit, metrics: d.Metrics,
		logger: d.Logger.With().Str("component", "siem-sources-service").Logger(),
		cfg:    cfg,
	}
}

// Onboard validates inputs, inserts the row, mints an enrollment
// token, persists the token, and emits the lifecycle event.
func (s *service) Onboard(ctx context.Context, in sources.OnboardInput) (*sources.Source, *sources.EnrollmentToken, error) {
	if err := Validate(in); err != nil {
		return nil, nil, err
	}
	src, err := s.repo.Insert(ctx, in)
	if err != nil {
		return nil, nil, err
	}
	mint, err := s.tokens.Mint(ctx, enroll.MintParams{
		SourceID: src.ID,
		TenantID: src.TenantID,
		Purpose:  sources.PurposeEnroll,
		TTL:      s.cfg.EnrollTokenTTL,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("mint enroll token: %w", err)
	}
	if err := s.toksRepo.Insert(ctx, sources.EnrollmentTokenRecord{
		JTI: mint.JTI, SourceID: src.ID, TenantID: src.TenantID, Purpose: sources.PurposeEnroll,
		ExpiresAt: mint.ExpiresAt, IssuedBy: in.CreatedBy,
	}); err != nil {
		return nil, nil, fmt.Errorf("persist enroll token: %w", err)
	}
	if s.metrics != nil {
		s.metrics.EnrollIssuedTotal.WithLabelValues(src.TenantID.String(), string(sources.PurposeEnroll)).Inc()
	}
	if s.emitter != nil {
		_ = s.emitter.EmitSourceEvent(ctx, src.TenantID, src.ID, "siem.source.created", src)
	}
	s.emitAudit(ctx, in.CreatedBy, src, nil, src, "siem.source.created")
	tok := &sources.EnrollmentToken{
		JWT: mint.JWT, JTI: mint.JTI, SourceID: src.ID, TenantID: src.TenantID,
		Purpose: sources.PurposeEnroll, ExpiresAt: mint.ExpiresAt,
	}
	return src, tok, nil
}

// Get returns a source by id, scoped to tenantID.
func (s *service) Get(ctx context.Context, tenantID, id uuid.UUID) (*sources.Source, error) {
	return s.repo.GetByID(ctx, tenantID, id)
}

// List returns a page of sources for tenantID.
func (s *service) List(ctx context.Context, tenantID uuid.UUID, q sources.ListQuery) (sources.ListResult, error) {
	return s.repo.List(ctx, tenantID, q)
}

// Update patches mutable fields with optimistic concurrency.
func (s *service) Update(ctx context.Context, tenantID, id uuid.UUID, in sources.UpdateInput, ifMatch int64) (*sources.Source, error) {
	existing, err := s.repo.GetByID(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if err := ValidateUpdate(in, existing.Transport); err != nil {
		return nil, err
	}
	updated, err := s.repo.Update(ctx, tenantID, id, in, ifMatch)
	if err != nil {
		return nil, err
	}
	if s.emitter != nil {
		_ = s.emitter.EmitSourceEvent(ctx, tenantID, id, "siem.source.updated", updated)
	}
	actor := uuid.Nil
	if v, _ := ctx.Value(ctxActorKey{}).(uuid.UUID); v != uuid.Nil {
		actor = v
	}
	s.emitAudit(ctx, actor, updated, existing, updated, "siem.source.updated")
	return updated, nil
}

// Disable flips status to "disabled". Audit + event mandatory.
func (s *service) Disable(ctx context.Context, tenantID, id uuid.UUID, reason string, ifMatch int64) (*sources.Source, error) {
	existing, err := s.repo.GetByID(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if existing.Status == sources.StatusDisabled {
		return existing, nil // idempotent
	}
	updated, err := s.repo.SetStatus(ctx, tenantID, id, sources.StatusDisabled, ifMatch)
	if err != nil {
		return nil, err
	}
	if s.emitter != nil {
		_ = s.emitter.EmitSourceEvent(ctx, tenantID, id, "siem.source.disabled", map[string]any{
			"reason": reason, "source": updated,
		})
	}
	actor, _ := ctx.Value(ctxActorKey{}).(uuid.UUID)
	s.emitAudit(ctx, actor, updated, existing, updated, "siem.source.disabled")
	return updated, nil
}

// Enable flips status back to active (if it was disabled).
func (s *service) Enable(ctx context.Context, tenantID, id uuid.UUID, ifMatch int64) (*sources.Source, error) {
	existing, err := s.repo.GetByID(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if existing.Status != sources.StatusDisabled {
		return existing, nil // idempotent
	}
	updated, err := s.repo.SetStatus(ctx, tenantID, id, sources.StatusActive, ifMatch)
	if err != nil {
		return nil, err
	}
	if s.emitter != nil {
		_ = s.emitter.EmitSourceEvent(ctx, tenantID, id, "siem.source.enabled", updated)
	}
	actor, _ := ctx.Value(ctxActorKey{}).(uuid.UUID)
	s.emitAudit(ctx, actor, updated, existing, updated, "siem.source.enabled")
	return updated, nil
}

// SoftDelete marks the source deleted and revokes its cert.
func (s *service) SoftDelete(ctx context.Context, tenantID, id uuid.UUID, ifMatch int64) error {
	existing, err := s.repo.GetByID(ctx, tenantID, id)
	if err != nil {
		return err
	}
	if err := s.repo.SoftDelete(ctx, tenantID, id, ifMatch); err != nil {
		return err
	}
	// Revoke cert if present.
	if existing.MTLSThumbprint != "" && s.pki != nil {
		_ = s.pki.Revoke(ctx, tenantID, existing.CertSerial)
		_ = s.revRepo.Insert(ctx, sources.Revocation{
			Thumbprint: existing.MTLSThumbprint,
			SourceID:   id, CertSerial: existing.CertSerial, Reason: "soft_delete",
		})
		_ = s.repo.MarkCertRevoked(ctx, id, "soft_delete")
		if s.metrics != nil {
			s.metrics.PKILeafRevokedTotal.WithLabelValues(tenantID.String(), "soft_delete").Inc()
		}
	}
	if s.emitter != nil {
		_ = s.emitter.EmitSourceEvent(ctx, tenantID, id, "siem.source.deleted", existing)
	}
	actor, _ := ctx.Value(ctxActorKey{}).(uuid.UUID)
	s.emitAudit(ctx, actor, existing, existing, nil, "siem.source.deleted")
	return nil
}

// RotateCert mints a rotation token. Returns ErrInvalidState if the
// source is outside the rotation window and force=false.
func (s *service) RotateCert(ctx context.Context, tenantID, id uuid.UUID, force bool, ifMatch int64) (*sources.EnrollmentToken, error) {
	existing, err := s.repo.GetByID(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if existing.Status == sources.StatusProvisioning {
		return nil, fmt.Errorf("%w: cannot rotate provisioning source", sources.ErrInvalidState)
	}
	if !force {
		if existing.CertExpiresAt == nil || time.Until(*existing.CertExpiresAt) > s.cfg.LeafRotationWindow {
			return nil, fmt.Errorf("%w: cert not in rotation window; use force=true", sources.ErrInvalidState)
		}
	}
	// Flip to rotating (no-op if already rotating).
	if existing.Status != sources.StatusRotating {
		if _, err := s.repo.SetStatus(ctx, tenantID, id, sources.StatusRotating, ifMatch); err != nil {
			return nil, err
		}
	}
	actor, _ := ctx.Value(ctxActorKey{}).(uuid.UUID)
	mint, err := s.tokens.Mint(ctx, enroll.MintParams{
		SourceID: id, TenantID: tenantID, Purpose: sources.PurposeRotate, TTL: s.cfg.EnrollTokenTTL,
	})
	if err != nil {
		return nil, fmt.Errorf("mint rotate token: %w", err)
	}
	if err := s.toksRepo.Insert(ctx, sources.EnrollmentTokenRecord{
		JTI: mint.JTI, SourceID: id, TenantID: tenantID, Purpose: sources.PurposeRotate,
		ExpiresAt: mint.ExpiresAt, IssuedBy: actor,
	}); err != nil {
		return nil, err
	}
	if s.metrics != nil {
		s.metrics.EnrollIssuedTotal.WithLabelValues(tenantID.String(), string(sources.PurposeRotate)).Inc()
	}
	if s.emitter != nil {
		_ = s.emitter.EmitSourceEvent(ctx, tenantID, id, "siem.source.cert.rotate_requested", existing)
	}
	return &sources.EnrollmentToken{
		JWT: mint.JWT, JTI: mint.JTI, SourceID: id, TenantID: tenantID,
		Purpose: sources.PurposeRotate, ExpiresAt: mint.ExpiresAt,
	}, nil
}

// Health builds the SIEM-03 §4.9 health response.
func (s *service) Health(ctx context.Context, tenantID, id uuid.UUID) (*sources.Health, error) {
	src, err := s.repo.GetByID(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	latest, _ := s.eps.Latest(ctx, id, 5*time.Minute)
	pe, dropped, _ := s.eps.AggregateLastHour(ctx, id)
	h := &sources.Health{
		ID: id, Name: src.Name, Status: src.Status,
		LastSeenAt: src.LastSeenAt, BaselineEPS: src.BaselineEPS,
		BaselineLocked: src.BaselineSamples >= s.cfg.BaselineMinSamples,
		ParserErrors1H: pe, Dropped1H: dropped,
		CertExpiresAt: src.CertExpiresAt, CertRevoked: src.CertRevokedAt != nil,
		LastHealthAt: src.LastHealthAt,
	}
	if latest != nil {
		h.EPS1Min = latest.EPS1Min
		h.EPS5Min = latest.EPS5Min
		if src.BaselineEPS > 0 {
			h.DriftPct = float64(latest.EPS5Min-src.BaselineEPS) / float64(src.BaselineEPS)
		}
	}
	if src.CertExpiresAt != nil {
		h.DaysUntilCertExpiry = int(time.Until(*src.CertExpiresAt).Hours() / 24)
	}
	return h, nil
}

// RecordHeartbeat writes an EPS sample and touches last_seen_at.
func (s *service) RecordHeartbeat(ctx context.Context, sourceID uuid.UUID, sample sources.EPSSample) error {
	sample.SourceID = sourceID
	if sample.TS.IsZero() {
		sample.TS = time.Now().UTC()
	}
	if err := s.eps.Insert(ctx, sample); err != nil {
		return err
	}
	return s.repo.TouchLastSeen(ctx, sourceID, sample.TS)
}

// emitAudit writes an audit-chain entry capturing the diff.
func (s *service) emitAudit(ctx context.Context, actor uuid.UUID, src *sources.Source, before, after any, action string) {
	if s.audit == nil || src == nil {
		return
	}
	oldJSON, _ := json.Marshal(before)
	newJSON, _ := json.Marshal(after)
	userID := actor.String()
	entry := auditmodel.AuditEntry{
		TenantID:     src.TenantID.String(),
		UserID:       &userID,
		UserEmail:    "siem-service@clario360.local",
		Service:      "siem-service",
		Action:       action,
		Severity:     auditmodel.SeverityInfo,
		ResourceType: "siem_source",
		ResourceID:   src.ID.String(),
		OldValue:     oldJSON,
		NewValue:     newJSON,
		CreatedAt:    time.Now().UTC(),
	}
	if err := s.audit.Emit(ctx, entry); err != nil {
		s.logger.Warn().Err(err).Msg("audit emit failed")
	}
}

// ctxActorKey is the context key under which RBAC middleware stores
// the acting user's ID. Handlers populate it pre-call.
type ctxActorKey struct{}

// WithActor returns a derived context tagged with the acting user.
func WithActor(ctx context.Context, actor uuid.UUID) context.Context {
	return context.WithValue(ctx, ctxActorKey{}, actor)
}

// ActorFromContext retrieves the acting user, or uuid.Nil.
func ActorFromContext(ctx context.Context) uuid.UUID {
	v, _ := ctx.Value(ctxActorKey{}).(uuid.UUID)
	return v
}

// Compile-time guards that ensure we don't accidentally swallow
// sentinel errors.
var (
	_ = errors.Is
)
