// Package service implements the ClarioDR request-path control plane.
//
// The package keeps tenant isolation at the service boundary: every public
// method enters through database.RunWithTenant or database.RunReadWithTenant
// in production, so PostgreSQL RLS sees app.current_tenant_id for the full
// transaction. State changes stage a DR lifecycle event in the same
// transaction.
package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
	drmetrics "github.com/clario360/platform/internal/dr/metrics"
	"github.com/clario360/platform/internal/dr/model"
	"github.com/clario360/platform/internal/dr/recoverytier"
	"github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
)

const (
	eventSource                        = "clario-dr-service"
	defaultRecoveryPointLegalHoldCount = 3
)

// ErrNotConfigured indicates an optional production dependency for a DR
// operation has not been wired in this deployment.
var ErrNotConfigured = errors.New("dr dependency not configured")

// ValidationError marks a caller-correctable request problem.
type ValidationError struct {
	Field   string
	Message string
}

func (e *ValidationError) Error() string {
	if e.Field == "" {
		return e.Message
	}
	return e.Field + ": " + e.Message
}

// IsValidation reports whether err is a service validation error.
func IsValidation(err error) bool {
	var ve *ValidationError
	return errors.As(err, &ve)
}

func invalid(field, message string) error {
	return &ValidationError{Field: field, Message: message}
}

// TenantRunner executes a function under a tenant-scoped transaction.
type TenantRunner interface {
	RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error
	RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error
}

type pgxTenantRunner struct {
	pool *pgxpool.Pool
}

func (r pgxTenantRunner) RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	return database.RunWithTenant(ctx, r.pool, tenantID, func(tx pgx.Tx) error {
		return fn(tx)
	})
}

func (r pgxTenantRunner) RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	return database.RunReadWithTenant(ctx, r.pool, tenantID, func(tx pgx.Tx) error {
		return fn(tx)
	})
}

// EventStager stages lifecycle events in the caller's transaction.
type EventStager interface {
	Stage(ctx context.Context, tx repository.DBTX, eventType string, tenantID string, data map[string]any) error
}

// OutboxStager writes DR events to the transactional outbox.
type OutboxStager struct{}

func (OutboxStager) Stage(ctx context.Context, tx repository.DBTX, eventType string, tenantID string, data map[string]any) error {
	event, err := events.NewEvent(eventType, eventSource, tenantID, data)
	if err != nil {
		return fmt.Errorf("building %s event: %w", eventType, err)
	}
	return outbox.Write(ctx, tx, events.Topics.DREvents, event)
}

type noopStager struct{}

func (noopStager) Stage(context.Context, repository.DBTX, string, string, map[string]any) error {
	return nil
}

// Repository is the persistence contract consumed by the service.
type Repository interface {
	CreateSite(ctx context.Context, db repository.DBTX, s *model.ProtectedSite) error
	GetSite(ctx context.Context, db repository.DBTX, tenantID, id string) (*model.ProtectedSite, error)
	ListSites(ctx context.Context, db repository.DBTX, tenantID string) ([]*model.ProtectedSite, error)

	CreateGroup(ctx context.Context, db repository.DBTX, g *model.ConsistencyGroup) error
	GetGroup(ctx context.Context, db repository.DBTX, tenantID, id string) (*model.ConsistencyGroup, error)
	ListGroups(ctx context.Context, db repository.DBTX, tenantID string) ([]*model.ConsistencyGroup, error)
	AddGroupMember(ctx context.Context, db repository.DBTX, m *model.ConsistencyGroupMember) error
	ListGroupMembers(ctx context.Context, db repository.DBTX, groupID string) ([]model.ConsistencyGroupMember, error)

	CreateStream(ctx context.Context, db repository.DBTX, s *model.ReplicationStream) error
	GetStream(ctx context.Context, db repository.DBTX, tenantID, id string) (*model.ReplicationStream, error)
	GetStreamBySite(ctx context.Context, db repository.DBTX, tenantID, siteID string) (*model.ReplicationStream, error)
	ListStreams(ctx context.Context, db repository.DBTX, tenantID string) ([]*model.ReplicationStream, error)
	SetStreamStatus(ctx context.Context, db repository.DBTX, tenantID, id, status string) error
	PauseTenantStreams(ctx context.Context, db repository.DBTX, tenantID, reason string) (int64, error)

	CreateRecoveryPoint(ctx context.Context, db repository.DBTX, rp *model.RecoveryPoint) error
	GetRecoveryPoint(ctx context.Context, db repository.DBTX, tenantID, id string) (*model.RecoveryPoint, error)
	ListRecoveryPointsByGroup(ctx context.Context, db repository.DBTX, tenantID, groupID string) ([]*model.RecoveryPoint, error)
	SetRecoveryPointValidation(ctx context.Context, db repository.DBTX, tenantID, id string, ratio float64, validated bool) error
	SetRecoveryPointLegalHold(ctx context.Context, db repository.DBTX, tenantID, id string, hold bool) error
	ReconcileRecoveryPointLegalHolds(ctx context.Context, db repository.DBTX, tenantID, groupID string, keepCount int) error

	CreateNetworkMapping(ctx context.Context, db repository.DBTX, m *model.NetworkMapping) error
	ListNetworkMappings(ctx context.Context, db repository.DBTX, tenantID, groupID string) ([]*model.NetworkMapping, error)

	CreateFailoverRun(ctx context.Context, db repository.DBTX, run *model.FailoverRun) error
	GetFailoverRun(ctx context.Context, db repository.DBTX, tenantID, id string) (*model.FailoverRun, error)
	ListFailoverRuns(ctx context.Context, db repository.DBTX, tenantID string) ([]*model.FailoverRun, error)
	GetFailoverApprovalPolicy(ctx context.Context, db repository.DBTX, tenantID, mode string) (*model.ApprovalPolicy, error)
	GetFailoverApprovalByApprover(ctx context.Context, db repository.DBTX, tenantID, runID, approverID string) (*model.FailoverApproval, error)
	CreateFailoverApproval(ctx context.Context, db repository.DBTX, approval *model.FailoverApproval) (bool, error)
	CountFailoverApprovals(ctx context.Context, db repository.DBTX, tenantID, runID, decision string) (int, error)
	CreateBreakGlassEvent(ctx context.Context, db repository.DBTX, event *model.BreakGlassEvent) (bool, error)
	UpdateFailoverRunStatus(ctx context.Context, db repository.DBTX, tenantID, id, newStatus, expectedStatus string, lastError *string) error
	CompleteFailoverRunFromStatus(ctx context.Context, db repository.DBTX, tenantID, id, finalStatus, expectedStatus string, lastError *string) error
	ApproveFailoverRun(ctx context.Context, db repository.DBTX, tenantID, id, approvedBy string) error
	ListFailoverSteps(ctx context.Context, db repository.DBTX, runID string) ([]*model.FailoverStep, error)
	GetAttestationByRun(ctx context.Context, db repository.DBTX, tenantID, runID string) (*model.Attestation, error)

	CreateAgent(ctx context.Context, db repository.DBTX, a *model.DRAgent) error
	GetAgent(ctx context.Context, db repository.DBTX, tenantID, id string) (*model.DRAgent, error)
	ListAgents(ctx context.Context, db repository.DBTX, tenantID string) ([]*model.DRAgent, error)
}

// Service coordinates DR control-plane operations.
type Service struct {
	tx             TenantRunner
	repo           Repository
	stager         EventStager
	logger         zerolog.Logger
	now            func() time.Time
	legalHoldCount int
	rp             *recoveryPointDeps
	journal        *journalDeps
	metrics        *drmetrics.Metrics
	cleanpoint     *cleanPointGate
}

// WithMetrics wires the DR SLO metrics so ValidateRecoveryPoint emits
// dr_recovery_point_validation_ratio. Returns the service for chaining; nil
// metrics is safe (emission becomes a no-op).
func (s *Service) WithMetrics(m *drmetrics.Metrics) *Service {
	s.metrics = m
	return s
}

// New constructs the production service.
func New(pool *pgxpool.Pool, repo Repository, logger zerolog.Logger) *Service {
	return NewWithDeps(pgxTenantRunner{pool: pool}, repo, OutboxStager{}, logger)
}

// NewWithDeps constructs the service with injectable infrastructure for tests.
func NewWithDeps(tx TenantRunner, repo Repository, stager EventStager, logger zerolog.Logger) *Service {
	if stager == nil {
		stager = noopStager{}
	}
	return &Service{
		tx:             tx,
		repo:           repo,
		stager:         stager,
		logger:         logger.With().Str("service", "dr").Logger(),
		now:            func() time.Time { return time.Now().UTC() },
		legalHoldCount: defaultRecoveryPointLegalHoldCount,
	}
}

func (s *Service) read(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	if tenantID == uuid.Nil {
		return invalid("tenant_id", "tenant id is required")
	}
	return s.tx.RunReadWithTenant(ctx, tenantID, fn)
}

func (s *Service) write(ctx context.Context, tenantID uuid.UUID, fn func(repository.DBTX) error) error {
	if tenantID == uuid.Nil {
		return invalid("tenant_id", "tenant id is required")
	}
	return s.tx.RunWithTenant(ctx, tenantID, fn)
}

func (s *Service) stage(ctx context.Context, tx repository.DBTX, eventType string, tenantID uuid.UUID, data map[string]any) error {
	if data == nil {
		data = map[string]any{}
	}
	return s.stager.Stage(ctx, tx, eventType, tenantID.String(), data)
}

// CreateSiteInput is the request to protect a site.
type CreateSiteInput struct {
	Name                string
	Kind                string
	PrimaryEndpoint     string
	RTOObjectiveSeconds int
	RPOObjectiveSeconds int
}

// CreateSite creates a protected site.
func (s *Service) CreateSite(ctx context.Context, tenantID uuid.UUID, in CreateSiteInput) (*model.ProtectedSite, error) {
	if err := validateSiteInput(in); err != nil {
		return nil, err
	}
	if in.RTOObjectiveSeconds == 0 {
		in.RTOObjectiveSeconds = 900
	}
	if in.RPOObjectiveSeconds == 0 {
		in.RPOObjectiveSeconds = 300
	}

	site := &model.ProtectedSite{
		TenantID:            tenantID.String(),
		Name:                strings.TrimSpace(in.Name),
		Kind:                in.Kind,
		PrimaryEndpoint:     strings.TrimSpace(in.PrimaryEndpoint),
		RTOObjectiveSeconds: in.RTOObjectiveSeconds,
		RPOObjectiveSeconds: in.RPOObjectiveSeconds,
	}
	err := s.write(ctx, tenantID, func(tx repository.DBTX) error {
		if err := s.repo.CreateSite(ctx, tx, site); err != nil {
			return err
		}
		return s.stage(ctx, tx, "dr.site.created", tenantID, map[string]any{
			"site_id": site.ID,
			"kind":    site.Kind,
			"name":    site.Name,
		})
	})
	if err != nil {
		return nil, err
	}
	annotateSiteRecoveryTier(site)
	return site, nil
}

func validateSiteInput(in CreateSiteInput) error {
	if strings.TrimSpace(in.Name) == "" {
		return invalid("name", "name is required")
	}
	if !validSiteKind(in.Kind) {
		return invalid("kind", "kind must be one of vm, database, fileset")
	}
	if strings.TrimSpace(in.PrimaryEndpoint) == "" {
		return invalid("primary_endpoint", "primary endpoint is required")
	}
	if in.RTOObjectiveSeconds < 0 {
		return invalid("rto_objective_seconds", "must not be negative")
	}
	if in.RPOObjectiveSeconds < 0 {
		return invalid("rpo_objective_seconds", "must not be negative")
	}
	return nil
}

// GetSite returns one protected site.
func (s *Service) GetSite(ctx context.Context, tenantID, siteID uuid.UUID) (*model.ProtectedSite, error) {
	var site *model.ProtectedSite
	err := s.read(ctx, tenantID, func(tx repository.DBTX) error {
		var err error
		site, err = s.repo.GetSite(ctx, tx, tenantID.String(), siteID.String())
		return err
	})
	if err == nil {
		annotateSiteRecoveryTier(site)
	}
	return site, err
}

// ListSites returns protected sites for the tenant.
func (s *Service) ListSites(ctx context.Context, tenantID uuid.UUID) ([]*model.ProtectedSite, error) {
	var sites []*model.ProtectedSite
	err := s.read(ctx, tenantID, func(tx repository.DBTX) error {
		var err error
		sites, err = s.repo.ListSites(ctx, tx, tenantID.String())
		return err
	})
	if sites == nil {
		sites = []*model.ProtectedSite{}
	}
	if err == nil {
		annotateSitesRecoveryTier(sites)
	}
	return sites, err
}

func annotateSitesRecoveryTier(sites []*model.ProtectedSite) {
	for _, site := range sites {
		annotateSiteRecoveryTier(site)
	}
}

func annotateSiteRecoveryTier(site *model.ProtectedSite) {
	if site == nil {
		return
	}

	site.RecoveryTierRecommendation = nil
	site.ObjectiveFit = &model.ObjectiveFit{
		RTOObjectiveSeconds: site.RTOObjectiveSeconds,
		RPOObjectiveSeconds: site.RPOObjectiveSeconds,
	}

	profile, err := recoverytier.Recommend(recoverytier.RecommendationRequest{
		RTO: time.Duration(site.RTOObjectiveSeconds) * time.Second,
		RPO: time.Duration(site.RPOObjectiveSeconds) * time.Second,
	})
	if err == nil {
		site.ObjectiveFit.Status = model.ObjectiveFitStatusSatisfied
		site.RecoveryTierRecommendation = &model.RecoveryTierRecommendation{
			Tier:                     string(profile.Tier),
			Strategy:                 string(profile.RecommendedStrategy),
			RTOObjectiveSeconds:      int(profile.RTOObjective / time.Second),
			RPOObjectiveSeconds:      int(profile.RPOObjective / time.Second),
			ValidationCadenceSeconds: int(profile.MinimumValidationCadence / time.Second),
			RequiresCyberVault:       profile.RequiresCyberVault,
			RequiresCleanRoom:        profile.RequiresCleanRoom,
			Capabilities:             append([]string(nil), profile.Capabilities...),
			Notes:                    append([]string(nil), profile.Notes...),
		}
		return
	}

	switch {
	case errors.Is(err, recoverytier.ErrInvalidRequest):
		site.ObjectiveFit.Status = model.ObjectiveFitStatusInvalid
		site.ObjectiveFit.Warnings = []string{
			"rto_objective_seconds and rpo_objective_seconds must be greater than zero to evaluate a recovery tier",
		}
	case errors.Is(err, recoverytier.ErrNoRecommendation):
		site.ObjectiveFit.Status = model.ObjectiveFitStatusOutsideCatalog
		site.ObjectiveFit.Warnings = []string{
			"objectives are outside the built-in recovery tier catalog",
		}
	default:
		site.ObjectiveFit.Status = model.ObjectiveFitStatusUnknown
		site.ObjectiveFit.Warnings = []string{
			"could not evaluate recovery tier recommendation: " + err.Error(),
		}
	}
}

// CreateGroupInput is the request to create a consistency group.
type CreateGroupInput struct {
	Name string
}

// CreateGroup creates a consistency group.
func (s *Service) CreateGroup(ctx context.Context, tenantID uuid.UUID, in CreateGroupInput) (*model.ConsistencyGroup, error) {
	if strings.TrimSpace(in.Name) == "" {
		return nil, invalid("name", "name is required")
	}
	group := &model.ConsistencyGroup{TenantID: tenantID.String(), Name: strings.TrimSpace(in.Name)}
	err := s.write(ctx, tenantID, func(tx repository.DBTX) error {
		if err := s.repo.CreateGroup(ctx, tx, group); err != nil {
			return err
		}
		return s.stage(ctx, tx, "dr.group.created", tenantID, map[string]any{
			"group_id": group.ID,
			"name":     group.Name,
		})
	})
	return group, err
}

// GetGroup returns one consistency group.
func (s *Service) GetGroup(ctx context.Context, tenantID, groupID uuid.UUID) (*model.ConsistencyGroup, error) {
	var group *model.ConsistencyGroup
	err := s.read(ctx, tenantID, func(tx repository.DBTX) error {
		var err error
		group, err = s.repo.GetGroup(ctx, tx, tenantID.String(), groupID.String())
		return err
	})
	return group, err
}

// ListGroups returns consistency groups for the tenant.
func (s *Service) ListGroups(ctx context.Context, tenantID uuid.UUID) ([]*model.ConsistencyGroup, error) {
	var groups []*model.ConsistencyGroup
	err := s.read(ctx, tenantID, func(tx repository.DBTX) error {
		var err error
		groups, err = s.repo.ListGroups(ctx, tx, tenantID.String())
		return err
	})
	if groups == nil {
		groups = []*model.ConsistencyGroup{}
	}
	return groups, err
}

// AddGroupMemberInput adds or reorders a protected site in a group.
type AddGroupMemberInput struct {
	SiteID    uuid.UUID
	BootOrder int
}

// AddGroupMember adds or reorders a group member after tenant ownership checks.
func (s *Service) AddGroupMember(ctx context.Context, tenantID, groupID uuid.UUID, in AddGroupMemberInput) (*model.ConsistencyGroupMember, error) {
	if in.SiteID == uuid.Nil {
		return nil, invalid("site_id", "site id is required")
	}
	if in.BootOrder < 0 {
		return nil, invalid("boot_order", "must not be negative")
	}
	if in.BootOrder == 0 {
		in.BootOrder = 100
	}
	member := &model.ConsistencyGroupMember{GroupID: groupID.String(), SiteID: in.SiteID.String(), BootOrder: in.BootOrder}
	err := s.write(ctx, tenantID, func(tx repository.DBTX) error {
		if _, err := s.repo.GetGroup(ctx, tx, tenantID.String(), groupID.String()); err != nil {
			return err
		}
		if _, err := s.repo.GetSite(ctx, tx, tenantID.String(), in.SiteID.String()); err != nil {
			return err
		}
		if err := s.repo.AddGroupMember(ctx, tx, member); err != nil {
			return err
		}
		return s.stage(ctx, tx, "dr.group.member_added", tenantID, map[string]any{
			"group_id":   member.GroupID,
			"site_id":    member.SiteID,
			"boot_order": member.BootOrder,
		})
	})
	return member, err
}

// ListGroupMembers returns a group's members in boot order.
func (s *Service) ListGroupMembers(ctx context.Context, tenantID, groupID uuid.UUID) ([]model.ConsistencyGroupMember, error) {
	var members []model.ConsistencyGroupMember
	err := s.read(ctx, tenantID, func(tx repository.DBTX) error {
		if _, err := s.repo.GetGroup(ctx, tx, tenantID.String(), groupID.String()); err != nil {
			return err
		}
		var err error
		members, err = s.repo.ListGroupMembers(ctx, tx, groupID.String())
		return err
	})
	if members == nil {
		members = []model.ConsistencyGroupMember{}
	}
	return members, err
}

// CreateStreamInput creates a replication stream for a protected site.
type CreateStreamInput struct {
	SiteID uuid.UUID
	Status string
}

// CreateStream creates a stream for a protected site.
func (s *Service) CreateStream(ctx context.Context, tenantID uuid.UUID, in CreateStreamInput) (*model.ReplicationStream, error) {
	if in.SiteID == uuid.Nil {
		return nil, invalid("site_id", "site id is required")
	}
	if in.Status != "" && in.Status != model.StreamStatusPending {
		return nil, invalid("status", "new streams must start pending")
	}
	stream := &model.ReplicationStream{TenantID: tenantID.String(), SiteID: in.SiteID.String(), Status: in.Status}
	err := s.write(ctx, tenantID, func(tx repository.DBTX) error {
		if _, err := s.repo.GetSite(ctx, tx, tenantID.String(), in.SiteID.String()); err != nil {
			return err
		}
		if err := s.repo.CreateStream(ctx, tx, stream); err != nil {
			return err
		}
		return s.stage(ctx, tx, "dr.stream.created", tenantID, map[string]any{
			"stream_id": stream.ID,
			"site_id":   stream.SiteID,
			"status":    stream.Status,
		})
	})
	return stream, err
}

// GetStream returns one replication stream.
func (s *Service) GetStream(ctx context.Context, tenantID, streamID uuid.UUID) (*model.ReplicationStream, error) {
	var stream *model.ReplicationStream
	err := s.read(ctx, tenantID, func(tx repository.DBTX) error {
		var err error
		stream, err = s.repo.GetStream(ctx, tx, tenantID.String(), streamID.String())
		return err
	})
	return stream, err
}

// ListStreams returns all streams for the tenant.
func (s *Service) ListStreams(ctx context.Context, tenantID uuid.UUID) ([]*model.ReplicationStream, error) {
	var streams []*model.ReplicationStream
	err := s.read(ctx, tenantID, func(tx repository.DBTX) error {
		var err error
		streams, err = s.repo.ListStreams(ctx, tx, tenantID.String())
		return err
	})
	if streams == nil {
		streams = []*model.ReplicationStream{}
	}
	return streams, err
}

// SetStreamStatus updates a stream lifecycle state.
func (s *Service) SetStreamStatus(ctx context.Context, tenantID, streamID uuid.UUID, status string) error {
	if status != model.StreamStatusPaused && status != model.StreamStatusPending {
		return invalid("status", "status must be paused or pending")
	}
	return s.write(ctx, tenantID, func(tx repository.DBTX) error {
		if err := s.repo.SetStreamStatus(ctx, tx, tenantID.String(), streamID.String(), status); err != nil {
			return err
		}
		return s.stage(ctx, tx, "dr.stream.status_changed", tenantID, map[string]any{
			"stream_id": streamID.String(),
			"status":    status,
		})
	})
}

// PauseStream halts replication for a stream (POST /streams/{id}/pause, §9).
func (s *Service) PauseStream(ctx context.Context, tenantID, streamID uuid.UUID) error {
	return s.write(ctx, tenantID, func(tx repository.DBTX) error {
		if err := s.repo.SetStreamStatus(ctx, tx, tenantID.String(), streamID.String(), model.StreamStatusPaused); err != nil {
			return err
		}
		return s.stage(ctx, tx, "dr.stream.paused", tenantID, map[string]any{
			"stream_id": streamID.String(),
			"status":    model.StreamStatusPaused,
		})
	})
}

// PauseTenantStreams halts every replication stream for a tenant. This is the
// cross-suite entitlement-control surface used by the DR consumer for
// license.suspended/license.expired (§8).
func (s *Service) PauseTenantStreams(ctx context.Context, tenantID uuid.UUID, reason string) (int64, error) {
	reason = strings.TrimSpace(reason)
	if reason == "" {
		reason = "paused by cross-suite control event"
	}
	var paused int64
	err := s.write(ctx, tenantID, func(tx repository.DBTX) error {
		var err error
		paused, err = s.repo.PauseTenantStreams(ctx, tx, tenantID.String(), reason)
		if err != nil {
			return err
		}
		if paused == 0 {
			return nil
		}
		return s.stage(ctx, tx, "dr.streams.paused", tenantID, map[string]any{
			"reason":       reason,
			"paused_count": paused,
		})
	})
	return paused, err
}

// ResumeStream restarts a paused stream (POST /streams/{id}/resume, §9). It
// returns to the pending state so the pipeline re-seeds/streams from its
// checkpoint; the agent transitions it onward to streaming.
func (s *Service) ResumeStream(ctx context.Context, tenantID, streamID uuid.UUID) error {
	return s.write(ctx, tenantID, func(tx repository.DBTX) error {
		if err := s.repo.SetStreamStatus(ctx, tx, tenantID.String(), streamID.String(), model.StreamStatusPending); err != nil {
			return err
		}
		return s.stage(ctx, tx, "dr.stream.resumed", tenantID, map[string]any{
			"stream_id": streamID.String(),
			"status":    model.StreamStatusPending,
		})
	})
}

// GetStreamRPO returns the live RPO + lag for a stream (GET /streams/{id}/rpo,
// §9): RPO = now - applied_at, computed from the RPO ledger on the stream row.
// HasData is false while the stream is still seeding (nothing applied yet).
func (s *Service) GetStreamRPO(ctx context.Context, tenantID, streamID uuid.UUID) (*model.StreamRPO, error) {
	var stream *model.ReplicationStream
	if err := s.read(ctx, tenantID, func(tx repository.DBTX) error {
		var err error
		stream, err = s.repo.GetStream(ctx, tx, tenantID.String(), streamID.String())
		return err
	}); err != nil {
		return nil, err
	}
	now := s.now()
	rpo, ok := stream.LiveRPO(now)
	secs := int(rpo.Seconds())
	return &model.StreamRPO{
		StreamID:   stream.ID,
		SiteID:     stream.SiteID,
		Status:     stream.Status,
		AppliedSeq: stream.AppliedSeq,
		SourceLSN:  stream.SourceLSN,
		RPOSeconds: secs,
		LagSeconds: secs,
		HasData:    ok,
		AppliedAt:  stream.AppliedAt,
		MeasuredAt: now,
	}, nil
}

// CreateRecoveryPointInput creates an immutable recovery point index.
type CreateRecoveryPointInput struct {
	MarkerLSN       string
	RPOSeconds      int
	ObjectKeys      map[string]string
	ContentHash     string
	ValidationRatio *float64
	IsValidated     bool
	RetentionUntil  time.Time
}

// CreateRecoveryPoint creates a recovery point under a group.
func (s *Service) CreateRecoveryPoint(ctx context.Context, tenantID, groupID uuid.UUID, in CreateRecoveryPointInput) (*model.RecoveryPoint, error) {
	if err := validateRecoveryPointInput(in, s.now()); err != nil {
		return nil, err
	}
	point := &model.RecoveryPoint{
		TenantID:        tenantID.String(),
		GroupID:         groupID.String(),
		MarkerLSN:       strings.TrimSpace(in.MarkerLSN),
		RPOSeconds:      in.RPOSeconds,
		ObjectKeys:      in.ObjectKeys,
		ContentHash:     strings.TrimSpace(in.ContentHash),
		ValidationRatio: in.ValidationRatio,
		IsValidated:     in.IsValidated,
		LegalHold:       in.IsValidated,
		RetentionUntil:  in.RetentionUntil.UTC(),
	}
	err := s.write(ctx, tenantID, func(tx repository.DBTX) error {
		if _, err := s.repo.GetGroup(ctx, tx, tenantID.String(), groupID.String()); err != nil {
			return err
		}
		if err := s.repo.CreateRecoveryPoint(ctx, tx, point); err != nil {
			return err
		}
		if point.IsValidated {
			if err := s.repo.ReconcileRecoveryPointLegalHolds(ctx, tx, tenantID.String(), groupID.String(), s.legalHoldCount); err != nil {
				return err
			}
		}
		return s.stage(ctx, tx, "dr.recovery_point.created", tenantID, map[string]any{
			"recovery_point_id": point.ID,
			"group_id":          point.GroupID,
			"rpo_seconds":       point.RPOSeconds,
			"is_validated":      point.IsValidated,
			"legal_hold":        point.LegalHold,
		})
	})
	return point, err
}

func validateRecoveryPointInput(in CreateRecoveryPointInput, now time.Time) error {
	if strings.TrimSpace(in.MarkerLSN) == "" {
		return invalid("marker_lsn", "marker_lsn is required")
	}
	if in.RPOSeconds < 0 {
		return invalid("rpo_seconds", "must not be negative")
	}
	if strings.TrimSpace(in.ContentHash) == "" {
		return invalid("content_hash", "content_hash is required")
	}
	if in.ValidationRatio != nil && (*in.ValidationRatio < 0 || *in.ValidationRatio > 1) {
		return invalid("validation_ratio", "must be between 0 and 1")
	}
	if in.RetentionUntil.IsZero() {
		return invalid("retention_until", "retention_until is required")
	}
	if !in.RetentionUntil.After(now) {
		return invalid("retention_until", "retention_until must be in the future")
	}
	return nil
}

// GetRecoveryPoint returns one recovery point.
func (s *Service) GetRecoveryPoint(ctx context.Context, tenantID, pointID uuid.UUID) (*model.RecoveryPoint, error) {
	var point *model.RecoveryPoint
	err := s.read(ctx, tenantID, func(tx repository.DBTX) error {
		var err error
		point, err = s.repo.GetRecoveryPoint(ctx, tx, tenantID.String(), pointID.String())
		return err
	})
	return point, err
}

// ListRecoveryPoints returns a group's recovery points.
func (s *Service) ListRecoveryPoints(ctx context.Context, tenantID, groupID uuid.UUID) ([]*model.RecoveryPoint, error) {
	var points []*model.RecoveryPoint
	err := s.read(ctx, tenantID, func(tx repository.DBTX) error {
		if _, err := s.repo.GetGroup(ctx, tx, tenantID.String(), groupID.String()); err != nil {
			return err
		}
		var err error
		points, err = s.repo.ListRecoveryPointsByGroup(ctx, tx, tenantID.String(), groupID.String())
		return err
	})
	if points == nil {
		points = []*model.RecoveryPoint{}
	}
	return points, err
}

// SetRecoveryPointValidation records validation metadata on a recovery point.
func (s *Service) SetRecoveryPointValidation(ctx context.Context, tenantID, pointID uuid.UUID, ratio float64, validated bool) error {
	if ratio < 0 || ratio > 1 {
		return invalid("validation_ratio", "must be between 0 and 1")
	}
	return s.write(ctx, tenantID, func(tx repository.DBTX) error {
		point, err := s.repo.GetRecoveryPoint(ctx, tx, tenantID.String(), pointID.String())
		if err != nil {
			return err
		}
		if err := s.repo.SetRecoveryPointValidation(ctx, tx, tenantID.String(), pointID.String(), ratio, validated); err != nil {
			return err
		}
		if err := s.repo.ReconcileRecoveryPointLegalHolds(ctx, tx, tenantID.String(), point.GroupID, s.legalHoldCount); err != nil {
			return err
		}
		return s.stage(ctx, tx, "dr.recovery_point.validation_recorded", tenantID, map[string]any{
			"recovery_point_id": pointID.String(),
			"group_id":          point.GroupID,
			"validation_ratio":  ratio,
			"is_validated":      validated,
		})
	})
}

// CreateNetworkMappingInput maps primary to recovery addressing.
type CreateNetworkMappingInput struct {
	Profile      string
	PrimaryCIDR  string
	RecoveryCIDR string
}

// CreateNetworkMapping creates a network mapping for a group.
func (s *Service) CreateNetworkMapping(ctx context.Context, tenantID, groupID uuid.UUID, in CreateNetworkMappingInput) (*model.NetworkMapping, error) {
	if in.Profile == "" {
		in.Profile = model.NetworkProfileProduction
	}
	if !validNetworkProfile(in.Profile) {
		return nil, invalid("profile", "profile must be production or isolated")
	}
	if _, _, err := net.ParseCIDR(strings.TrimSpace(in.PrimaryCIDR)); err != nil {
		return nil, invalid("primary_cidr", "must be a valid CIDR")
	}
	if _, _, err := net.ParseCIDR(strings.TrimSpace(in.RecoveryCIDR)); err != nil {
		return nil, invalid("recovery_cidr", "must be a valid CIDR")
	}
	mapping := &model.NetworkMapping{
		TenantID:     tenantID.String(),
		GroupID:      groupID.String(),
		Profile:      in.Profile,
		PrimaryCIDR:  strings.TrimSpace(in.PrimaryCIDR),
		RecoveryCIDR: strings.TrimSpace(in.RecoveryCIDR),
	}
	err := s.write(ctx, tenantID, func(tx repository.DBTX) error {
		if _, err := s.repo.GetGroup(ctx, tx, tenantID.String(), groupID.String()); err != nil {
			return err
		}
		if err := s.repo.CreateNetworkMapping(ctx, tx, mapping); err != nil {
			return err
		}
		return s.stage(ctx, tx, "dr.network_mapping.created", tenantID, map[string]any{
			"network_mapping_id": mapping.ID,
			"group_id":           mapping.GroupID,
			"profile":            mapping.Profile,
		})
	})
	return mapping, err
}

// ListNetworkMappings returns group network mappings.
func (s *Service) ListNetworkMappings(ctx context.Context, tenantID, groupID uuid.UUID) ([]*model.NetworkMapping, error) {
	var mappings []*model.NetworkMapping
	err := s.read(ctx, tenantID, func(tx repository.DBTX) error {
		if _, err := s.repo.GetGroup(ctx, tx, tenantID.String(), groupID.String()); err != nil {
			return err
		}
		var err error
		mappings, err = s.repo.ListNetworkMappings(ctx, tx, tenantID.String(), groupID.String())
		return err
	})
	if mappings == nil {
		mappings = []*model.NetworkMapping{}
	}
	return mappings, err
}

// CreateAgentInput creates a DR agent record.
type CreateAgentInput struct {
	SiteID *uuid.UUID
	Status string
}

// CreateAgent creates a provisioning DR agent.
func (s *Service) CreateAgent(ctx context.Context, tenantID uuid.UUID, in CreateAgentInput) (*model.DRAgent, error) {
	if in.Status != "" && in.Status != model.AgentStatusProvisioning {
		return nil, invalid("status", "new agents must start in provisioning")
	}
	var siteID *string
	if in.SiteID != nil {
		if *in.SiteID == uuid.Nil {
			return nil, invalid("site_id", "site id must not be nil")
		}
		id := in.SiteID.String()
		siteID = &id
	}
	agent := &model.DRAgent{TenantID: tenantID.String(), SiteID: siteID, Status: in.Status}
	err := s.write(ctx, tenantID, func(tx repository.DBTX) error {
		if in.SiteID != nil {
			if _, err := s.repo.GetSite(ctx, tx, tenantID.String(), in.SiteID.String()); err != nil {
				return err
			}
		}
		if err := s.repo.CreateAgent(ctx, tx, agent); err != nil {
			return err
		}
		return s.stage(ctx, tx, "dr.agent.created", tenantID, map[string]any{
			"agent_id": agent.ID,
			"site_id":  agent.SiteID,
			"status":   agent.Status,
		})
	})
	return agent, err
}

// GetAgent returns one DR agent.
func (s *Service) GetAgent(ctx context.Context, tenantID, agentID uuid.UUID) (*model.DRAgent, error) {
	var agent *model.DRAgent
	err := s.read(ctx, tenantID, func(tx repository.DBTX) error {
		var err error
		agent, err = s.repo.GetAgent(ctx, tx, tenantID.String(), agentID.String())
		return err
	})
	return agent, err
}

// ListAgents returns DR agents for the tenant.
func (s *Service) ListAgents(ctx context.Context, tenantID uuid.UUID) ([]*model.DRAgent, error) {
	var agents []*model.DRAgent
	err := s.read(ctx, tenantID, func(tx repository.DBTX) error {
		var err error
		agents, err = s.repo.ListAgents(ctx, tx, tenantID.String())
		return err
	})
	if agents == nil {
		agents = []*model.DRAgent{}
	}
	return agents, err
}

// CreateFailoverRunInput starts a real failover or drill run.
type CreateFailoverRunInput struct {
	GroupID             uuid.UUID
	Mode                string
	RecoveryPointID     *uuid.UUID
	JournalTarget       *JournalTargetInput
	RTOObjectiveSeconds int
	InitiatedBy         uuid.UUID
}

// CreateFailoverRun creates a failover/drill run at Gate 0.
func (s *Service) CreateFailoverRun(ctx context.Context, tenantID uuid.UUID, in CreateFailoverRunInput) (*model.FailoverRun, error) {
	if in.GroupID == uuid.Nil {
		return nil, invalid("group_id", "group id is required")
	}
	if !validMode(in.Mode) {
		return nil, invalid("mode", "mode must be real or drill")
	}
	if in.InitiatedBy == uuid.Nil {
		return nil, invalid("initiated_by", "initiated_by is required")
	}
	if in.RTOObjectiveSeconds < 0 {
		return nil, invalid("rto_objective_seconds", "must not be negative")
	}
	if in.RecoveryPointID != nil && in.JournalTarget != nil {
		return nil, invalid("recovery_point_id", "cannot be combined with journal_target")
	}
	if in.JournalTarget != nil {
		point, err := s.MaterializeJournalRecoveryPoint(ctx, tenantID, in.GroupID, MaterializeJournalRecoveryPointInput{
			Target: *in.JournalTarget,
		})
		if err != nil {
			return nil, fmt.Errorf("materialize journal recovery point: %w", err)
		}
		pointID, err := uuid.Parse(point.ID)
		if err != nil {
			return nil, fmt.Errorf("materialized recovery point id %q is not a UUID: %w", point.ID, err)
		}
		in.RecoveryPointID = &pointID
	}
	var recoveryPointID *string
	if in.RecoveryPointID != nil {
		if *in.RecoveryPointID == uuid.Nil {
			return nil, invalid("recovery_point_id", "recovery point id must not be nil")
		}
		id := in.RecoveryPointID.String()
		recoveryPointID = &id
	}

	run := &model.FailoverRun{
		TenantID:            tenantID.String(),
		GroupID:             in.GroupID.String(),
		Mode:                in.Mode,
		RecoveryPointID:     recoveryPointID,
		RTOObjectiveSeconds: in.RTOObjectiveSeconds,
		InitiatedBy:         in.InitiatedBy.String(),
	}
	err := s.write(ctx, tenantID, func(tx repository.DBTX) error {
		if _, err := s.repo.GetGroup(ctx, tx, tenantID.String(), in.GroupID.String()); err != nil {
			return err
		}
		members, err := s.repo.ListGroupMembers(ctx, tx, in.GroupID.String())
		if err != nil {
			return err
		}
		if len(members) == 0 {
			return invalid("group_id", "failover group must have at least one member")
		}
		if run.RTOObjectiveSeconds == 0 {
			rto, err := s.deriveGroupRTO(ctx, tx, tenantID, members)
			if err != nil {
				return err
			}
			run.RTOObjectiveSeconds = rto
		}
		if in.RecoveryPointID != nil {
			point, err := s.repo.GetRecoveryPoint(ctx, tx, tenantID.String(), in.RecoveryPointID.String())
			if err != nil {
				return err
			}
			if point.GroupID != in.GroupID.String() {
				return invalid("recovery_point_id", "recovery point does not belong to the group")
			}
		}
		if err := s.repo.CreateFailoverRun(ctx, tx, run); err != nil {
			return err
		}
		return s.stage(ctx, tx, "dr.failover_run.created", tenantID, map[string]any{
			"run_id":            run.ID,
			"group_id":          run.GroupID,
			"mode":              run.Mode,
			"status":            run.Status,
			"recovery_point_id": run.RecoveryPointID,
			"rto_objective_sec": run.RTOObjectiveSeconds,
		})
	})
	return run, err
}

func (s *Service) deriveGroupRTO(ctx context.Context, tx repository.DBTX, tenantID uuid.UUID, members []model.ConsistencyGroupMember) (int, error) {
	maxRTO := 0
	for _, member := range members {
		site, err := s.repo.GetSite(ctx, tx, tenantID.String(), member.SiteID)
		if err != nil {
			return 0, err
		}
		if site.RTOObjectiveSeconds > maxRTO {
			maxRTO = site.RTOObjectiveSeconds
		}
	}
	if maxRTO == 0 {
		maxRTO = 900
	}
	return maxRTO, nil
}

// GetFailoverRun returns one run.
func (s *Service) GetFailoverRun(ctx context.Context, tenantID, runID uuid.UUID) (*model.FailoverRun, error) {
	var run *model.FailoverRun
	err := s.read(ctx, tenantID, func(tx repository.DBTX) error {
		var err error
		run, err = s.repo.GetFailoverRun(ctx, tx, tenantID.String(), runID.String())
		return err
	})
	return run, err
}

// ListFailoverRuns returns failover/drill runs for the tenant.
func (s *Service) ListFailoverRuns(ctx context.Context, tenantID uuid.UUID) ([]*model.FailoverRun, error) {
	var runs []*model.FailoverRun
	err := s.read(ctx, tenantID, func(tx repository.DBTX) error {
		var err error
		runs, err = s.repo.ListFailoverRuns(ctx, tx, tenantID.String())
		return err
	})
	if runs == nil {
		runs = []*model.FailoverRun{}
	}
	return runs, err
}

// ApproveFailoverRunInput records a human approval submission at Gate 2.
type ApproveFailoverRunInput struct {
	Decision         string
	Reason           string
	BreakGlass       bool
	StepUpVerifiedAt *time.Time
}

// ApproveFailoverRun records a policy-backed Gate-2 human approval. The input is
// variadic so legacy callers still compile; an omitted input is treated as an
// approve decision and is accepted only where policy permits it.
func (s *Service) ApproveFailoverRun(ctx context.Context, tenantID, runID, approvedBy uuid.UUID, inputs ...ApproveFailoverRunInput) (*model.FailoverRun, error) {
	if approvedBy == uuid.Nil {
		return nil, invalid("approved_by", "approved_by is required")
	}
	in := ApproveFailoverRunInput{Decision: model.ApprovalDecisionApprove}
	if len(inputs) > 0 {
		in = inputs[0]
	}
	decision, err := normalizeApprovalDecision(in.Decision)
	if err != nil {
		return nil, err
	}
	in.Decision = decision
	in.Reason = strings.TrimSpace(in.Reason)

	var run *model.FailoverRun
	err = s.write(ctx, tenantID, func(tx repository.DBTX) error {
		current, err := s.repo.GetFailoverRun(ctx, tx, tenantID.String(), runID.String())
		if err != nil {
			return err
		}
		policy, err := s.failoverApprovalPolicy(ctx, tx, tenantID, current.Mode)
		if err != nil {
			return err
		}

		existing, existingErr := s.repo.GetFailoverApprovalByApprover(ctx, tx, tenantID.String(), runID.String(), approvedBy.String())
		if current.Status != model.StatusAwaitingApproval {
			if existingErr == nil {
				run = current
				return nil
			}
			return fmt.Errorf("failover run %s not awaiting approval: %w", runID, model.ErrInvalidState)
		}

		if existingErr != nil && !errors.Is(existingErr, model.ErrNotFound) {
			return existingErr
		}

		approval := existing
		inserted := false
		if approval == nil {
			if err := validateFailoverApproval(current, policy, approvedBy, in, s.now()); err != nil {
				return err
			}
			approval = &model.FailoverApproval{
				TenantID:         tenantID.String(),
				RunID:            runID.String(),
				ApproverID:       approvedBy.String(),
				Decision:         in.Decision,
				Reason:           in.Reason,
				BreakGlass:       in.BreakGlass,
				StepUpVerifiedAt: in.StepUpVerifiedAt,
			}
			inserted, err = s.repo.CreateFailoverApproval(ctx, tx, approval)
			if err != nil {
				return err
			}
			if inserted && approval.BreakGlass {
				if _, err := s.repo.CreateBreakGlassEvent(ctx, tx, &model.BreakGlassEvent{
					TenantID:   tenantID.String(),
					RunID:      runID.String(),
					ApprovalID: approval.ID,
					ActorID:    approvedBy.String(),
					ReasonHash: approvalReasonHash(tenantID, runID, approval.Reason),
				}); err != nil {
					return err
				}
			}
		}

		count, err := s.repo.CountFailoverApprovals(ctx, tx, tenantID.String(), runID.String(), model.ApprovalDecisionApprove)
		if err != nil {
			return err
		}
		quorum := effectiveApprovalQuorum(policy, approval.BreakGlass)
		quorumSatisfied := approval.Decision == model.ApprovalDecisionApprove && count >= quorum
		eventType := "dr.failover_run.approval_submitted"
		status := current.Status
		if quorumSatisfied {
			if err := s.repo.ApproveFailoverRun(ctx, tx, tenantID.String(), runID.String(), approvedBy.String()); err != nil {
				return err
			}
			eventType = "dr.failover_run.approved"
			status = model.StatusApproved
		}
		if inserted {
			if err := s.stage(ctx, tx, eventType, tenantID, map[string]any{
				"run_id":          runID.String(),
				"approval_id":     approval.ID,
				"approval_count":  count,
				"approval_quorum": quorum,
				"reason_present":  approval.Reason != "",
				"break_glass":     approval.BreakGlass,
				"decision":        approval.Decision,
				"status":          status,
			}); err != nil {
				return err
			}
		}
		run, err = s.repo.GetFailoverRun(ctx, tx, tenantID.String(), runID.String())
		return err
	})
	return run, err
}

func normalizeApprovalDecision(decision string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(decision)) {
	case "", model.ApprovalDecisionApprove, "approved":
		return model.ApprovalDecisionApprove, nil
	case model.ApprovalDecisionReject, "rejected":
		return model.ApprovalDecisionReject, nil
	default:
		return "", invalid("decision", "decision must be approve or reject")
	}
}

func (s *Service) failoverApprovalPolicy(ctx context.Context, tx repository.DBTX, tenantID uuid.UUID, mode string) (model.ApprovalPolicy, error) {
	policy := defaultFailoverApprovalPolicy(tenantID.String(), mode)
	stored, err := s.repo.GetFailoverApprovalPolicy(ctx, tx, tenantID.String(), mode)
	if err != nil {
		if errors.Is(err, model.ErrNotFound) {
			return policy, nil
		}
		return model.ApprovalPolicy{}, err
	}
	policy = *stored
	normalizeFailoverApprovalPolicy(&policy, mode)
	return policy, nil
}

func defaultFailoverApprovalPolicy(tenantID, mode string) model.ApprovalPolicy {
	policy := model.ApprovalPolicy{
		TenantID:            tenantID,
		Operation:           "failover",
		Mode:                mode,
		Quorum:              1,
		StepUpMaxAgeSeconds: 300,
		AllowBreakGlass:     true,
	}
	normalizeFailoverApprovalPolicy(&policy, mode)
	return policy
}

func normalizeFailoverApprovalPolicy(policy *model.ApprovalPolicy, mode string) {
	if policy.Quorum < 1 {
		policy.Quorum = 1
	}
	if policy.StepUpMaxAgeSeconds <= 0 {
		policy.StepUpMaxAgeSeconds = 300
	}
	if mode == model.ModeReal {
		if policy.Quorum < 2 {
			policy.Quorum = 2
		}
		policy.RequireReason = true
		policy.PreventInitiatorApproval = true
		policy.RequireStepUp = true
	}
}

func validateFailoverApproval(run *model.FailoverRun, policy model.ApprovalPolicy, approvedBy uuid.UUID, in ApproveFailoverRunInput, now time.Time) error {
	if in.BreakGlass && !policy.AllowBreakGlass {
		return invalid("break_glass", "break-glass approval is not allowed by policy")
	}
	if policy.RequireReason && in.Reason == "" {
		return invalid("reason", "reason is required")
	}
	if in.BreakGlass && policy.BreakGlassRequiresReason && in.Reason == "" {
		return invalid("reason", "reason is required for break-glass approval")
	}
	if policy.PreventInitiatorApproval && run.InitiatedBy == approvedBy.String() {
		return invalid("approved_by", "initiator cannot approve this failover run")
	}
	requireStepUp := policy.RequireStepUp || (in.BreakGlass && policy.BreakGlassRequiresStepUp)
	if requireStepUp && !freshStepUp(in.StepUpVerifiedAt, now, time.Duration(policy.StepUpMaxAgeSeconds)*time.Second) {
		return invalid("step_up_verified_at", "fresh step-up verification is required")
	}
	return nil
}

func approvalReasonHash(tenantID, runID uuid.UUID, reason string) string {
	sum := sha256.Sum256([]byte(tenantID.String() + ":" + runID.String() + ":" + strings.TrimSpace(reason)))
	return hex.EncodeToString(sum[:])
}

func effectiveApprovalQuorum(policy model.ApprovalPolicy, breakGlass bool) int {
	quorum := policy.Quorum
	if breakGlass && policy.BreakGlassMinApprovers > quorum {
		quorum = policy.BreakGlassMinApprovers
	}
	return quorum
}

func freshStepUp(verifiedAt *time.Time, now time.Time, maxAge time.Duration) bool {
	if verifiedAt == nil {
		return false
	}
	if verifiedAt.After(now.Add(time.Minute)) {
		return false
	}
	return now.Sub(*verifiedAt) <= maxAge
}

// CancelFailoverRun cancels a run before execution starts.
func (s *Service) CancelFailoverRun(ctx context.Context, tenantID, runID, cancelledBy uuid.UUID) (*model.FailoverRun, error) {
	if cancelledBy == uuid.Nil {
		return nil, invalid("cancelled_by", "cancelled_by is required")
	}
	var run *model.FailoverRun
	err := s.write(ctx, tenantID, func(tx repository.DBTX) error {
		current, err := s.repo.GetFailoverRun(ctx, tx, tenantID.String(), runID.String())
		if err != nil {
			return err
		}
		if !cancelableRunStatus(current.Status) {
			return fmt.Errorf("failover run %s in status %s cannot be cancelled: %w", runID, current.Status, model.ErrInvalidState)
		}
		if err := s.repo.CompleteFailoverRunFromStatus(ctx, tx, tenantID.String(), runID.String(), model.StatusCancelled, current.Status, nil); err != nil {
			return err
		}
		if err := s.stage(ctx, tx, "dr.failover_run.cancelled", tenantID, map[string]any{
			"run_id":          runID.String(),
			"previous_status": current.Status,
			"status":          model.StatusCancelled,
			"cancelled_by":    cancelledBy.String(),
		}); err != nil {
			return err
		}
		run, err = s.repo.GetFailoverRun(ctx, tx, tenantID.String(), runID.String())
		return err
	})
	return run, err
}

// TransitionFailoverRunInput advances a run using a guarded status transition.
type TransitionFailoverRunInput struct {
	ExpectedStatus string
	NewStatus      string
	LastError      *string
}

// TransitionFailoverRun performs one allowed FSM transition.
func (s *Service) TransitionFailoverRun(ctx context.Context, tenantID, runID uuid.UUID, in TransitionFailoverRunInput) (*model.FailoverRun, error) {
	if !validRunStatus(in.ExpectedStatus) {
		return nil, invalid("expected_status", "invalid failover status")
	}
	if !validRunStatus(in.NewStatus) {
		return nil, invalid("new_status", "invalid failover status")
	}
	if !allowedTransition(in.ExpectedStatus, in.NewStatus) {
		return nil, fmt.Errorf("%s -> %s is not allowed: %w", in.ExpectedStatus, in.NewStatus, model.ErrInvalidState)
	}

	var run *model.FailoverRun
	err := s.write(ctx, tenantID, func(tx repository.DBTX) error {
		current, err := s.repo.GetFailoverRun(ctx, tx, tenantID.String(), runID.String())
		if err != nil {
			return err
		}
		if current.Status != in.ExpectedStatus {
			return fmt.Errorf("failover run %s is %s, not %s: %w", runID, current.Status, in.ExpectedStatus, model.ErrInvalidState)
		}
		if isTerminalStatus(in.NewStatus) {
			if err := s.repo.CompleteFailoverRunFromStatus(ctx, tx, tenantID.String(), runID.String(), in.NewStatus, in.ExpectedStatus, in.LastError); err != nil {
				return err
			}
		} else if err := s.repo.UpdateFailoverRunStatus(ctx, tx, tenantID.String(), runID.String(), in.NewStatus, in.ExpectedStatus, in.LastError); err != nil {
			return err
		}
		if err := s.stage(ctx, tx, "dr.failover_run.status_changed", tenantID, map[string]any{
			"run_id":          runID.String(),
			"previous_status": in.ExpectedStatus,
			"status":          in.NewStatus,
		}); err != nil {
			return err
		}
		run, err = s.repo.GetFailoverRun(ctx, tx, tenantID.String(), runID.String())
		return err
	})
	return run, err
}

// ListFailoverSteps returns a run timeline after tenant ownership is verified.
func (s *Service) ListFailoverSteps(ctx context.Context, tenantID, runID uuid.UUID) ([]*model.FailoverStep, error) {
	var steps []*model.FailoverStep
	err := s.read(ctx, tenantID, func(tx repository.DBTX) error {
		if _, err := s.repo.GetFailoverRun(ctx, tx, tenantID.String(), runID.String()); err != nil {
			return err
		}
		var err error
		steps, err = s.repo.ListFailoverSteps(ctx, tx, runID.String())
		return err
	})
	if steps == nil {
		steps = []*model.FailoverStep{}
	}
	return steps, err
}

// GetAttestationByRun returns a run's attestation after tenant ownership is verified.
func (s *Service) GetAttestationByRun(ctx context.Context, tenantID, runID uuid.UUID) (*model.Attestation, error) {
	var attestation *model.Attestation
	err := s.read(ctx, tenantID, func(tx repository.DBTX) error {
		if _, err := s.repo.GetFailoverRun(ctx, tx, tenantID.String(), runID.String()); err != nil {
			return err
		}
		var err error
		attestation, err = s.repo.GetAttestationByRun(ctx, tx, tenantID.String(), runID.String())
		return err
	})
	return attestation, err
}

func validSiteKind(kind string) bool {
	switch kind {
	case model.SiteKindVM, model.SiteKindDatabase, model.SiteKindFileset:
		return true
	default:
		return false
	}
}

func validStreamStatus(status string) bool {
	switch status {
	case model.StreamStatusPending, model.StreamStatusSeeding, model.StreamStatusStreaming,
		model.StreamStatusPaused, model.StreamStatusDegraded, model.StreamStatusError:
		return true
	default:
		return false
	}
}

func validNetworkProfile(profile string) bool {
	switch profile {
	case model.NetworkProfileProduction, model.NetworkProfileIsolated:
		return true
	default:
		return false
	}
}

func validMode(mode string) bool {
	switch mode {
	case model.ModeReal, model.ModeDrill:
		return true
	default:
		return false
	}
}

func validAgentStatus(status string) bool {
	switch status {
	case model.AgentStatusProvisioning, model.AgentStatusActive, model.AgentStatusSilent,
		model.AgentStatusRotating, model.AgentStatusRevoked:
		return true
	default:
		return false
	}
}

func validRunStatus(status string) bool {
	switch status {
	case model.StatusInitiated, model.StatusQuiescing, model.StatusSyncConfirmed,
		model.StatusAwaitingApproval, model.StatusApproved, model.StatusExecuting,
		model.StatusValidating, model.StatusAttested, model.StatusCompleted,
		model.StatusFailed, model.StatusCancelled, model.StatusRolledBack:
		return true
	default:
		return false
	}
}

func isTerminalStatus(status string) bool {
	switch status {
	case model.StatusCompleted, model.StatusFailed, model.StatusCancelled, model.StatusRolledBack:
		return true
	default:
		return false
	}
}

func cancelableRunStatus(status string) bool {
	switch status {
	case model.StatusInitiated, model.StatusQuiescing, model.StatusSyncConfirmed,
		model.StatusAwaitingApproval, model.StatusApproved:
		return true
	default:
		return false
	}
}

func allowedTransition(from, to string) bool {
	allowed := map[string][]string{
		model.StatusInitiated:        {model.StatusQuiescing, model.StatusFailed, model.StatusCancelled},
		model.StatusQuiescing:        {model.StatusSyncConfirmed, model.StatusFailed, model.StatusCancelled},
		model.StatusSyncConfirmed:    {model.StatusAwaitingApproval, model.StatusFailed, model.StatusCancelled},
		model.StatusAwaitingApproval: {model.StatusApproved, model.StatusFailed, model.StatusCancelled},
		model.StatusApproved:         {model.StatusExecuting, model.StatusFailed, model.StatusCancelled},
		model.StatusExecuting:        {model.StatusValidating, model.StatusFailed, model.StatusRolledBack},
		model.StatusValidating:       {model.StatusAttested, model.StatusFailed, model.StatusRolledBack},
		model.StatusAttested:         {model.StatusCompleted, model.StatusFailed},
	}
	for _, candidate := range allowed[from] {
		if candidate == to {
			return true
		}
	}
	return false
}
