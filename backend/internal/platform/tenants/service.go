package tenants

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
	"github.com/clario360/platform/internal/events"
)

// maxImpersonationTTL is the hard upper bound on an act-as token lifetime,
// independent of any caller-supplied ttl_seconds (doc §E.2 impersonation reqs).
const maxImpersonationTTL = 900 * time.Second

// validation/conflict sentinels mapped to HTTP status by the handler.
var (
	ErrValidation = fmt.Errorf("validation")
	ErrConflict   = fmt.Errorf("conflict")
)

// tenantRepo is the platform_core data-access seam the Service depends on.
// *Repository satisfies it; tests supply a mock so the security-critical
// suspend/impersonate orchestration can be exercised without a live database.
type tenantRepo interface {
	ListTenants(ctx context.Context, p ListParams) ([]AdminTenantSummary, int, error)
	GetTenant(ctx context.Context, tenantID string) (*AdminTenantSummary, error)
	Summary(ctx context.Context) (*PlatformSummary, error)
	GetTenantIdentity(ctx context.Context, tenantID string) (*tenantIdentity, error)
	SetTenantStatus(ctx context.Context, tenantID, status string) error
	SuspendUsers(ctx context.Context, tenantID string) error
	ReactivateUsers(ctx context.Context, tenantID string) error
	DeleteSessions(ctx context.Context, tenantID string) error
	RevokeAPIKeys(ctx context.Context, tenantID string) error
	ResolveImpersonationTarget(ctx context.Context, tenantID, targetUserID string) (*targetUser, error)
	InsertAuditLog(ctx context.Context, tenantID, actorID, action string, metadata []byte) error
}

// tokenSigner is the impersonation-token minting seam. *auth.JWTManager
// satisfies it; tests supply a fake to assert the TTL passed to the signer
// without any DB or RSA-key wiring.
type tokenSigner interface {
	GenerateImpersonationToken(targetUserID, targetTenantID, targetEmail string, targetRoles []string, impersonatorUserID string, ttl time.Duration) (string, error)
}

// Service orchestrates cross-tenant admin tenant operations (gaps G2–G5).
// It is self-contained: it depends only on its own Repository (platform_core),
// the shared JWTManager, redis (for session invalidation), and an optional
// events.Producer for best-effort event publication. The synchronous audit
// write goes through the Repository so it is fail-closed.
type Service struct {
	repo     tenantRepo
	jwt      tokenSigner
	redis    *redis.Client
	producer *events.Producer
	logger   zerolog.Logger
}

// NewService builds the platform tenants service. producer may be nil.
func NewService(repo *Repository, jwtMgr *auth.JWTManager, redisClient *redis.Client, producer *events.Producer, logger zerolog.Logger) *Service {
	return &Service{
		repo:     repo,
		jwt:      jwtMgr,
		redis:    redisClient,
		producer: producer,
		logger:   logger.With().Str("service", "platform_tenants").Logger(),
	}
}

// List implements gap G2.
func (s *Service) List(ctx context.Context, p ListParams) ([]AdminTenantSummary, int, error) {
	return s.repo.ListTenants(ctx, p)
}

// Get returns a single tenant's AdminTenantSummary (gap G2 detail). It reuses the
// list projection filtered by id and surfaces ErrNotFound when the tenant is absent.
func (s *Service) Get(ctx context.Context, tenantID string) (*AdminTenantSummary, error) {
	return s.repo.GetTenant(ctx, tenantID)
}

// Summary implements gap G3.
func (s *Service) Summary(ctx context.Context) (*PlatformSummary, error) {
	return s.repo.Summary(ctx)
}

// Suspend implements gap G4: a REAL suspend that cuts access without
// soft-deleting rows, tagging buckets or setting retain_until. It flips tenant
// + user status to suspended, deletes DB sessions, clears redis sessions and
// revokes API keys — reusing the same store operations the deprovisioner uses,
// minus the destructive lifecycle steps.
func (s *Service) Suspend(ctx context.Context, tenantID, adminID, reason string) error {
	if strings.TrimSpace(reason) == "" {
		return fmt.Errorf("suspend reason is required: %w", ErrValidation)
	}
	ti, err := s.repo.GetTenantIdentity(ctx, tenantID)
	if err != nil {
		return err
	}
	switch ti.Status {
	case "suspended":
		return fmt.Errorf("tenant is already suspended: %w", ErrConflict)
	case "deprovisioned":
		return fmt.Errorf("tenant is deprovisioned; reactivate before suspending: %w", ErrConflict)
	}

	if err := s.repo.SetTenantStatus(ctx, tenantID, "suspended"); err != nil {
		return err
	}
	if err := s.repo.SuspendUsers(ctx, tenantID); err != nil {
		return err
	}
	if err := s.repo.DeleteSessions(ctx, tenantID); err != nil {
		return err
	}
	if err := s.clearRedisSessions(ctx, tenantID); err != nil {
		// Best-effort: DB sessions are already gone; log and continue.
		s.logger.Warn().Err(err).Str("tenant_id", tenantID).Msg("redis session invalidation failed during suspend")
	}
	if err := s.repo.RevokeAPIKeys(ctx, tenantID); err != nil {
		return err
	}

	// Synchronous, fail-closed audit before signalling success.
	if err := s.repo.InsertAuditLog(ctx, tenantID, adminID, "tenant.suspended", marshalMeta(map[string]any{
		"reason":      reason,
		"tenant_name": ti.Name,
	})); err != nil {
		return fmt.Errorf("audit suspend: %w", err)
	}
	s.publishEvent(ctx, "platform.tenant.suspended", tenantID, adminID, map[string]any{
		"tenant_id": tenantID,
		"reason":    reason,
	})
	return nil
}

// Unsuspend implements gap G4: reverses Suspend by restoring tenant + user
// status to active. Sessions and API keys are not auto-restored (sessions were
// deleted; keys were revoked) — users re-authenticate, keys are re-issued.
func (s *Service) Unsuspend(ctx context.Context, tenantID, adminID string) error {
	ti, err := s.repo.GetTenantIdentity(ctx, tenantID)
	if err != nil {
		return err
	}
	if ti.Status != "suspended" {
		return fmt.Errorf("tenant is not suspended: %w", ErrConflict)
	}
	if err := s.repo.SetTenantStatus(ctx, tenantID, "active"); err != nil {
		return err
	}
	if err := s.repo.ReactivateUsers(ctx, tenantID); err != nil {
		return err
	}
	if err := s.repo.InsertAuditLog(ctx, tenantID, adminID, "tenant.unsuspended", marshalMeta(map[string]any{
		"tenant_name": ti.Name,
	})); err != nil {
		return fmt.Errorf("audit unsuspend: %w", err)
	}
	s.publishEvent(ctx, "platform.tenant.unsuspended", tenantID, adminID, map[string]any{
		"tenant_id": tenantID,
	})
	return nil
}

// ImpersonateResult is the response payload for gap G5.
type ImpersonateResult struct {
	AccessToken        string    `json:"access_token"`
	ExpiresAt          time.Time `json:"expires_at"`
	ImpersonatedUserID string    `json:"impersonated_user_id"`
	TenantID           string    `json:"tenant_id"`
	Readonly           bool      `json:"readonly"`
}

// Impersonate implements gap G5: mints a read-only, short-TTL act-as token for a
// target user in another tenant. ttlSeconds is hard-capped at 900s. The start
// is MANDATORILY audited (synchronous, fail-closed) before the token is returned.
func (s *Service) Impersonate(ctx context.Context, tenantID, adminID, targetUserID, reason string, ttlSeconds int) (*ImpersonateResult, error) {
	if strings.TrimSpace(reason) == "" {
		return nil, fmt.Errorf("impersonation reason is required: %w", ErrValidation)
	}
	ti, err := s.repo.GetTenantIdentity(ctx, tenantID)
	if err != nil {
		return nil, err
	}

	target, err := s.repo.ResolveImpersonationTarget(ctx, tenantID, targetUserID)
	if err != nil {
		return nil, err
	}

	ttl := time.Duration(ttlSeconds) * time.Second
	if ttl <= 0 || ttl > maxImpersonationTTL {
		ttl = maxImpersonationTTL
	}

	expiresAt := time.Now().Add(ttl)
	token, err := s.jwt.GenerateImpersonationToken(
		target.ID, tenantID, target.Email, target.Roles, adminID, ttl,
	)
	if err != nil {
		return nil, fmt.Errorf("minting impersonation token: %w", err)
	}

	// MANDATORY audit on start — synchronous and fail-closed: if the audit write
	// fails the token is never returned.
	if err := s.repo.InsertAuditLog(ctx, tenantID, adminID, "tenant.impersonation.started", marshalMeta(map[string]any{
		"reason":          reason,
		"target_user_id":  target.ID,
		"target_email":    target.Email,
		"impersonated_by": adminID,
		"tenant_name":     ti.Name,
		"ttl_seconds":     int(ttl.Seconds()),
		"expires_at":      expiresAt.UTC().Format(time.RFC3339),
	})); err != nil {
		return nil, fmt.Errorf("audit impersonation start: %w", err)
	}
	s.publishEvent(ctx, "platform.tenant.impersonation.started", tenantID, adminID, map[string]any{
		"tenant_id":      tenantID,
		"target_user_id": target.ID,
		"reason":         reason,
	})

	return &ImpersonateResult{
		AccessToken:        token,
		ExpiresAt:          expiresAt,
		ImpersonatedUserID: target.ID,
		TenantID:           tenantID,
		Readonly:           true,
	}, nil
}

// StopImpersonation records the end of an impersonation session (gap G5). The
// minted token has no server-side state and simply expires, so this is a
// best-effort audit signal for attribution. tenantID/targetUserID are optional.
func (s *Service) StopImpersonation(ctx context.Context, adminID, tenantID, targetUserID, reason string) error {
	auditTenant := tenantID
	if strings.TrimSpace(auditTenant) == "" {
		// audit_logs.tenant_id is NOT NULL; fall back to the actor's id-less marker
		// is not possible, so require the caller to pass a tenant when known. When
		// unknown we still try with an empty string and let the DB reject — but to
		// keep this best-effort we only audit when a tenant is provided.
		s.logger.Info().Str("admin_id", adminID).Msg("impersonation stopped (no tenant context; audit skipped)")
		return nil
	}
	if err := s.repo.InsertAuditLog(ctx, auditTenant, adminID, "tenant.impersonation.stopped", marshalMeta(map[string]any{
		"target_user_id":  targetUserID,
		"impersonated_by": adminID,
		"reason":          reason,
	})); err != nil {
		// best-effort: log but do not fail the stop call.
		s.logger.Warn().Err(err).Str("admin_id", adminID).Msg("failed to audit impersonation stop")
	}
	s.publishEvent(ctx, "platform.tenant.impersonation.stopped", auditTenant, adminID, map[string]any{
		"tenant_id":      auditTenant,
		"target_user_id": targetUserID,
	})
	return nil
}

// clearRedisSessions removes redis session keys for the tenant, matching the
// deprovisioner's pattern ("session:*:<tenantID>:*").
func (s *Service) clearRedisSessions(ctx context.Context, tenantID string) error {
	if s.redis == nil {
		return nil
	}
	pattern := fmt.Sprintf("session:*:%s:*", tenantID)
	var cursor uint64
	for {
		keys, next, err := s.redis.Scan(ctx, cursor, pattern, 100).Result()
		if err != nil {
			return err
		}
		if len(keys) > 0 {
			if err := s.redis.Del(ctx, keys...).Err(); err != nil {
				return err
			}
		}
		if next == 0 {
			break
		}
		cursor = next
	}
	return nil
}

func (s *Service) publishEvent(ctx context.Context, eventType, tenantID, userID string, payload map[string]any) {
	if s.producer == nil {
		return
	}
	evt, err := events.NewEvent(eventType, "platform-admin", tenantID, payload)
	if err != nil {
		s.logger.Error().Err(err).Str("event_type", eventType).Msg("create platform tenant event")
		return
	}
	if userID != "" {
		evt.UserID = userID
	}
	if err := s.producer.Publish(ctx, events.Topics.OnboardingEvents, evt); err != nil {
		s.logger.Error().Err(err).Str("event_type", eventType).Msg("publish platform tenant event")
	}
}

func marshalMeta(m map[string]any) []byte {
	b, err := json.Marshal(m)
	if err != nil {
		return []byte("{}")
	}
	return b
}
