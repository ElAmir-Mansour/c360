package service

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/dto"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
	"github.com/clario360/platform/internal/lex/service/integration"
)

// IntegrationAdapter is the port interface every external-integration connector
// satisfies (CAP-174..178). Real connectors implement this seam. The bundled
// fallback adapters below report missing connector registration explicitly, so
// the suite never marks an integration reachable without a real adapter.
// Probe is also the readiness signal used by the suite health confirmation
// (CAP-184..186).
type IntegrationAdapter interface {
	// Kind returns the integration kind this adapter serves.
	Kind() model.IntegrationKind
	// Probe reports a health snapshot for the given endpoint. Stubs derive the
	// verdict from the endpoint's configured status; a real adapter performs a
	// lightweight connectivity check.
	Probe(ctx context.Context, endpoint model.IntegrationEndpoint, now time.Time) model.IntegrationHealth
}

// IntegrationRegistryService administers lex_integration_endpoints (CAP-174..178)
// and dispatches health probes to the registered adapters. Config is encrypted
// at rest by the repository (CAP-179). Every mutation emits a lex audit record.
type IntegrationRegistryService struct {
	db        *pgxpool.Pool
	repo      *repository.IntegrationEndpointRepository
	publisher Publisher
	audit     *LexAuditEmitter
	topic     string
	logger    zerolog.Logger
	now       func() time.Time
	adapters  map[model.IntegrationKind]IntegrationAdapter
	ledger    *integration.SyncLedger
	// healthRecorder (feature 6) persists one health-check row per probe, detects
	// healthy->outage degrade transitions (firing one best-effort alert), and backs
	// GET /integrations/{id}/health-history. Nil disables history + alerting; the
	// probe path never fails on a recorder error.
	healthRecorder *integration.HealthRecorder
	// dlq (reliability feature #11) durably captures a FAILED Sync/Invoke/
	// TestConnection dispatch (and verified-but-failed inbound webhooks) so an
	// operator can replay it. Nil disables DLQ capture (operations still run; nothing
	// is recorded). Wired via WithDLQ. The registry satisfies the DLQ's ReplayRunner
	// seam (ReplayOperation) so a replay re-runs the original op.
	dlq *integration.DLQService
	// breaker (reliability feature #12) holds one circuit-breaker per endpoint and
	// auto-quarantines a persistently unhealthy one. Nil disables breaker gating
	// (operations always dispatch). Wired via WithBreaker. The registry satisfies the
	// breaker's Quarantiner seam (Quarantine/Unquarantine) so a quarantine flips the
	// endpoint status to stop it being called.
	breaker *integration.BreakerController
	// changeGate (governance #13, maker-checker) routes an Update against a PROTECTED
	// endpoint (active production OR gov-gated kind) into a parked pending change
	// instead of applying it; an approval re-applies through ApplyProposedConfig. Nil
	// disables the gate (every Update applies immediately). Wired via WithChangeGate.
	// The registry satisfies the gate's EndpointUpdater seam (ApplyProposedConfig).
	changeGate *integration.ChangeGateService
	// egress (governance #15, data residency / field egress) denies + audits an
	// outbound Sync/Invoke that would egress a disallowed region/field. Nil disables
	// enforcement (operations always dispatch). Wired via WithEgress.
	egress *integration.EgressEnforcer
	// secretRef (governance #14, KMS/Vault secret references) resolves a stored secret
	// config value of form kms://<keyId> or vault://<path>#<field> to the actual secret
	// AT CALL TIME, just before a connector reads plaintext config — the stored value
	// stays the REFERENCE. Nil (or no providers wired) is a pass-through: a plain secret
	// value works unchanged. Wired via WithSecretRef.
	secretRef *integration.SecretRefResolver
	// callMetrics (observability #16) records one per-dispatch call-metric row after
	// every TestConnection/SyncNow/Invoke ({op, latency_ms, ok}) and aggregates them
	// into ConnectorMetrics / the tenant overview (percentile_cont p50/p95, error_rate,
	// sync_throughput, SLO breach). Nil disables metrics (operations still run; nothing
	// is recorded). Wired via WithCallMetrics; the registry supplies its endpoint +
	// sync-throughput lookups.
	callMetrics *integration.CallMetricsRecorder
	// eventLog (observability #17) records one REDACTED inbound-event row per verified
	// webhook event (and synthetic/test loop) and backs the event inspector + replay.
	// Nil disables event logging (the webhook ack never depends on it). Wired via
	// WithEventLog; the registry satisfies the EventDispatcher replay seam.
	eventLog *integration.EventLog
	// conflicts (extensibility #20) persists + manages the conflict-resolution queue:
	// Reconcile writes open conflicts through it, and the extensibility handler lists +
	// resolves them. Nil disables the queue (Reconcile then only returns the report).
	// Wired via WithConflicts.
	conflicts *integration.ConflictService
	// massGuard (extensibility #20) blocks a sync that would deactivate more than the
	// configured percent of an endpoint's mapped org entities, unless force is set. Nil
	// disables the guard (every sync proceeds). Wired via WithConflicts alongside the
	// conflict queue.
	massGuard *integration.MassChangeGuard
}

func NewIntegrationRegistryService(db *pgxpool.Pool, repo *repository.IntegrationEndpointRepository, publisher Publisher, audit *LexAuditEmitter, topic string, logger zerolog.Logger) *IntegrationRegistryService {
	s := &IntegrationRegistryService{
		db:        db,
		repo:      repo,
		publisher: publisherOrNoop(publisher),
		audit:     audit,
		topic:     topic,
		logger:    logger.With().Str("service", "lex-integration-registry").Logger(),
		now:       time.Now,
		adapters:  map[model.IntegrationKind]IntegrationAdapter{},
	}
	// Register bundled fallback adapters for every known kind.
	for _, a := range defaultIntegrationAdapters() {
		s.adapters[a.Kind()] = a
	}
	return s
}

// RegisterAdapter slots a real adapter in, overriding the bundled fallback for
// its kind. Returns the receiver for chaining.
func (s *IntegrationRegistryService) RegisterAdapter(adapter IntegrationAdapter) *IntegrationRegistryService {
	if adapter != nil {
		s.adapters[adapter.Kind()] = adapter
	}
	return s
}

// WithSyncLedger wires the sync-run ledger writer so SyncNow can persist a row
// per dispatch and ListSyncRuns can read the timeline. Passing nil disables
// ledger writes (SyncNow still runs but does not persist a row). Returns the
// receiver for chaining at wiring time.
func (s *IntegrationRegistryService) WithSyncLedger(ledger *integration.SyncLedger) *IntegrationRegistryService {
	s.ledger = ledger
	return s
}

// WithHealthRecorder wires the feature-6 health-check recorder so Health/HealthAll
// persist a health-history row per probe (and emit a degrade alert on a
// healthy->outage edge) and ListHealthHistory can read the timeline. Passing nil
// disables history + alerting (probes still run). Returns the receiver for chaining
// at wiring time, mirroring WithSyncLedger.
func (s *IntegrationRegistryService) WithHealthRecorder(recorder *integration.HealthRecorder) *IntegrationRegistryService {
	s.healthRecorder = recorder
	return s
}

// WithDLQ wires the dead-letter queue (reliability feature #11). The registry then
// records a redacted dead-letter row whenever a Sync/Invoke/TestConnection dispatch
// fails, and the resilience handlers list/replay through it. It also registers the
// registry as the DLQ's ReplayRunner (ReplayOperation) so a replay re-runs the
// original op. Passing nil disables DLQ capture (operations still run). Returns the
// receiver for chaining at wiring time, mirroring WithSyncLedger.
func (s *IntegrationRegistryService) WithDLQ(dlq *integration.DLQService) *IntegrationRegistryService {
	s.dlq = dlq
	if dlq != nil {
		dlq.WithRunner(s)
	}
	return s
}

// WithBreaker wires the per-endpoint circuit-breaker controller (reliability
// feature #12). The registry then gates each Sync/Invoke/TestConnection dispatch
// through Allow (skip when open/quarantined) and reports the outcome via OnResult
// (trip/recover + auto-quarantine). It registers the registry as the breaker's
// Quarantiner (Quarantine/Unquarantine) so an auto-quarantine flips the endpoint
// status to stop it being called. Passing nil disables breaker gating. Returns the
// receiver for chaining at wiring time.
func (s *IntegrationRegistryService) WithBreaker(breaker *integration.BreakerController) *IntegrationRegistryService {
	s.breaker = breaker
	if breaker != nil {
		breaker.WithQuarantiner(s)
	}
	return s
}

// WithChangeGate wires the maker-checker change gate (governance #13). The registry
// then routes an Update against a PROTECTED endpoint into a parked pending change
// (rather than applying it), and an approval re-applies through ApplyProposedConfig.
// It self-registers the registry as the gate's EndpointUpdater (ApplyProposedConfig).
// Passing nil disables the gate (every Update applies immediately). Returns the
// receiver for chaining at wiring time, mirroring WithDLQ/WithBreaker.
func (s *IntegrationRegistryService) WithChangeGate(gate *integration.ChangeGateService) *IntegrationRegistryService {
	s.changeGate = gate
	if gate != nil {
		gate.WithUpdater(s)
	}
	return s
}

// WithEgress wires the data-residency / field-egress enforcer (governance #15). The
// registry then denies + audits an outbound Sync/Invoke that would egress a
// disallowed region/field. Passing nil disables enforcement (operations always
// dispatch). Returns the receiver for chaining at wiring time.
func (s *IntegrationRegistryService) WithEgress(enforcer *integration.EgressEnforcer) *IntegrationRegistryService {
	s.egress = enforcer
	return s
}

// WithSecretRef wires the external secret-reference resolver (governance #14). The
// registry then resolves a stored secret config value of form kms://<keyId> or
// vault://<path>#<field> to the actual secret AT CALL TIME, just before a connector
// reads plaintext config — the stored value stays the reference. Passing nil (or a
// resolver with no providers) is a pass-through (a plain secret value works unchanged).
// Returns the receiver for chaining at wiring time.
func (s *IntegrationRegistryService) WithSecretRef(resolver *integration.SecretRefResolver) *IntegrationRegistryService {
	s.secretRef = resolver
	return s
}

// WithCallMetrics wires the per-connector call-metrics recorder (observability #16).
// The registry then records one metric row after each TestConnection/SyncNow/Invoke
// dispatch and backs GET /integrations/{id}/metrics + /integrations/metrics. It
// self-wires the recorder's endpoint-identity + sync-throughput lookups (over the
// FieldCrypto repo + the sync ledger) so the recorder needs no service-layer
// dependency. Passing nil disables metrics (operations still run; nothing recorded).
// Returns the receiver for chaining at wiring time, mirroring WithDLQ/WithBreaker.
func (s *IntegrationRegistryService) WithCallMetrics(recorder *integration.CallMetricsRecorder) *IntegrationRegistryService {
	s.callMetrics = recorder
	if recorder != nil {
		recorder.WithLookups(s.metricEndpointLookup(), s.syncThroughputLookup())
	}
	return s
}

// WithEventLog wires the inbound-event log (observability #17). The registry then
// records a REDACTED event row on each verified inbound event (via the webhook
// handler / SendTestEvent) and backs the event inspector + replay. It self-registers
// the registry as the log's EventDispatcher (DispatchInboundEvent) so a replay re-
// dispatches the original inbound event through the connector. Passing nil disables
// event logging. Returns the receiver for chaining at wiring time.
func (s *IntegrationRegistryService) WithEventLog(log *integration.EventLog) *IntegrationRegistryService {
	s.eventLog = log
	if log != nil {
		log.WithDispatcher(s)
	}
	return s
}

// WithConflicts wires the conflict-resolution queue + mass-change guard
// (extensibility #20). The registry then (a) persists open conflicts from each
// Reconcile pass through the ConflictService, (b) backs the conflict list/resolve
// surfaces, and (c) runs the MassChangeGuard before COMMITTING a real (non-preview,
// non-forced) sync, returning a 409 with a guard summary when the sync would
// deactivate too large a fraction of mapped entities. Passing a nil service/guard
// disables the respective behaviour (Reconcile then only returns the report; syncs
// are never guarded). Returns the receiver for chaining at wiring time.
func (s *IntegrationRegistryService) WithConflicts(conflicts *integration.ConflictService, guard *integration.MassChangeGuard) *IntegrationRegistryService {
	s.conflicts = conflicts
	s.massGuard = guard
	return s
}

// ListConflicts (extensibility #20) returns an endpoint's conflict queue (tenant-
// scoped), optionally filtered by status (open|resolved). It loads the endpoint
// first for 404/RLS semantics (mirroring ListSyncRuns). An unwired queue yields an
// empty slice.
func (s *IntegrationRegistryService) ListConflicts(ctx context.Context, tenantID, id uuid.UUID, status string, limit int) ([]integration.Conflict, error) {
	if _, err := s.repo.Get(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("integration endpoint not found")
		}
		return nil, internalError("load integration endpoint", err)
	}
	if s.conflicts == nil {
		return []integration.Conflict{}, nil
	}
	return s.conflicts.List(ctx, tenantID, id, status, limit)
}

// ResolveConflict (extensibility #20) applies an operator's resolution choice
// (merge|override|ignore) to one conflict and closes it. It maps the conflict
// service's typed errors onto the suite's validation/not-found/conflict errors. An
// unwired queue yields a clear validation error.
func (s *IntegrationRegistryService) ResolveConflict(ctx context.Context, tenantID, userID, conflictID uuid.UUID, resolution string) (*integration.Conflict, error) {
	if s.conflicts == nil {
		return nil, validationError("conflict queue is not enabled", map[string]string{"capability": "conflicts_unsupported"})
	}
	resolved, err := s.conflicts.Resolve(ctx, tenantID, userID, conflictID, resolution)
	if err != nil {
		switch {
		case errors.Is(err, integration.ErrConflictNotOpen):
			return nil, notFoundError("conflict not found or already resolved")
		case errors.Is(err, integration.ErrInvalidResolution):
			return nil, validationError("invalid resolution (merge|override|ignore)", map[string]string{"resolution": "invalid"})
		default:
			return nil, internalError("resolve integration conflict", err)
		}
	}
	s.emit(ctx, tenantID, userID, "com.clario360.lex.integration.conflict_resolved", "integration.conflict_resolved", map[string]any{"id": conflictID, "resolution": resolution})
	return resolved, nil
}

// metricEndpointLookup builds the call-metrics recorder's endpoint-identity +
// slo_target_pct resolver over the endpoint repo. A missing endpoint reports ok=false
// so the overview drops its orphaned metric rows.
func (s *IntegrationRegistryService) metricEndpointLookup() integration.EndpointMetricLookup {
	return func(ctx context.Context, tenantID, endpointID uuid.UUID) (string, model.IntegrationKind, map[string]any, bool) {
		ep, err := s.repo.Get(ctx, tenantID, endpointID)
		if err != nil || ep == nil {
			return "", "", nil, false
		}
		return ep.Name, ep.Kind, ep.Config, true
	}
}

// syncThroughputLookup builds the call-metrics recorder's sync_throughput resolver
// over the sync ledger (count of sync-run rows in the window). An unwired ledger
// reports 0.
func (s *IntegrationRegistryService) syncThroughputLookup() integration.SyncThroughputLookup {
	return func(ctx context.Context, tenantID, endpointID uuid.UUID, since time.Time) (int64, error) {
		if s.ledger == nil {
			return 0, nil
		}
		return s.ledger.CountByEndpointSince(ctx, tenantID, endpointID, since)
	}
}

// recordCallMetric appends one observability #16 call-metric row for a dispatch.
// Best-effort and nil-safe — never affects the underlying operation.
func (s *IntegrationRegistryService) recordCallMetric(ctx context.Context, endpoint model.IntegrationEndpoint, op string, started time.Time, ok bool) {
	if s.callMetrics == nil {
		return
	}
	latency := s.now().Sub(started).Milliseconds()
	s.callMetrics.Record(ctx, endpoint, op, latency, ok)
}

// resolveDispatchEndpoint returns a copy of the endpoint whose DECRYPTED config has
// any external secret references (kms://, vault://) resolved to the actual secrets,
// ready to hand to a connector. When no resolver/providers are wired, or the config
// carries no references, it returns the endpoint unchanged. A resolution failure is
// returned as a secret-free error so the dispatch fails closed rather than handing the
// connector a raw reference as if it were the credential.
func (s *IntegrationRegistryService) resolveDispatchEndpoint(ctx context.Context, endpoint *model.IntegrationEndpoint) (model.IntegrationEndpoint, error) {
	if s.secretRef == nil || !s.secretRef.HasProviders() {
		return *endpoint, nil
	}
	resolved, err := s.secretRef.ResolvedEndpoint(ctx, *endpoint)
	if err != nil {
		return *endpoint, internalError("resolve integration secret reference", err)
	}
	return resolved, nil
}

// schemaFor resolves the config schema for a kind, returning an empty schema
// (which masks nothing / validates only enums it knows) when none is registered.
func (s *IntegrationRegistryService) schemaFor(kind model.IntegrationKind) integration.ConfigSchema {
	if schema, ok := integration.SchemaFor(kind); ok {
		return schema
	}
	return integration.ConfigSchema{}
}

func (s *IntegrationRegistryService) Create(ctx context.Context, tenantID, userID uuid.UUID, req dto.CreateIntegrationEndpointRequest) (*model.IntegrationEndpoint, error) {
	req.Normalize()
	if err := validateIntegrationKind(req.Kind); err != nil {
		return nil, err
	}
	if req.Code == "" {
		return nil, validationError("code is required", map[string]string{"code": "required"})
	}
	if strings.TrimSpace(req.Name) == "" {
		return nil, validationError("name is required", map[string]string{"name": "required"})
	}
	if err := validateIntegrationStatus(req.Status); err != nil {
		return nil, err
	}
	schema := s.schemaFor(req.Kind)
	if errs := schema.Validate(req.Config, req.Status == model.IntegrationStatusActive); errs != nil {
		return nil, validationError("integration config failed validation", errs)
	}
	endpoint := &model.IntegrationEndpoint{
		ID:          uuid.New(),
		TenantID:    tenantID,
		Kind:        req.Kind,
		Code:        req.Code,
		Name:        req.Name,
		Description: req.Description,
		Status:      req.Status,
		Config:      req.Config,
		Metadata:    req.Metadata,
		CreatedBy:   userID,
	}
	if err := s.repo.Create(ctx, s.db, endpoint); err != nil {
		if isUniqueViolation(err) {
			return nil, conflictError("an integration endpoint with this code already exists")
		}
		return nil, internalError("create integration endpoint", err)
	}
	s.emit(ctx, tenantID, userID, "com.clario360.lex.integration.registered", "integration.registered", endpoint)
	return s.mask(endpoint), nil
}

func (s *IntegrationRegistryService) Update(ctx context.Context, tenantID, userID, id uuid.UUID, req dto.UpdateIntegrationEndpointRequest) (*model.IntegrationEndpoint, error) {
	req.Normalize()
	endpoint, err := s.repo.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("integration endpoint not found")
		}
		return nil, internalError("load integration endpoint", err)
	}
	// Governance #13 (maker-checker): a direct PUT that changes the CONFIG of a
	// PROTECTED endpoint (active production OR a gov-gated kind) must go through the
	// maker-checker route (POST /integrations/{id}/changes) so a second operator can
	// review it — it is NOT applied here. We refuse with a conflict that names the
	// correct route. A name/description/status/metadata-only update (no req.Config) is
	// operational, not a config change, so it still applies directly. When the gate is
	// unwired the endpoint is never protected and this is a no-op.
	if req.Config != nil && s.changeGate != nil && s.changeGate.IsProtected(*endpoint) {
		return nil, conflictError("this endpoint is protected (active production or gov-gated): submit configuration changes through the maker-checker route (POST /integrations/{id}/changes) for review")
	}
	return s.applyUpdate(ctx, tenantID, userID, endpoint, &req)
}

// applyUpdate performs the actual merge/validate/persist/audit of an endpoint update.
// It is the single apply path shared by a direct (non-protected / gate-disabled)
// Update and by ApplyProposedConfig (a maker-checker approval). req fields are
// optional; a nil req.Config leaves the stored config untouched.
func (s *IntegrationRegistryService) applyUpdate(ctx context.Context, tenantID, userID uuid.UUID, endpoint *model.IntegrationEndpoint, req *dto.UpdateIntegrationEndpointRequest) (*model.IntegrationEndpoint, error) {
	if req.Name != nil {
		endpoint.Name = *req.Name
	}
	if req.Description != nil {
		endpoint.Description = *req.Description
	}
	if req.Status != nil {
		if err := validateIntegrationStatus(*req.Status); err != nil {
			return nil, err
		}
		endpoint.Status = *req.Status
	}
	schema := s.schemaFor(endpoint.Kind)
	if req.Config != nil {
		// Merge-on-update: a secret field whose incoming value is the redaction
		// sentinel (or blank) keeps the stored plaintext; any other value is the
		// new secret (the repo re-encrypts on write). Non-secret fields take the
		// incoming value. endpoint.Config is the DECRYPTED stored config (the repo
		// decrypts on Get), so this merge operates on plaintext throughout.
		endpoint.Config = schema.MergeSecrets(endpoint.Config, req.Config)
	}
	if req.Metadata != nil {
		endpoint.Metadata = req.Metadata
	}
	if errs := schema.Validate(endpoint.Config, endpoint.Status == model.IntegrationStatusActive); errs != nil {
		return nil, validationError("integration config failed validation", errs)
	}
	if err := s.repo.Update(ctx, s.db, endpoint); err != nil {
		return nil, internalError("update integration endpoint", err)
	}
	s.emit(ctx, tenantID, userID, "com.clario360.lex.integration.configured", "integration.configured", endpoint)
	return s.mask(endpoint), nil
}

func (s *IntegrationRegistryService) Get(ctx context.Context, tenantID, id uuid.UUID) (*model.IntegrationEndpoint, error) {
	endpoint, err := s.repo.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("integration endpoint not found")
		}
		return nil, internalError("get integration endpoint", err)
	}
	return s.mask(endpoint), nil
}

func (s *IntegrationRegistryService) List(ctx context.Context, tenantID uuid.UUID, kind, status string) ([]model.IntegrationEndpoint, error) {
	endpoints, err := s.repo.List(ctx, tenantID, strings.ToLower(strings.TrimSpace(kind)), strings.TrimSpace(status))
	if err != nil {
		return nil, internalError("list integration endpoints", err)
	}
	for i := range endpoints {
		endpoints[i] = *s.mask(&endpoints[i])
	}
	return endpoints, nil
}

func (s *IntegrationRegistryService) Delete(ctx context.Context, tenantID, userID, id uuid.UUID) error {
	if err := s.repo.SoftDelete(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("integration endpoint not found")
		}
		return internalError("delete integration endpoint", err)
	}
	s.emit(ctx, tenantID, userID, "com.clario360.lex.integration.deleted", "integration.deleted", map[string]any{"id": id})
	return nil
}

// Health probes one endpoint via its registered adapter and persists the result.
func (s *IntegrationRegistryService) Health(ctx context.Context, tenantID, id uuid.UUID) (*model.IntegrationHealth, error) {
	endpoint, err := s.repo.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("integration endpoint not found")
		}
		return nil, internalError("load integration endpoint", err)
	}
	health := s.probe(ctx, *endpoint)
	var lastError *string
	if !health.Reachable && health.Detail != "" {
		detail := health.Detail
		lastError = &detail
	}
	if err := s.repo.MarkChecked(ctx, tenantID, id, endpoint.Status, s.now().UTC(), lastError); err != nil {
		s.logger.Error().Err(err).Str("endpoint_id", id.String()).Msg("persist integration health")
	}
	// Feature 6: append a health-history row and fire a degrade alert on a
	// healthy->outage edge. Best-effort: a recorder error never fails the probe.
	if s.healthRecorder != nil {
		if _, err := s.healthRecorder.Record(ctx, tenantID, health); err != nil {
			s.logger.Error().Err(err).Str("endpoint_id", id.String()).Msg("record integration health history")
		}
	}
	return &health, nil
}

// HealthAll probes every endpoint for a tenant; used by the readiness/health
// confirmation (CAP-184..186). It never persists, so it is a cheap read.
func (s *IntegrationRegistryService) HealthAll(ctx context.Context, tenantID uuid.UUID) ([]model.IntegrationHealth, error) {
	endpoints, err := s.repo.List(ctx, tenantID, "", "")
	if err != nil {
		return nil, internalError("list integration endpoints", err)
	}
	out := make([]model.IntegrationHealth, 0, len(endpoints))
	for i := range endpoints {
		health := s.probe(ctx, endpoints[i])
		// Feature 6: the readiness sweep also feeds the health-history timeline so
		// the sparkline populates even without per-endpoint Health() calls. The
		// recorder is the single dedup point (the degrade edge fires once until
		// recovery), so recording from both Health and HealthAll is idempotent.
		// Best-effort: a recorder error never aborts the sweep.
		if s.healthRecorder != nil {
			if _, err := s.healthRecorder.Record(ctx, tenantID, health); err != nil {
				s.logger.Error().Err(err).Str("endpoint_id", endpoints[i].ID.String()).Msg("record integration health history")
			}
		}
		out = append(out, health)
	}
	return out, nil
}

// ListHealthHistory (feature 6) returns the endpoint's most recent health-check
// records (newest first) for the console uptime sparkline. It first loads the
// endpoint for 404/RLS semantics (mirroring ListSyncRuns), then delegates to the
// recorder; an unwired recorder yields an empty slice.
func (s *IntegrationRegistryService) ListHealthHistory(ctx context.Context, tenantID, id uuid.UUID, limit int) ([]integration.HealthCheckRecord, error) {
	if _, err := s.repo.Get(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("integration endpoint not found")
		}
		return nil, internalError("load integration endpoint", err)
	}
	if s.healthRecorder == nil {
		return []integration.HealthCheckRecord{}, nil
	}
	return s.healthRecorder.History(ctx, tenantID, id, limit)
}

func (s *IntegrationRegistryService) probe(ctx context.Context, endpoint model.IntegrationEndpoint) model.IntegrationHealth {
	now := s.now().UTC()
	adapter := s.adapters[endpoint.Kind]
	if adapter == nil {
		return model.IntegrationHealth{
			EndpointID:  endpoint.ID,
			Kind:        endpoint.Kind,
			Code:        endpoint.Code,
			Status:      endpoint.Status,
			Reachable:   false,
			Detail:      "no adapter registered for kind",
			CheckedUnix: now.Unix(),
		}
	}
	return adapter.Probe(ctx, endpoint, now)
}

// mask returns a copy of the endpoint with schema-aware redacted Config for API
// callers (replaces the old blunt redact). The per-kind ConfigSchema is the
// single source of truth: non-secret fields ECHO their value so the console can
// prefill the dynamic form, and secret fields collapse to the __redacted__
// sentinel (so the console shows "set" without ever receiving the cleartext).
// Adapters never use this — they read plaintext config via the repository.
func (s *IntegrationRegistryService) mask(endpoint *model.IntegrationEndpoint) *model.IntegrationEndpoint {
	if endpoint == nil {
		return nil
	}
	copied := *endpoint
	copied.Config = s.schemaFor(endpoint.Kind).MaskConfig(endpoint.Config)
	// Surface credential-expiry warnings (feature 10) as a non-secret metadata
	// annotation so the console can badge the endpoint without a separate call.
	// last_rotated (feature 5) already rides through metadata unchanged. Computed
	// from the connector's optional ExpiryReporter over non-sensitive config only;
	// never includes the secret value itself. The metadata map is copied so we do
	// not mutate the caller's/stored map.
	if warnings := integration.Expiries(s.adapters[endpoint.Kind], *endpoint); len(warnings) > 0 {
		meta := map[string]any{}
		for k, v := range endpoint.Metadata {
			meta[k] = v
		}
		meta["expiry_warnings"] = warnings
		copied.Metadata = meta
	}
	return &copied
}

// SchemaFor returns the dynamic-form field specs for a kind (drives
// GET /integrations/schema/{kind}). The bool reports whether the kind is known.
func (s *IntegrationRegistryService) SchemaFor(kind model.IntegrationKind) (integration.ConfigSchema, bool) {
	return integration.SchemaFor(kind)
}

// TestConnection runs the connector's optional ConnectionTester against the
// endpoint and persists last-test metadata. It type-asserts the capability:
// adapters that do not implement ConnectionTester yield a typed
// ErrCapabilityNotSupported (honest "not wired", not a faked pass). The adapter
// resolves plaintext config via the repository, so this method passes the masked
// model only for identity — but adapters re-fetch via the repo. To give the
// adapter plaintext, we re-load the endpoint from the repo (decrypted) and hand
// THAT to the tester; the returned TestResult is sanitized (no secrets).
func (s *IntegrationRegistryService) TestConnection(ctx context.Context, tenantID, id uuid.UUID) (*integration.TestResult, error) {
	endpoint, err := s.repo.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("integration endpoint not found")
		}
		return nil, internalError("load integration endpoint", err)
	}
	adapter := s.adapters[endpoint.Kind]
	tester, ok := adapter.(integration.ConnectionTester)
	if !ok || adapter == nil {
		return nil, validationError("connector does not support connection testing", map[string]string{"capability": "test_unsupported"})
	}
	// Reliability #12: fail fast when the breaker is open / the endpoint is
	// quarantined, so a flapping upstream is not hammered by repeated tests.
	if s.breaker != nil && !s.breaker.Allow(*endpoint) {
		return nil, validationError("integration circuit breaker is open or the endpoint is quarantined; reset the breaker before retrying", map[string]string{"breaker": "open"})
	}
	// Governance #14: resolve any kms://, vault:// secret references in the decrypted
	// config to the actual secret before the connector reads plaintext config. The
	// stored value stays the reference; only this in-memory copy carries the secret.
	dispatch, derr := s.resolveDispatchEndpoint(ctx, endpoint)
	if derr != nil {
		return nil, derr
	}
	started := s.now()
	result, terr := tester.TestConnection(ctx, dispatch)
	// Observability #16: record a per-dispatch call metric (op=test). A test is OK
	// only when it returned no error AND the connector reported reachable.
	s.recordCallMetric(ctx, *endpoint, integration.MetricsOpTest, started, terr == nil && result.Reachable)
	// Reliability #12/#11: report the outcome to the breaker and dead-letter a
	// failed test so it can be replayed.
	if s.breaker != nil {
		s.breaker.OnResult(ctx, *endpoint, terr == nil && result.Reachable)
	}
	if (terr != nil || !result.Reachable) && s.dlq != nil {
		dlqErr := terr
		if dlqErr == nil {
			dlqErr = errors.New(firstNonEmpty(result.Detail, "connection test failed"))
		}
		// A failed connection test is dead-lettered under the invoke source with the
		// reserved test-connection marker operation, so ReplayOperation re-runs a
		// TestConnection (not a mutating invoke).
		s.dlq.RecordFailure(ctx, *endpoint, integration.DLQSourceInvoke, map[string]any{"operation": dlqTestConnectionOp}, dlqErr)
	}
	now := s.now().UTC()
	if result.CheckedAt.IsZero() {
		result.CheckedAt = now
	}
	// Persist last-test metadata onto the endpoint (status unchanged; last_error
	// set on failure, cleared on success). Never write secret material.
	var lastError *string
	status := endpoint.Status
	if terr != nil || !result.Reachable {
		detail := result.Detail
		if terr != nil && detail == "" {
			detail = "connection test failed"
		}
		if detail != "" {
			lastError = &detail
		}
	}
	if err := s.repo.MarkChecked(ctx, tenantID, id, status, now, lastError); err != nil {
		s.logger.Error().Err(err).Str("endpoint_id", id.String()).Msg("persist integration test result")
	}
	if terr != nil {
		// Surface a sanitized failure result rather than the raw error (the
		// adapter already sanitized Detail); do not leak transport internals.
		if result.Detail == "" {
			result.Detail = "connection test failed"
		}
		result.Reachable = false
	}
	return &result, nil
}

// SyncNow runs the connector's optional Syncer against the endpoint and appends a
// sync-run ledger row (when a ledger is wired). It type-asserts the capability;
// adapters without Syncer yield a validation error. The adapter reads plaintext
// config via the repository; the returned SyncReport / ledger row are secret-free.
func (s *IntegrationRegistryService) SyncNow(ctx context.Context, tenantID, userID, id uuid.UUID, mode integration.SyncMode, force bool) (*integration.SyncReport, error) {
	endpoint, err := s.repo.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("integration endpoint not found")
		}
		return nil, internalError("load integration endpoint", err)
	}
	adapter := s.adapters[endpoint.Kind]
	syncer, ok := adapter.(integration.Syncer)
	if !ok || adapter == nil {
		return nil, validationError("connector does not support sync", map[string]string{"capability": "sync_unsupported"})
	}
	if !mode.Valid() {
		mode = integration.NormalizeSyncMode(string(mode))
	}
	preview := mode.IsPreview()
	// Reliability #12: a real (non-preview) sync against an open breaker / quarantined
	// endpoint fails fast. A preview is read-only and side-effect-free, so it is never
	// gated — the operator can still inspect "what a sync would do".
	if !preview && s.breaker != nil && !s.breaker.Allow(*endpoint) {
		return nil, validationError("integration circuit breaker is open or the endpoint is quarantined; reset the breaker before syncing", map[string]string{"breaker": "open"})
	}
	// Governance #15: a real sync egresses data to the connector's destination; enforce
	// the data-residency / field-egress policy (deny + audit a disallowed region/field).
	// A preview commits nothing but still reads upstream, so it is enforced too. The
	// egress surface is the endpoint's own field allow-list (the policy denies any field
	// NOT on it); region is derived from config.
	if s.egress != nil {
		if eerr := s.egress.Check(ctx, *endpoint, egressFieldsFor(*endpoint), egressRegionFor(*endpoint)); eerr != nil {
			return nil, mapEgressError(eerr)
		}
	}
	// Governance #14: resolve secret references for the connector.
	dispatch, derr := s.resolveDispatchEndpoint(ctx, endpoint)
	if derr != nil {
		return nil, derr
	}
	// Extensibility #20 (mass-change guard): before COMMITTING a real sync, run a
	// read-only PREVIEW pass to count the would-be deactivations and check them against
	// the endpoint's deactivation threshold. A sync that would deactivate too large a
	// fraction of the mapped org entities is BLOCKED with a 409 (+ a guard summary)
	// unless the operator forced it. The guard is skipped for a preview (it IS a
	// preview) and when no guard is wired. The preview is side-effect-free, so it costs
	// only an extra upstream read for safety.
	if !preview && !force && s.massGuard != nil {
		previewReport, perr := syncer.Sync(ctx, dispatch, integration.SyncModePreview)
		if perr == nil {
			if gerr := s.massGuard.Check(ctx, *endpoint, previewReport); gerr != nil {
				var mce *integration.MassChangeError
				if errors.As(gerr, &mce) {
					return nil, conflictErrorWithFields("mass-change guard: this sync would deactivate too large a share of mapped entities; re-run with force=true to override", massChangeGuardFields(mce.Summary))
				}
				return nil, internalError("mass-change guard", gerr)
			}
		} else {
			// A failed preview is not a guard trip — fall through and let the real sync
			// surface the same error through the normal path below.
			s.logger.Warn().Err(perr).Str("endpoint_id", id.String()).Msg("mass-change guard preview failed; proceeding to real sync")
		}
	}
	started := s.now().UTC()
	report, serr := syncer.Sync(ctx, dispatch, mode)
	finished := s.now().UTC()
	// Observability #16: record a per-dispatch call metric (op=sync) for both real and
	// preview syncs — a preview is still a connector round-trip whose latency/health is
	// worth tracking. ok = the syncer returned no error.
	s.recordCallMetric(ctx, *endpoint, integration.MetricsOpSync, started, serr == nil)
	// Reliability #12/#11: report the sync outcome to the breaker and dead-letter a
	// failed real sync (preview failures are not recorded — nothing was attempted
	// against the upstream that an operator would replay). Mode rides the payload so a
	// replay re-runs the same breadth.
	if !preview && s.breaker != nil {
		s.breaker.OnResult(ctx, *endpoint, serr == nil)
	}
	if !preview && serr != nil && s.dlq != nil {
		s.dlq.RecordFailure(ctx, *endpoint, integration.DLQSourceSync, map[string]any{"mode": string(mode)}, serr)
	}
	// A preview/dry-run report ALWAYS carries DryRun=true regardless of whether the
	// connector remembered to set it — the registry asked for preview, so nothing
	// was committed. Belt-and-braces against an older connector.
	if preview {
		report.DryRun = true
	}

	run := &integration.SyncRun{
		TenantID:    tenantID,
		EndpointID:  id,
		Kind:        endpoint.Kind,
		Mode:        mode,
		Processed:   report.Processed,
		Created:     report.Created,
		Updated:     report.Updated,
		Skipped:     report.Skipped,
		Failed:      report.Failed,
		Watermark:   report.Watermark,
		Detail:      report.Detail,
		Metadata:    report.Metadata,
		TriggeredBy: &userID,
		StartedAt:   started,
		FinishedAt:  finished,
	}
	if serr != nil {
		run.Status = integration.SyncRunStatusFailed
		run.Error = serr.Error()
		if run.Detail == "" {
			run.Detail = "sync failed"
		}
	} else {
		run.Status = integration.StatusFromReport(report)
	}
	// Tag the ledger row's metadata as a dry-run so the console can render preview
	// rows distinctly without inspecting the mode string.
	if preview {
		if run.Metadata == nil {
			run.Metadata = map[string]any{}
		}
		run.Metadata["dry_run"] = true
	}
	if s.ledger != nil {
		if lerr := s.ledger.Record(ctx, run); lerr != nil {
			s.logger.Error().Err(lerr).Str("endpoint_id", id.String()).Msg("record integration sync-run")
		}
	}
	// A preview computes counts but is NOT a live probe: it must not stamp
	// last-checked / last-error or emit a "synced" event (nothing changed). Real
	// full/delta runs stamp last-checked and emit the synced event.
	if !preview {
		var lastError *string
		if serr != nil {
			detail := run.Error
			lastError = &detail
		}
		if err := s.repo.MarkChecked(ctx, tenantID, id, endpoint.Status, finished, lastError); err != nil {
			s.logger.Error().Err(err).Str("endpoint_id", id.String()).Msg("persist sync last-checked")
		}
		s.emit(ctx, tenantID, userID, "com.clario360.lex.integration.synced", "integration.synced", endpoint)
	}
	if serr != nil {
		return &report, internalError("integration sync", serr)
	}
	return &report, nil
}

// Invoke runs the connector's optional Invoker capability against the endpoint,
// dispatching a named mutating operation with a JSON payload (Phase-2 action
// connectors: najiz add_representative/issue_wakala, esign dispatch_envelope,
// e-archive archive/apply_legal_hold/dispose, internal notify/post, email send,
// nafath request/status/details). It mirrors SyncNow's repo-reload-then-dispatch
// shape: the endpoint is reloaded DECRYPTED through the repo (so the connector
// receives plaintext config), the capability is type-asserted, the call is made,
// and a sanitized InvokeResult is returned. Adapters without Invoker yield a
// validation error. Secrets are never logged or echoed; the connector sanitizes
// its own Detail/Output. An audit record is emitted per invocation.
func (s *IntegrationRegistryService) Invoke(ctx context.Context, tenantID, userID, id uuid.UUID, operation string, payload map[string]any) (*integration.InvokeResult, error) {
	endpoint, err := s.repo.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("integration endpoint not found")
		}
		return nil, internalError("load integration endpoint", err)
	}
	adapter := s.adapters[endpoint.Kind]
	invoker, ok := adapter.(integration.Invoker)
	if !ok || adapter == nil {
		return nil, validationError("connector does not support invoke", map[string]string{"capability": "invoke_unsupported"})
	}
	operation = strings.TrimSpace(operation)
	if operation == "" {
		return nil, validationError("operation is required", map[string]string{"operation": "required"})
	}
	// Reliability #12: fail fast on an open breaker / quarantined endpoint before
	// dispatching a mutating action.
	if s.breaker != nil && !s.breaker.Allow(*endpoint) {
		return nil, validationError("integration circuit breaker is open or the endpoint is quarantined; reset the breaker before invoking", map[string]string{"breaker": "open"})
	}
	// Governance #15: an invoke egresses the action payload's fields to the connector's
	// destination; enforce the data-residency / field-egress policy (deny + audit a
	// disallowed region/field) BEFORE dispatching the mutating action. The egress
	// surface is the payload's top-level keys (field NAMES only — values never leave the
	// process); region is derived from config.
	if s.egress != nil {
		if eerr := s.egress.Check(ctx, *endpoint, payloadFieldNames(payload), egressRegionFor(*endpoint)); eerr != nil {
			return nil, mapEgressError(eerr)
		}
	}
	// Governance #14: resolve secret references for the connector.
	dispatch, derr := s.resolveDispatchEndpoint(ctx, endpoint)
	if derr != nil {
		return nil, derr
	}
	startedInvoke := s.now()
	result, ierr := invoker.Invoke(ctx, dispatch, operation, payload)
	// Observability #16: record a per-dispatch call metric keyed by the invoked
	// operation name (the op label IS the action), so the per-op breakdown is precise.
	// ok = no error AND the upstream accepted the action.
	s.recordCallMetric(ctx, *endpoint, operation, startedInvoke, ierr == nil && result.Success)
	// Reliability #12/#11: report the invoke outcome to the breaker and dead-letter a
	// failed invoke (operation + payload ride the row, REDACTED, so a replay re-runs
	// the same action).
	if s.breaker != nil {
		s.breaker.OnResult(ctx, *endpoint, ierr == nil && result.Success)
	}
	if (ierr != nil || !result.Success) && s.dlq != nil {
		dlqErr := ierr
		if dlqErr == nil {
			dlqErr = errors.New(firstNonEmpty(result.Detail, "invoke failed"))
		}
		s.dlq.RecordFailure(ctx, *endpoint, integration.DLQSourceInvoke, dlqInvokePayload(operation, payload), dlqErr)
	}
	now := s.now().UTC()
	// Stamp last-checked / last-error from the invoke outcome (status unchanged).
	var lastError *string
	if ierr != nil {
		detail := result.Detail
		if detail == "" {
			detail = "invoke failed"
		}
		lastError = &detail
	}
	if merr := s.repo.MarkChecked(ctx, tenantID, id, endpoint.Status, now, lastError); merr != nil {
		s.logger.Error().Err(merr).Str("endpoint_id", id.String()).Msg("persist invoke last-checked")
	}
	s.emit(ctx, tenantID, userID, "com.clario360.lex.integration.invoked", "integration.invoked", endpoint)
	if ierr != nil {
		// Return the sanitized result alongside the structured error; the adapter
		// already sanitized Detail (never leaks transport internals / secrets).
		if result.Detail == "" {
			result.Detail = "invoke failed"
		}
		result.Success = false
		return &result, internalError("integration invoke", ierr)
	}
	return &result, nil
}

// Reconcile (feature 3) runs a READ-ONLY source-vs-lex compare for an endpoint and
// returns the discrepancies (gaps + conflicts). It NEVER mutates lex data or any
// external system. When the connector implements the optional Reconciler
// capability it delegates to it; otherwise it derives a coarse reconciliation from
// a SyncModePreview pass (the preview's would-be Created counts surface as
// unmatched_source gaps, Failed as conflicts), so every Syncer-capable kind still
// produces a useful report. Connectors that are neither Reconciler nor Syncer
// yield a typed unsupported error.
func (s *IntegrationRegistryService) Reconcile(ctx context.Context, tenantID, id uuid.UUID) (*integration.ReconciliationReport, error) {
	endpoint, err := s.repo.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("integration endpoint not found")
		}
		return nil, internalError("load integration endpoint", err)
	}
	adapter := s.adapters[endpoint.Kind]
	if adapter == nil {
		return nil, validationError("connector does not support reconciliation", map[string]string{"capability": "reconcile_unsupported"})
	}
	// Preferred path: a connector that knows how to compare both sides natively.
	if reconciler, ok := adapter.(integration.Reconciler); ok {
		report, rerr := reconciler.Reconcile(ctx, *endpoint)
		if rerr != nil {
			return nil, internalError("integration reconcile", rerr)
		}
		ensureReconSummary(&report)
		s.recordConflicts(ctx, tenantID, id, report)
		return &report, nil
	}
	// Fallback: derive a coarse reconciliation from a read-only preview pass.
	syncer, ok := adapter.(integration.Syncer)
	if !ok {
		return nil, validationError("connector does not support reconciliation", map[string]string{"capability": "reconcile_unsupported"})
	}
	preview, serr := syncer.Sync(ctx, *endpoint, integration.SyncModePreview)
	if serr != nil {
		return nil, internalError("integration reconcile (preview)", serr)
	}
	report := integration.ReconciliationReport{Gaps: []integration.ReconItem{}, Conflicts: []integration.ReconItem{}}
	if preview.Created > 0 {
		report.Gaps = append(report.Gaps, integration.ReconItem{
			LexKind:   string(endpoint.Kind),
			Issue:     integration.ReconIssueUnmatchedSource,
			Detail:    pluralCount(preview.Created, "source record present upstream with no lex counterpart", "source records present upstream with no lex counterpart"),
			Suggested: "run a full sync to import the missing records",
		})
	}
	if preview.Failed > 0 {
		report.Conflicts = append(report.Conflicts, integration.ReconItem{
			LexKind:   string(endpoint.Kind),
			Issue:     integration.ReconIssueConflict,
			Detail:    pluralCount(preview.Failed, "source record could not be reconciled (conflict or validation error)", "source records could not be reconciled (conflict or validation error)"),
			Suggested: "review the connector sync log and resolve the conflicting records",
		})
	}
	ensureReconSummary(&report)
	s.recordConflicts(ctx, tenantID, id, report)
	return &report, nil
}

// recordConflicts (extensibility #20) persists the conflict findings of a
// reconciliation report into the conflict-resolution queue (when wired). It is
// best-effort: a queue write failure is logged but never fails the read-only
// reconcile (the report is still returned to the caller). Gaps are not conflicts and
// are not written.
func (s *IntegrationRegistryService) recordConflicts(ctx context.Context, tenantID, endpointID uuid.UUID, report integration.ReconciliationReport) {
	if s.conflicts == nil {
		return
	}
	if _, err := s.conflicts.RecordFromReconcile(ctx, tenantID, endpointID, report); err != nil {
		s.logger.Error().Err(err).Str("endpoint_id", endpointID.String()).Msg("record reconciliation conflicts")
	}
}

// RotateSecret (feature 5) re-encrypts ONE secret config field to a new value
// without touching any other field. It loads the DECRYPTED config, validates the
// field is a known SECRET field for the kind, sets ONLY that field (MergeSecrets
// semantics: all other secrets keep their stored ciphertext because they are left
// untouched in the existing plaintext map), stamps metadata
// last_rotated.<field>=now, and persists. The new value is never logged or
// returned; the response is the masked endpoint.
func (s *IntegrationRegistryService) RotateSecret(ctx context.Context, tenantID, userID, id uuid.UUID, fieldKey, newValue string) error {
	fieldKey = strings.TrimSpace(fieldKey)
	if fieldKey == "" {
		return validationError("field is required", map[string]string{"field": "required"})
	}
	if strings.TrimSpace(newValue) == "" || newValue == integration.RedactedSentinel {
		// Rotation must supply a real new secret; the sentinel would be a no-op.
		return validationError("a new secret value is required", map[string]string{"value": "required"})
	}
	endpoint, err := s.repo.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("integration endpoint not found")
		}
		return internalError("load integration endpoint", err)
	}
	schema := s.schemaFor(endpoint.Kind)
	field, ok := schema.FieldByKey(fieldKey)
	if !ok || !field.IsSecret() {
		return validationError("field is not a rotatable secret for this connector", map[string]string{"field": "not_secret"})
	}
	// endpoint.Config is DECRYPTED plaintext (repo decrypts on Get). Setting only
	// this one key leaves every other secret's plaintext intact, so the repo
	// re-encrypts them unchanged and re-encrypts ONLY this field's new value.
	if endpoint.Config == nil {
		endpoint.Config = map[string]any{}
	}
	endpoint.Config[fieldKey] = newValue
	// Stamp metadata last_rotated.<field>=now (non-secret operational annotation).
	stampLastRotated(endpoint, fieldKey, s.now().UTC())
	if err := s.repo.Update(ctx, s.db, endpoint); err != nil {
		return internalError("rotate integration secret", err)
	}
	// Audit the rotation by field name only — NEVER the value.
	s.emit(ctx, tenantID, userID, "com.clario360.lex.integration.secret_rotated", "integration.secret_rotated", endpoint)
	return nil
}

// SendTestEvent (feature 8/1) dispatches a SYNTHETIC provider/webhook event
// through the connector's inbound loop to prove end-to-end wiring, WITHOUT calling
// any external system. For webhook-bearing kinds (currently nafath_verify) it
// builds a synthetic event, signs it with the endpoint's own webhook secret using
// the same HMAC the public webhook verifier checks, and feeds it through that
// verifier IN-PROCESS — proving the secret + signature path works. On success it
// stamps metadata last_received_event_at=now (the same field the live webhook
// handler stamps via RecordInboundEvent). Kinds without an inbound webhook return
// a clear, non-faked unsupported result.
func (s *IntegrationRegistryService) SendTestEvent(ctx context.Context, tenantID, userID, id uuid.UUID) (*integration.InvokeResult, error) {
	endpoint, err := s.repo.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("integration endpoint not found")
		}
		return nil, internalError("load integration endpoint", err)
	}
	switch endpoint.Kind {
	case model.IntegrationKindNafathVerify:
		secret := integration.WebhookSecretFor(*endpoint)
		if strings.TrimSpace(secret) == "" {
			return &integration.InvokeResult{
				Operation: "webhook_test",
				Success:   false,
				Detail:    "no webhook secret configured: set the callback signing secret before testing the loop",
			}, nil
		}
		event, verr := integration.SimulateNafathWebhook(secret, s.now().UTC())
		if verr != nil {
			return &integration.InvokeResult{
				Operation: "webhook_test",
				Success:   false,
				Detail:    "synthetic webhook failed signature verification (check the configured secret)",
			}, nil
		}
		// Loop proven — stamp last-received-event and audit.
		s.recordInboundEvent(ctx, tenantID, endpoint)
		// Observability #17: record the synthetic loop as an inbound event so the
		// inspector shows the proven test event (signature verified end-to-end). The
		// status payload is non-secret; the event log redacts it defensively anyway.
		if s.eventLog != nil {
			s.eventLog.RecordEvent(ctx, *endpoint, integration.EventDirectionInbound,
				string(endpoint.Kind), map[string]any{
					"trans_id":   event.TransID,
					"status":     string(event.Status),
					"raw_status": event.RawStatus,
					"synthetic":  true,
				}, true, integration.EventStatusProcessed, "webhook_test")
		}
		s.emit(ctx, tenantID, userID, "com.clario360.lex.integration.webhook_tested", "integration.webhook_tested", endpoint)
		return &integration.InvokeResult{
			Operation: "webhook_test",
			Success:   true,
			Reference: event.TransID,
			Detail:    "synthetic webhook accepted: HMAC verified end-to-end (no external call made)",
			Output: map[string]any{
				"synthetic":  true,
				"status":     string(event.Status),
				"raw_status": event.RawStatus,
			},
		}, nil
	default:
		return &integration.InvokeResult{
			Operation: "webhook_test",
			Success:   false,
			Detail:    "this connector has no inbound webhook loop to test",
			Output:    map[string]any{"unsupported": true, "kind": string(endpoint.Kind)},
		}, nil
	}
}

// RecordInboundEvent (feature 8) stamps metadata last_received_event_at=now on an
// endpoint. The PUBLIC webhook handler calls this after it accepts a verified
// inbound event so the console can show "last event received N ago". It is
// best-effort and tenant-scoped; a load/persist failure is returned for the
// caller to log but must not fail webhook acknowledgement.
//
// Observability #17: in ADDITION to the metadata stamp, it now writes a REDACTED
// inbound-event row to the event log (when wired) so the event inspector + replay
// surface the receipt. It is the back-compat entry point (no signature/kind/action
// context); the webhook handler prefers RecordInboundEventDetailed.
func (s *IntegrationRegistryService) RecordInboundEvent(ctx context.Context, tenantID, id uuid.UUID) error {
	endpoint, err := s.repo.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("integration endpoint not found")
		}
		return internalError("load integration endpoint", err)
	}
	s.recordInboundEvent(ctx, tenantID, endpoint)
	// Best-effort event-log row with the coarse context available here (signature
	// verified upstream, kind from the endpoint, no specific action/payload).
	if s.eventLog != nil {
		s.eventLog.RecordEvent(ctx, *endpoint, integration.EventDirectionInbound,
			string(endpoint.Kind), map[string]any{}, true, integration.EventStatusReceived, "received")
	}
	return nil
}

// RecordInboundEventDetailed (observability #17) is the rich inbound-event entry
// the PUBLIC webhook handler calls on each VERIFIED inbound event: it stamps
// last_received_event_at AND writes a REDACTED event-log row carrying the
// signature-valid flag, the event kind, the resulting lex action, and the
// (redacted-on-write) payload. The payload is REDACTED by the event log before
// persistence, so secrets / PII never land in cleartext. Best-effort and tenant-
// scoped; any failure is returned for the caller to log but MUST NOT fail the
// webhook ack. The webhook surface is pre-auth (no tenant DB session), so it runs
// under the tenant resolved from the callback path.
func (s *IntegrationRegistryService) RecordInboundEventDetailed(ctx context.Context, tenantID, id uuid.UUID, kind string, payload map[string]any, sigValid bool, status, resultAction string) error {
	endpoint, err := s.repo.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("integration endpoint not found")
		}
		return internalError("load integration endpoint", err)
	}
	s.recordInboundEvent(ctx, tenantID, endpoint)
	if s.eventLog != nil {
		if kind == "" {
			kind = string(endpoint.Kind)
		}
		s.eventLog.RecordEvent(ctx, *endpoint, integration.EventDirectionInbound,
			kind, payload, sigValid, status, resultAction)
	}
	return nil
}

// recordInboundEvent stamps last_received_event_at on the (already-loaded,
// decrypted) endpoint and persists. Reusing the full Update re-encrypts the
// unchanged plaintext config (a no-op for secrets) and writes the metadata stamp.
func (s *IntegrationRegistryService) recordInboundEvent(ctx context.Context, tenantID uuid.UUID, endpoint *model.IntegrationEndpoint) {
	if endpoint.Metadata == nil {
		endpoint.Metadata = map[string]any{}
	}
	endpoint.Metadata["last_received_event_at"] = s.now().UTC().Format(time.RFC3339)
	if err := s.repo.Update(ctx, s.db, endpoint); err != nil {
		s.logger.Error().Err(err).Str("endpoint_id", endpoint.ID.String()).Msg("stamp last_received_event_at")
	}
}

// SandboxInvoke (feature 9) runs the connector in mock/sandbox mode for a named op
// via the optional SandboxInvoker capability. It NEVER hits a real upstream / gov
// system and NEVER mutates real or external state — every result is clearly marked
// sandbox by the connector. Connectors without SandboxInvoker yield a typed
// unsupported error. No last-checked stamping (a sandbox call is not a probe).
func (s *IntegrationRegistryService) SandboxInvoke(ctx context.Context, tenantID, userID, id uuid.UUID, op string, payload map[string]any) (*integration.InvokeResult, error) {
	endpoint, err := s.repo.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("integration endpoint not found")
		}
		return nil, internalError("load integration endpoint", err)
	}
	adapter := s.adapters[endpoint.Kind]
	sandbox, ok := adapter.(integration.SandboxInvoker)
	if !ok || adapter == nil {
		return nil, validationError("connector does not support sandbox invoke", map[string]string{"capability": "sandbox_unsupported"})
	}
	result, ierr := sandbox.SandboxInvoke(ctx, *endpoint, strings.TrimSpace(op), payload)
	// A sandbox call is demonstrative; audit it but never stamp health/last-error.
	s.emit(ctx, tenantID, userID, "com.clario360.lex.integration.sandbox_invoked", "integration.sandbox_invoked", endpoint)
	if ierr != nil {
		if result.Detail == "" {
			result.Detail = "sandbox invoke failed"
		}
		result.Success = false
		return &result, validationError(result.Detail, map[string]string{"operation": "sandbox_failed"})
	}
	return &result, nil
}

// ListActivity (feature 1/8) returns the endpoint's recent activity trail. The
// registry's durable, tenant-scoped per-endpoint activity is the sync-run ledger
// (every Test/Sync/Preview dispatch appends a row); ListActivity surfaces that as
// the activity feed. (Other registry mutations are emitted to the platform audit
// topic and read back through the audit-service, not from a local lex table, so
// the sync-run ledger is the authoritative local activity source.) Confirms the
// endpoint exists for the tenant first (404 + RLS semantics).
func (s *IntegrationRegistryService) ListActivity(ctx context.Context, tenantID, id uuid.UUID, limit int) ([]integration.SyncRun, error) {
	if _, err := s.repo.Get(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("integration endpoint not found")
		}
		return nil, internalError("load integration endpoint", err)
	}
	if s.ledger == nil {
		return []integration.SyncRun{}, nil
	}
	if limit <= 0 {
		limit = 50
	}
	runs, err := s.ledger.List(ctx, tenantID, id, limit)
	if err != nil {
		return nil, internalError("list integration activity", err)
	}
	return runs, nil
}

// Catalog (feature 7) returns the static, tenant-agnostic connector catalog
// (maturity, prerequisite steps, callback templates, KSA tags, self-serve flag)
// for every known kind. It carries no secrets and no tenant config.
func (s *IntegrationRegistryService) Catalog() []integration.CatalogEntry {
	return integration.Catalog()
}

// =============================================================================
// Observability surfaces (#16 per-connector metrics + SLOs, #17 event inspector).
// =============================================================================

// Metrics (observability #16) returns the windowed ConnectorMetrics for ONE
// endpoint (percentile_cont p50/p95 latency, error_rate, sync_throughput, the
// per-op breakdown, and the SLO breach verdict). It confirms the endpoint exists
// for the tenant first (404 + RLS, mirroring ListSyncRuns), then delegates to the
// recorder; an unwired recorder yields a zero-but-shaped ConnectorMetrics.
func (s *IntegrationRegistryService) Metrics(ctx context.Context, tenantID, id uuid.UUID, window time.Duration) (*integration.ConnectorMetrics, error) {
	if _, err := s.repo.Get(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("integration endpoint not found")
		}
		return nil, internalError("load integration endpoint", err)
	}
	if s.callMetrics == nil {
		empty := integration.ConnectorMetrics{Window: integration.ParseWindowLabel(window), SLOTargetPct: integration.DefaultSLOTargetPct, ByOp: []integration.OpMetric{}}
		return &empty, nil
	}
	m, err := s.callMetrics.Aggregate(ctx, tenantID, id, window)
	if err != nil {
		return nil, internalError("aggregate integration metrics", err)
	}
	return &m, nil
}

// MetricsOverview (observability #16) returns the tenant rollup: one OverviewMetric
// per endpoint with traffic in the window. An unwired recorder yields an empty
// slice.
func (s *IntegrationRegistryService) MetricsOverview(ctx context.Context, tenantID uuid.UUID, window time.Duration) ([]integration.OverviewMetric, error) {
	if s.callMetrics == nil {
		return []integration.OverviewMetric{}, nil
	}
	rows, err := s.callMetrics.Overview(ctx, tenantID, window)
	if err != nil {
		return nil, internalError("aggregate integration metrics overview", err)
	}
	return rows, nil
}

// ListEvents (observability #17) returns the REDACTED inbound-event rows for ONE
// endpoint (tenant-scoped), filtered by the optional direction/kind/status. It
// confirms the endpoint exists first (404 + RLS). An unwired event log yields an
// empty slice.
func (s *IntegrationRegistryService) ListEvents(ctx context.Context, tenantID, id uuid.UUID, filter repository.IntegrationEventFilter) ([]integration.IntegrationEvent, error) {
	if _, err := s.repo.Get(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("integration endpoint not found")
		}
		return nil, internalError("load integration endpoint", err)
	}
	if s.eventLog == nil {
		return []integration.IntegrationEvent{}, nil
	}
	items, err := s.eventLog.List(ctx, tenantID, id, filter)
	if err != nil {
		return nil, internalError("list integration events", err)
	}
	return items, nil
}

// ListAllEvents (observability #17) returns the REDACTED inbound-event rows ACROSS
// every endpoint for the tenant, filtered by the optional direction/kind/status. An
// unwired event log yields an empty slice.
func (s *IntegrationRegistryService) ListAllEvents(ctx context.Context, tenantID uuid.UUID, filter repository.IntegrationEventFilter) ([]integration.IntegrationEvent, error) {
	if s.eventLog == nil {
		return []integration.IntegrationEvent{}, nil
	}
	items, err := s.eventLog.ListAll(ctx, tenantID, filter)
	if err != nil {
		return nil, internalError("list integration events", err)
	}
	return items, nil
}

// ReplayEvent (observability #17) RE-DISPATCHES ONE inbound event through the
// connector. A missing event (or an unwired event log) maps to a 404. The replay
// itself never errors on a re-failure (captured in the EventReplayResult); only
// load failures surface. It audits the replay.
func (s *IntegrationRegistryService) ReplayEvent(ctx context.Context, tenantID, userID, eventID uuid.UUID) (*integration.EventReplayResult, error) {
	if s.eventLog == nil {
		return nil, notFoundError("integration event not found")
	}
	res, err := s.eventLog.Replay(ctx, tenantID, userID, eventID)
	if err != nil {
		if integration.IsEventNotFound(err) {
			return nil, notFoundError("integration event not found")
		}
		return nil, internalError("replay integration event", err)
	}
	s.emit(ctx, tenantID, userID, "com.clario360.lex.integration.event_replayed", "integration.event_replayed",
		map[string]any{"id": eventID})
	return &res, nil
}

// DispatchInboundEvent satisfies integration.EventDispatcher: it re-processes a
// previously-received inbound event through the connector's inbound loop. For a
// nafath_verify event it re-asserts the synthetic/verified loop end-to-end IN-
// PROCESS (no external call, no mutation) and reports the normalised status as the
// result action; downstream identity-confirmation stamping is owned by the
// consuming flow, so a replay re-surfaces the verified event for it. Kinds without
// an inbound loop report a clear, non-faked unsupported signal. It NEVER handles
// secrets and NEVER mutates external state.
func (s *IntegrationRegistryService) DispatchInboundEvent(ctx context.Context, tenantID, userID, endpointID uuid.UUID, kind model.IntegrationKind, payload map[string]any) (string, string, error) {
	endpoint, err := s.repo.Get(ctx, tenantID, endpointID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return "", "", notFoundError("integration endpoint not found")
		}
		return "", "", internalError("load integration endpoint", err)
	}
	switch kind {
	case model.IntegrationKindNafathVerify:
		// Re-prove the inbound webhook loop in-process: a synthetic, secret-free re-
		// verification that the endpoint's signature path is wired. This re-dispatch
		// confirms the event would be accepted again without calling Nafath.
		secret := integration.WebhookSecretFor(*endpoint)
		if strings.TrimSpace(secret) == "" {
			return "", "", validationError("no webhook secret configured: cannot replay the inbound loop", map[string]string{"webhook_secret": "required"})
		}
		event, verr := integration.SimulateNafathWebhook(secret, s.now().UTC())
		if verr != nil {
			return "replay_failed", "", validationError("inbound event failed re-verification (check the configured secret)", map[string]string{"signature": "invalid"})
		}
		return "identity_status:" + string(event.Status), "inbound event re-verified end-to-end (no external call)", nil
	default:
		return "", "", validationError("this connector has no inbound event loop to replay", map[string]string{"kind": string(kind)})
	}
}

// ensureReconSummary fills the summary roll-up (count per issue type) from the
// gaps + conflicts so callers do not have to.
func ensureReconSummary(report *integration.ReconciliationReport) {
	if report.Gaps == nil {
		report.Gaps = []integration.ReconItem{}
	}
	if report.Conflicts == nil {
		report.Conflicts = []integration.ReconItem{}
	}
	summary := map[string]int{}
	for _, it := range report.Gaps {
		summary[it.Issue]++
	}
	for _, it := range report.Conflicts {
		summary[it.Issue]++
	}
	summary["gaps"] = len(report.Gaps)
	summary["conflicts"] = len(report.Conflicts)
	report.Summary = summary
}

// stampLastRotated records metadata.last_rotated.<field> = RFC3339(now) without
// disturbing other metadata. last_rotated is a nested map keyed by field.
func stampLastRotated(endpoint *model.IntegrationEndpoint, field string, now time.Time) {
	if endpoint.Metadata == nil {
		endpoint.Metadata = map[string]any{}
	}
	rotated, _ := endpoint.Metadata["last_rotated"].(map[string]any)
	if rotated == nil {
		rotated = map[string]any{}
	}
	rotated[field] = now.Format(time.RFC3339)
	endpoint.Metadata["last_rotated"] = rotated
}

// pluralCount formats an "N <thing>" message choosing the singular/plural noun.
func pluralCount(n int, singular, plural string) string {
	noun := plural
	if n == 1 {
		noun = singular
	}
	return strconv.Itoa(n) + " " + noun
}

// ListSyncRuns returns the most recent sync-run ledger rows for an endpoint.
// Requires a wired ledger; returns an empty slice when none is configured.
func (s *IntegrationRegistryService) ListSyncRuns(ctx context.Context, tenantID, id uuid.UUID, limit int) ([]integration.SyncRun, error) {
	// Confirm the endpoint exists for the tenant (RLS + 404 semantics).
	if _, err := s.repo.Get(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("integration endpoint not found")
		}
		return nil, internalError("load integration endpoint", err)
	}
	if s.ledger == nil {
		return []integration.SyncRun{}, nil
	}
	runs, err := s.ledger.List(ctx, tenantID, id, limit)
	if err != nil {
		return nil, internalError("list integration sync-runs", err)
	}
	return runs, nil
}

// ListTenantIDs returns every tenant with at least one live integration endpoint,
// the cross-tenant fan-out source for the IntegrationSyncMonitor.
func (s *IntegrationRegistryService) ListTenantIDs(ctx context.Context) ([]uuid.UUID, error) {
	return s.repo.ListTenantIDs(ctx)
}

// SupportsSync reports whether the adapter registered for a kind implements the
// optional Syncer capability. The scheduler uses this to skip endpoints whose
// connector cannot be pulled (and would otherwise yield a "sync unsupported"
// validation error from SyncNow). It mirrors the type-assert SyncNow performs.
func (s *IntegrationRegistryService) SupportsSync(kind model.IntegrationKind) bool {
	adapter := s.adapters[kind]
	if adapter == nil {
		return false
	}
	_, ok := adapter.(integration.Syncer)
	return ok
}

// LastSuccessfulSyncByEndpoint returns the most recent successful-or-partial sync
// finish time per endpoint for a tenant, sourced from the sync-run ledger. It
// powers the scheduler's "due" decision in a single query. When no ledger is
// wired it returns an empty map (the scheduler then treats every endpoint as
// never-synced → due, first pull full).
func (s *IntegrationRegistryService) LastSuccessfulSyncByEndpoint(ctx context.Context, tenantID uuid.UUID) (map[uuid.UUID]time.Time, error) {
	if s.ledger == nil {
		return map[uuid.UUID]time.Time{}, nil
	}
	return s.ledger.LastSuccessfulSyncByEndpoint(ctx, tenantID)
}

// =============================================================================
// Reliability features #11 (DLQ) + #12 (circuit breaker) — registry surfaces.
// =============================================================================

// dlqTestConnectionOp is the reserved marker operation a dead-lettered
// TestConnection failure carries (source=invoke) so ReplayOperation re-runs a
// TestConnection rather than a mutating Invoke.
const dlqTestConnectionOp = "__test_connection__"

// ListDeadLetters returns the dead-letter rows for ONE endpoint (tenant-scoped),
// newest first. It first confirms the endpoint exists for the tenant (404 + RLS
// semantics, mirroring ListSyncRuns), then delegates to the DLQ service. An unwired
// DLQ yields an empty slice.
func (s *IntegrationRegistryService) ListDeadLetters(ctx context.Context, tenantID, id uuid.UUID, status string, limit int) ([]integration.DeadLetter, error) {
	if _, err := s.repo.Get(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("integration endpoint not found")
		}
		return nil, internalError("load integration endpoint", err)
	}
	if s.dlq == nil {
		return []integration.DeadLetter{}, nil
	}
	items, err := s.dlq.List(ctx, tenantID, id, status, limit)
	if err != nil {
		return nil, internalError("list integration dead-letters", err)
	}
	return items, nil
}

// ListAllDeadLetters returns the dead-letter rows ACROSS every endpoint for the
// tenant, newest first. An unwired DLQ yields an empty slice.
func (s *IntegrationRegistryService) ListAllDeadLetters(ctx context.Context, tenantID uuid.UUID, status string, limit int) ([]integration.DeadLetter, error) {
	if s.dlq == nil {
		return []integration.DeadLetter{}, nil
	}
	items, err := s.dlq.ListAll(ctx, tenantID, status, limit)
	if err != nil {
		return nil, internalError("list integration dead-letters", err)
	}
	return items, nil
}

// ReplayDeadLetter re-runs ONE failed dead-letter row's original operation. A
// missing row (or an unwired DLQ) maps to a 404. The replay itself never errors on
// a re-failure (that is captured in the ReplayResult); only load failures surface.
func (s *IntegrationRegistryService) ReplayDeadLetter(ctx context.Context, tenantID, userID, dlqID uuid.UUID) (*integration.ReplayResult, error) {
	if s.dlq == nil {
		return nil, notFoundError("dead-letter not found")
	}
	result, err := s.dlq.Replay(ctx, tenantID, userID, dlqID)
	if err != nil {
		if integration.IsNotFound(err) {
			return nil, notFoundError("dead-letter not found")
		}
		return nil, internalError("replay integration dead-letter", err)
	}
	return &result, nil
}

// ReplayFailedDeadLetters batch-replays EVERY failed dead-letter row for an
// endpoint and returns the replayed/failed roll-up. It confirms the endpoint exists
// first (404 + RLS). An unwired DLQ yields a zero result.
func (s *IntegrationRegistryService) ReplayFailedDeadLetters(ctx context.Context, tenantID, userID, id uuid.UUID) (*integration.BatchReplayResult, error) {
	if _, err := s.repo.Get(ctx, tenantID, id); err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("integration endpoint not found")
		}
		return nil, internalError("load integration endpoint", err)
	}
	if s.dlq == nil {
		return &integration.BatchReplayResult{}, nil
	}
	result, err := s.dlq.ReplayFailed(ctx, tenantID, userID, id)
	if err != nil {
		return nil, internalError("replay failed integration dead-letters", err)
	}
	return &result, nil
}

// BreakerState returns the endpoint's circuit-breaker snapshot. It confirms the
// endpoint exists for the tenant (404 + RLS), then reads the in-process controller
// (parametrised from the endpoint's non-secret config). An unwired controller
// reports a default-closed breaker.
func (s *IntegrationRegistryService) BreakerState(ctx context.Context, tenantID, id uuid.UUID) (*integration.BreakerState, error) {
	endpoint, err := s.repo.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("integration endpoint not found")
		}
		return nil, internalError("load integration endpoint", err)
	}
	if s.breaker == nil {
		state := integration.BreakerState{
			State:            integration.BreakerStateClosed,
			FailureThreshold: integration.DefaultFailureThreshold,
			CooldownSeconds:  integration.DefaultBreakerCooldownSecond,
		}
		return &state, nil
	}
	state := s.breaker.State(*endpoint)
	return &state, nil
}

// ResetBreaker manually closes the endpoint's breaker and clears its quarantine
// (un-disabling the endpoint via the Quarantiner), returning the post-reset state.
// It confirms the endpoint exists (404 + RLS) and audits the reset.
func (s *IntegrationRegistryService) ResetBreaker(ctx context.Context, tenantID, userID, id uuid.UUID) (*integration.BreakerState, error) {
	endpoint, err := s.repo.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("integration endpoint not found")
		}
		return nil, internalError("load integration endpoint", err)
	}
	if s.breaker == nil {
		state := integration.BreakerState{
			State:            integration.BreakerStateClosed,
			FailureThreshold: integration.DefaultFailureThreshold,
			CooldownSeconds:  integration.DefaultBreakerCooldownSecond,
		}
		return &state, nil
	}
	state := s.breaker.Reset(ctx, *endpoint)
	s.emit(ctx, tenantID, userID, "com.clario360.lex.integration.breaker_reset", "integration.breaker_reset", endpoint)
	return &state, nil
}

// RecordWebhookFailure dead-letters a VERIFIED-but-failed inbound webhook handling
// (source=webhook). The HMAC already authenticated the caller, but downstream
// processing of the event failed; the operator can replay it later. The payload is
// REDACTED by the DLQ service before persistence. Best-effort: an unwired DLQ or a
// write error never affects the webhook ack. The webhook surface is pre-auth (no
// tenant DB session), so the tenant is the one resolved from the callback path.
func (s *IntegrationRegistryService) RecordWebhookFailure(ctx context.Context, tenantID, endpointID uuid.UUID, payload map[string]any, handlingErr error) {
	if s.dlq == nil {
		return
	}
	endpoint, err := s.repo.Get(ctx, tenantID, endpointID)
	if err != nil {
		s.logger.Warn().Err(err).Str("endpoint_id", endpointID.String()).Msg("load endpoint for webhook dead-letter")
		return
	}
	s.dlq.RecordFailure(ctx, *endpoint, integration.DLQSourceWebhook, payload, handlingErr)
}

// ReplayOperation satisfies integration.ReplayRunner: it re-runs a dead-lettered
// operation through the registry by source. A 'sync' row re-runs SyncNow (mode from
// the payload, defaulting to delta); an 'invoke' row re-runs Invoke (operation +
// payload) — or a TestConnection when it carries the reserved test-connection marker
// operation; webhook/outbox replays are not auto-runnable from the registry and
// report a clear unsupported detail. The registry re-resolves plaintext config
// itself; this never handles secrets. Errors propagate so the DLQ marks the row
// failed (attempt bumped); a nil error transitions it to replayed.
func (s *IntegrationRegistryService) ReplayOperation(ctx context.Context, tenantID, userID, endpointID uuid.UUID, source integration.DLQSource, payload map[string]any) (string, error) {
	switch source {
	case integration.DLQSourceSync:
		mode := integration.NormalizeSyncMode(payloadString(payload, "mode"))
		// A DLQ replay is an explicit operator-driven retry of a known operation, so the
		// mass-change guard (extensibility #20) is bypassed (force=true) — it already had
		// its chance on the original dispatch.
		report, err := s.SyncNow(ctx, tenantID, userID, endpointID, mode, true)
		if err != nil {
			return "", err
		}
		return firstNonEmpty(report.Detail, "sync replayed"), nil
	case integration.DLQSourceInvoke:
		op := payloadString(payload, "operation")
		if op == dlqTestConnectionOp {
			result, err := s.TestConnection(ctx, tenantID, endpointID)
			if err != nil {
				return "", err
			}
			if result != nil && !result.Reachable {
				return "", errors.New(firstNonEmpty(result.Detail, "connection test still failing"))
			}
			return firstNonEmpty(result.Detail, "connection test replayed"), nil
		}
		inner, _ := payload["payload"].(map[string]any)
		result, err := s.Invoke(ctx, tenantID, userID, endpointID, op, inner)
		if err != nil {
			return "", err
		}
		return firstNonEmpty(result.Detail, "invoke replayed"), nil
	default:
		return "", validationError("this dead-letter source cannot be auto-replayed from the registry", map[string]string{"source": string(source)})
	}
}

// Quarantine satisfies integration.Quarantiner: it disables an endpoint so the
// registry/scheduler stops dispatching to it (auto-quarantine on repeated breaker
// opens). It stamps the quarantine reason + timestamp onto non-secret metadata and
// records last_error so the console surfaces why. Best-effort and idempotent (a
// re-quarantine of an already-disabled endpoint is a no-op write).
func (s *IntegrationRegistryService) Quarantine(ctx context.Context, tenantID, endpointID uuid.UUID, reason string) error {
	endpoint, err := s.repo.Get(ctx, tenantID, endpointID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("integration endpoint not found")
		}
		return internalError("load integration endpoint", err)
	}
	if endpoint.Metadata == nil {
		endpoint.Metadata = map[string]any{}
	}
	endpoint.Metadata["quarantined"] = true
	endpoint.Metadata["quarantine_reason"] = reason
	endpoint.Metadata["quarantined_at"] = s.now().UTC().Format(time.RFC3339)
	endpoint.Status = model.IntegrationStatusDisabled
	detail := reason
	endpoint.LastError = &detail
	if err := s.repo.Update(ctx, s.db, endpoint); err != nil {
		return internalError("quarantine integration endpoint", err)
	}
	s.emit(ctx, tenantID, endpoint.CreatedBy, "com.clario360.lex.integration.quarantined", "integration.quarantined", endpoint)
	return nil
}

// Unquarantine satisfies integration.Quarantiner: it restores a quarantined
// endpoint (status disabled -> active, clearing the quarantine metadata) on an
// explicit breaker reset. If the endpoint was disabled for a reason OTHER than
// auto-quarantine (no quarantined metadata flag), it is left untouched so a manual
// disable is not silently re-enabled.
func (s *IntegrationRegistryService) Unquarantine(ctx context.Context, tenantID, endpointID uuid.UUID) error {
	endpoint, err := s.repo.Get(ctx, tenantID, endpointID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("integration endpoint not found")
		}
		return internalError("load integration endpoint", err)
	}
	quarantined, _ := endpoint.Metadata["quarantined"].(bool)
	if !quarantined {
		// Not auto-quarantined: do not re-enable a manually-disabled endpoint.
		return nil
	}
	delete(endpoint.Metadata, "quarantined")
	delete(endpoint.Metadata, "quarantine_reason")
	delete(endpoint.Metadata, "quarantined_at")
	endpoint.Status = model.IntegrationStatusActive
	endpoint.LastError = nil
	if err := s.repo.Update(ctx, s.db, endpoint); err != nil {
		return internalError("clear integration quarantine", err)
	}
	s.emit(ctx, tenantID, endpoint.CreatedBy, "com.clario360.lex.integration.unquarantined", "integration.unquarantined", endpoint)
	return nil
}

// dlqInvokePayload builds the (pre-redaction) dead-letter payload for a failed
// invoke: the operation name + the nested action payload, so ReplayOperation can
// re-dispatch the same action. The DLQ service redacts secret-bearing keys from the
// nested payload before persisting.
func dlqInvokePayload(operation string, payload map[string]any) map[string]any {
	return map[string]any{"operation": operation, "payload": payload}
}

// payloadString reads a string field from a DLQ payload, tolerating absence.
func payloadString(payload map[string]any, key string) string {
	if payload == nil {
		return ""
	}
	if v, ok := payload[key].(string); ok {
		return v
	}
	return ""
}

func (s *IntegrationRegistryService) emit(ctx context.Context, tenantID, userID uuid.UUID, eventType, action string, payload any) {
	writeEvent(ctx, s.publisher, "lex-service", s.topic, eventType, tenantID, &userID, integrationEventPayload(payload), s.logger)
	if s.audit != nil {
		s.audit.Emit(ctx, LexAuditRecord{
			TenantID:     tenantID,
			ActorUserID:  &userID,
			Action:       action,
			ResourceType: "integration_endpoint",
			ResourceID:   integrationResourceID(payload),
			Detail:       map[string]any{"action": action},
		})
	}
}

// integrationEventPayload emits non-sensitive identifiers only (never the config).
func integrationEventPayload(payload any) map[string]any {
	switch v := payload.(type) {
	case *model.IntegrationEndpoint:
		if v != nil {
			return map[string]any{"id": v.ID, "kind": v.Kind, "code": v.Code, "status": v.Status}
		}
	case map[string]any:
		return v
	}
	return map[string]any{}
}

func integrationResourceID(payload any) string {
	switch v := payload.(type) {
	case *model.IntegrationEndpoint:
		if v != nil {
			return v.ID.String()
		}
	case map[string]any:
		if id, ok := v["id"].(uuid.UUID); ok {
			return id.String()
		}
		if id, ok := v["id"].(string); ok {
			return id
		}
	}
	return ""
}

// =============================================================================
// Integration GOVERNANCE surfaces (#13 maker-checker, #14 rotation, #15 egress).
// =============================================================================

// ProposeChangeResult is the outcome of ProposeChange. Exactly one of Change /
// Endpoint is set: a PROTECTED endpoint yields a parked Change (status=pending,
// applied=false); a NON-protected endpoint applies immediately and yields the
// (masked) Endpoint.
type ProposeChangeResult struct {
	Change   *integration.PendingChange
	Endpoint *model.IntegrationEndpoint
}

// ProposeChange (governance #13) submits a proposed config for an endpoint. When the
// endpoint is PROTECTED (active production OR a gov-gated kind) and the gate is wired,
// it parks a pending change carrying a SECRET-MASKED diff and returns it WITHOUT
// applying. Otherwise it applies the change immediately (the same merge/validate path
// a direct Update takes) and returns the endpoint. The proposed config is validated
// (post-merge) before parking so a clearly-invalid change is rejected up front rather
// than at approval time.
func (s *IntegrationRegistryService) ProposeChange(ctx context.Context, tenantID, userID, id uuid.UUID, proposedConfig map[string]any) (*ProposeChangeResult, error) {
	endpoint, err := s.repo.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("integration endpoint not found")
		}
		return nil, internalError("load integration endpoint", err)
	}
	if proposedConfig == nil {
		proposedConfig = map[string]any{}
	}
	// Validate the would-be merged config up front (active-required enforced against
	// the endpoint's current status) so a bad change never parks. MergeSecrets keeps
	// stored ciphertext for sentinel/blank secrets.
	schema := s.schemaFor(endpoint.Kind)
	merged := schema.MergeSecrets(endpoint.Config, proposedConfig)
	if errs := schema.Validate(merged, endpoint.Status == model.IntegrationStatusActive); errs != nil {
		return nil, validationError("integration config failed validation", errs)
	}
	if s.changeGate != nil && s.changeGate.IsProtected(*endpoint) {
		outcome, perr := s.changeGate.Propose(ctx, *endpoint, proposedConfig, userID)
		if perr != nil {
			return nil, internalError("propose integration change", perr)
		}
		if outcome.Change != nil {
			s.emit(ctx, tenantID, userID, "com.clario360.lex.integration.change_proposed", "integration.change_proposed", endpoint)
			return &ProposeChangeResult{Change: outcome.Change}, nil
		}
	}
	// Not protected (or gate unwired): apply immediately.
	req := dto.UpdateIntegrationEndpointRequest{Config: proposedConfig}
	applied, aerr := s.applyUpdate(ctx, tenantID, userID, endpoint, &req)
	if aerr != nil {
		return nil, aerr
	}
	return &ProposeChangeResult{Endpoint: applied}, nil
}

// ApplyProposedConfig satisfies integration.EndpointUpdater: it applies an APPROVED
// change's proposed config to the endpoint via the shared apply path (merge/validate/
// encrypt/audit), exactly as a direct Update would. It re-loads the endpoint
// (decrypted) for the current ciphertext, then merges the proposed config. The change
// gate calls this AFTER it has transitioned the row to approved.
func (s *IntegrationRegistryService) ApplyProposedConfig(ctx context.Context, tenantID, userID, endpointID uuid.UUID, proposedConfig map[string]any) (*model.IntegrationEndpoint, error) {
	endpoint, err := s.repo.Get(ctx, tenantID, endpointID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("integration endpoint not found")
		}
		return nil, internalError("load integration endpoint", err)
	}
	req := dto.UpdateIntegrationEndpointRequest{Config: proposedConfig}
	return s.applyUpdate(ctx, tenantID, userID, endpoint, &req)
}

// ListPendingChanges (governance #13) returns the tenant's pending integration config
// changes (optionally filtered by status), newest first. Each row's endpoint name +
// kind are resolved via the registry's metadata lookup. An unwired gate yields an
// empty slice.
func (s *IntegrationRegistryService) ListPendingChanges(ctx context.Context, tenantID uuid.UUID, status string, limit int) ([]integration.PendingChange, error) {
	if s.changeGate == nil {
		return []integration.PendingChange{}, nil
	}
	items, err := s.changeGate.List(ctx, tenantID, status, limit, s.endpointMetaLookup())
	if err != nil {
		return nil, internalError("list integration pending changes", err)
	}
	return items, nil
}

// ApprovePendingChange (governance #13) approves + applies a pending change, enforcing
// SoD where configured. It maps the gate's typed failures to the right HTTP status: a
// missing change -> 404, an already-reviewed change -> 409, an SoD violation -> 403, a
// missing rejection note -> 422. Returns the applied (masked) endpoint.
func (s *IntegrationRegistryService) ApprovePendingChange(ctx context.Context, tenantID, userID, changeID uuid.UUID, note string) (*model.IntegrationEndpoint, error) {
	if s.changeGate == nil {
		return nil, notFoundError("pending change not found")
	}
	endpoint, err := s.changeGate.Approve(ctx, tenantID, changeID, userID, note)
	if err != nil {
		return nil, mapChangeGateError(err)
	}
	s.emit(ctx, tenantID, userID, "com.clario360.lex.integration.change_approved", "integration.change_approved", endpoint)
	return endpoint, nil
}

// RejectPendingChange (governance #13) rejects a pending change (note required). Maps
// the gate's typed failures to HTTP statuses. Returns the rejected PendingChange.
func (s *IntegrationRegistryService) RejectPendingChange(ctx context.Context, tenantID, userID, changeID uuid.UUID, note string) (*integration.PendingChange, error) {
	if s.changeGate == nil {
		return nil, notFoundError("pending change not found")
	}
	change, err := s.changeGate.Reject(ctx, tenantID, changeID, userID, note, s.endpointMetaLookup())
	if err != nil {
		return nil, mapChangeGateError(err)
	}
	s.emit(ctx, tenantID, userID, "com.clario360.lex.integration.change_rejected", "integration.change_rejected",
		map[string]any{"id": change.EndpointID})
	return change, nil
}

// endpointMetaLookup builds the gate's name/kind resolver over the endpoint repo. A
// missing endpoint yields ("", "") so a pending change for a since-deleted endpoint
// still lists.
func (s *IntegrationRegistryService) endpointMetaLookup() integration.EndpointMetaLookup {
	return func(ctx context.Context, tenantID, endpointID uuid.UUID) (string, model.IntegrationKind) {
		ep, err := s.repo.Get(ctx, tenantID, endpointID)
		if err != nil || ep == nil {
			return "", ""
		}
		return ep.Name, ep.Kind
	}
}

// GetEgressPolicy (governance #15) returns the endpoint's data-residency / field-egress
// policy, derived from its non-secret config. Confirms the endpoint exists for the
// tenant (404 + RLS).
func (s *IntegrationRegistryService) GetEgressPolicy(ctx context.Context, tenantID, id uuid.UUID) (*integration.EgressPolicy, error) {
	endpoint, err := s.repo.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("integration endpoint not found")
		}
		return nil, internalError("load integration endpoint", err)
	}
	policy := integration.EgressPolicyFromConfig(*endpoint)
	return &policy, nil
}

// UpdateEgressPolicy (governance #15) replaces the endpoint's data-residency /
// field-egress allow-lists (the non-secret allowed_regions / allowed_egress_fields
// config fields) and stamps egress_policy_updated_at. It loads the DECRYPTED config,
// sets ONLY the two policy fields (other config — incl. secrets — is untouched, so the
// repo re-encrypts them unchanged), validates, persists, and audits. Returns the
// updated policy.
func (s *IntegrationRegistryService) UpdateEgressPolicy(ctx context.Context, tenantID, userID, id uuid.UUID, allowedRegions, allowedEgressFields []string) (*integration.EgressPolicy, error) {
	endpoint, err := s.repo.Get(ctx, tenantID, id)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, notFoundError("integration endpoint not found")
		}
		return nil, internalError("load integration endpoint", err)
	}
	if endpoint.Config == nil {
		endpoint.Config = map[string]any{}
	}
	endpoint.Config[integration.AllowedRegionsKey] = normalizeStringList(allowedRegions)
	endpoint.Config[integration.AllowedEgressFieldsKey] = normalizeStringList(allowedEgressFields)
	if endpoint.Metadata == nil {
		endpoint.Metadata = map[string]any{}
	}
	endpoint.Metadata["egress_policy_updated_at"] = s.now().UTC().Format(time.RFC3339)
	schema := s.schemaFor(endpoint.Kind)
	if errs := schema.Validate(endpoint.Config, endpoint.Status == model.IntegrationStatusActive); errs != nil {
		return nil, validationError("integration config failed validation", errs)
	}
	if err := s.repo.Update(ctx, s.db, endpoint); err != nil {
		return nil, internalError("update integration egress policy", err)
	}
	s.emit(ctx, tenantID, userID, "com.clario360.lex.integration.egress_policy_updated", "integration.egress_policy_updated", endpoint)
	policy := integration.EgressPolicyFromConfig(*endpoint)
	return &policy, nil
}

// EmitRotationReminder satisfies the rotation monitor's reminder seam (#14): it audits
// + emits an integration event for an endpoint's due/approaching secret fields. It
// carries field NAMES + timing only — never a secret value. Best-effort; the registry's
// audit/event path is the integration notification surface (mirroring the degrade-alert
// pattern). Confirms the endpoint exists for the tenant first.
func (s *IntegrationRegistryService) EmitRotationReminder(ctx context.Context, tenantID, endpointID uuid.UUID, fields []integration.RotationField) error {
	endpoint, err := s.repo.Get(ctx, tenantID, endpointID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return notFoundError("integration endpoint not found")
		}
		return internalError("load integration endpoint", err)
	}
	names := make([]string, 0, len(fields))
	for _, f := range fields {
		names = append(names, f.Field)
	}
	if s.audit != nil {
		s.audit.Emit(ctx, LexAuditRecord{
			TenantID:     tenantID,
			Action:       "integration.secret_rotation_due",
			ResourceType: "integration_endpoint",
			ResourceID:   endpointID.String(),
			Detail: map[string]any{
				"action": "integration.secret_rotation_due",
				"kind":   string(endpoint.Kind),
				"fields": names,
			},
		})
	}
	writeEvent(ctx, s.publisher, "lex-service", s.topic, "com.clario360.lex.integration.secret_rotation_due", tenantID, nil,
		map[string]any{"id": endpointID, "kind": endpoint.Kind, "fields": names}, s.logger)
	return nil
}

// AutoRotateSecret satisfies the rotation monitor's auto-rotate seam (#14). Automatic
// rotation requires the registry to MINT/SOURCE a fresh secret without a human typing
// one — which only an external secret provider (KMS/Vault) can do, and only when the
// field's stored value is an external REFERENCE the provider re-resolves (the
// "rotate at source, lex follows the reference" model). The reference itself does not
// change; rotation happens in the external store and lex re-stamps last_rotated so the
// cadence resets. A field with a plaintext (in-lex) secret cannot be auto-rotated
// without a human — that returns a typed unsupported signal the monitor logs + skips.
// It NEVER fabricates or logs a secret. Returns whether a rotation was performed.
func (s *IntegrationRegistryService) AutoRotateSecret(ctx context.Context, tenantID, endpointID uuid.UUID, field string) (bool, error) {
	endpoint, err := s.repo.Get(ctx, tenantID, endpointID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return false, notFoundError("integration endpoint not found")
		}
		return false, internalError("load integration endpoint", err)
	}
	schema := s.schemaFor(endpoint.Kind)
	spec, ok := schema.FieldByKey(field)
	if !ok || !spec.IsSecret() {
		return false, validationError("field is not a rotatable secret for this connector", map[string]string{"field": "not_secret"})
	}
	stored, _ := endpoint.Config[field].(string)
	if !integration.IsSecretRef(stored) {
		// An in-lex plaintext secret cannot be auto-minted; a human rotates it.
		return false, validationError("auto-rotation requires an external secret reference (kms://, vault://); rotate this in-lex secret manually", map[string]string{"field": "not_external_ref"})
	}
	// The reference is unchanged (the secret rotates at the external source). We only
	// re-stamp last_rotated so the cadence resets and the connector picks up the
	// freshly-resolved secret on its next call (resolveDispatchEndpoint resolves the
	// reference at call time). Persist via the shared update path (re-encrypts the
	// unchanged config; secrets, including the reference, are untouched).
	stampLastRotated(endpoint, field, s.now().UTC())
	if err := s.repo.Update(ctx, s.db, endpoint); err != nil {
		return false, internalError("auto-rotate integration secret", err)
	}
	s.emit(ctx, tenantID, endpoint.CreatedBy, "com.clario360.lex.integration.secret_rotated", "integration.secret_rotated", endpoint)
	return true, nil
}

// EmitEgressBlocked satisfies integration.EgressAuditEmitter: it records a denied
// egress (data-residency / field-egress policy) to the lex audit trail with field
// NAMES + region + reason only — never values or secrets.
func (s *IntegrationRegistryService) EmitEgressBlocked(ctx context.Context, tenantID uuid.UUID, endpoint model.IntegrationEndpoint, region string, fields []string, reason string) {
	if s.audit == nil {
		return
	}
	s.audit.Emit(ctx, LexAuditRecord{
		TenantID:     tenantID,
		Action:       "integration.egress_blocked",
		ResourceType: "integration_endpoint",
		ResourceID:   endpoint.ID.String(),
		Detail: map[string]any{
			"action": "integration.egress_blocked",
			"kind":   string(endpoint.Kind),
			"region": region,
			"fields": fields,
			"reason": reason,
		},
	})
}

// mapChangeGateError maps a change-gate failure to the right lex HTTP error. A typed
// ChangeGateError carries the classification; the repository not-found sentinel maps to
// a 404; anything else is a 500.
func mapChangeGateError(err error) error {
	if ge, ok := integration.AsChangeGateError(err); ok {
		switch ge.Code {
		case integration.ChangeGateAlreadyReviewed:
			return conflictError(ge.Message)
		case integration.ChangeGateSoDViolation:
			return forbiddenError(ge.Message)
		case integration.ChangeGateNoteRequired:
			return validationError(ge.Message, map[string]string{"note": "required"})
		default:
			return conflictError(ge.Message)
		}
	}
	if integration.IsPendingChangeNotFound(err) {
		return notFoundError("pending change not found")
	}
	return internalError("review integration pending change", err)
}

// mapEgressError maps an EgressEnforcer denial to a secret-free 422 validation error
// (the policy already audited the denial). A non-egress error passes through as an
// internal error.
func mapEgressError(err error) error {
	if de, ok := err.(*integration.EgressDeniedError); ok {
		fields := map[string]string{"egress": "denied"}
		if de.Region != "" {
			fields["region"] = de.Region
		}
		if len(de.Fields) > 0 {
			fields["fields"] = strings.Join(de.Fields, ",")
		}
		return validationError(de.Error(), fields)
	}
	return internalError("enforce integration egress policy", err)
}

// egressRegionFor derives the destination region an endpoint egresses to from its
// non-secret config (a "region" field, else "environment" when it names a region).
// An empty result means "region not asserted" — the enforcer then skips region checks
// for this call (field-egress enforcement still applies).
func egressRegionFor(endpoint model.IntegrationEndpoint) string {
	if endpoint.Config == nil {
		return ""
	}
	if v, ok := endpoint.Config["region"].(string); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return ""
}

// egressFieldsFor returns the field-egress surface a SYNC asserts: the endpoint's own
// allowed_egress_fields list. A sync that egresses exactly its declared fields passes;
// the policy is the guard against a misconfigured/empty allow-list when regions are
// also constrained. When the allow-list is empty, the surface is empty and only the
// region is enforced.
func egressFieldsFor(endpoint model.IntegrationEndpoint) []string {
	policy := integration.EgressPolicyFromConfig(endpoint)
	return policy.AllowedEgressFields
}

// payloadFieldNames returns the top-level keys of an invoke payload (field NAMES only;
// values never leave the process) as the egress surface for the field-egress policy.
func payloadFieldNames(payload map[string]any) []string {
	if len(payload) == 0 {
		return nil
	}
	out := make([]string, 0, len(payload))
	for k := range payload {
		out = append(out, k)
	}
	return out
}

// massChangeGuardFields renders a mass-change guard summary as a non-sensitive
// string map for a 409 response body (extensibility #20), so the console can explain
// the block: how many entities would be deactivated, the denominator, the configured
// threshold, and the computed change percentage.
func massChangeGuardFields(s integration.MassChangeSummary) map[string]string {
	return map[string]string{
		"guard":            "mass_change",
		"mapped_entities":  strconv.Itoa(s.MappedEntities),
		"would_deactivate": strconv.Itoa(s.WouldDeactivate),
		"threshold_pct":    strconv.FormatFloat(s.ThresholdPct, 'f', -1, 64),
		"change_pct":       strconv.FormatFloat(s.ChangePct, 'f', 1, 64),
		"force_hint":       "re-run POST /integrations/{id}/sync?force=true to override",
	}
}

// normalizeStringList lower-cases + trims a string slice, dropping blanks and
// de-duplicating, for stable storage of the egress allow-lists.
func normalizeStringList(in []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, s := range in {
		t := strings.ToLower(strings.TrimSpace(s))
		if t == "" || seen[t] {
			continue
		}
		seen[t] = true
		out = append(out, t)
	}
	return out
}

func validateIntegrationKind(kind model.IntegrationKind) error {
	switch kind {
	case model.IntegrationKindNajiz, model.IntegrationKindHR, model.IntegrationKindInternal,
		model.IntegrationKindArchiving, model.IntegrationKindEmail,
		model.IntegrationKindNafathVerify, model.IntegrationKindSSO, model.IntegrationKindEsign,
		model.IntegrationKindCustom:
		return nil
	default:
		return validationError("unsupported integration kind", map[string]string{"kind": "invalid"})
	}
}

func validateIntegrationStatus(status model.IntegrationStatus) error {
	switch status {
	case model.IntegrationStatusPlanned, model.IntegrationStatusActive,
		model.IntegrationStatusDisabled, model.IntegrationStatusError:
		return nil
	default:
		return validationError("unsupported integration status", map[string]string{"status": "invalid"})
	}
}

// =============================================================================
// Bundled fallback adapters (CAP-174..178). Each reports an honest health
// verdict derived from endpoint lifecycle plus adapter availability. They never
// report reachable because no connector implementation is registered.
// =============================================================================

type fallbackIntegrationAdapter struct {
	kind model.IntegrationKind
}

func (a fallbackIntegrationAdapter) Kind() model.IntegrationKind { return a.kind }

func (a fallbackIntegrationAdapter) Probe(_ context.Context, endpoint model.IntegrationEndpoint, now time.Time) model.IntegrationHealth {
	health := model.IntegrationHealth{
		EndpointID:  endpoint.ID,
		Kind:        a.kind,
		Code:        endpoint.Code,
		Status:      endpoint.Status,
		CheckedUnix: now.Unix(),
	}
	switch endpoint.Status {
	case model.IntegrationStatusActive:
		health.Reachable = false
		health.Detail = "connector adapter is not registered"
	case model.IntegrationStatusPlanned:
		health.Reachable = false
		health.Detail = "planned: not yet activated"
	case model.IntegrationStatusDisabled:
		health.Reachable = false
		health.Detail = "disabled by operator"
	default:
		health.Reachable = false
		health.Detail = "endpoint in error state"
	}
	return health
}

func defaultIntegrationAdapters() []IntegrationAdapter {
	return []IntegrationAdapter{
		fallbackIntegrationAdapter{kind: model.IntegrationKindNajiz},
		fallbackIntegrationAdapter{kind: model.IntegrationKindHR},
		fallbackIntegrationAdapter{kind: model.IntegrationKindInternal},
		fallbackIntegrationAdapter{kind: model.IntegrationKindArchiving},
		fallbackIntegrationAdapter{kind: model.IntegrationKindEmail},
		fallbackIntegrationAdapter{kind: model.IntegrationKindNafathVerify},
		fallbackIntegrationAdapter{kind: model.IntegrationKindSSO},
		fallbackIntegrationAdapter{kind: model.IntegrationKindEsign},
		fallbackIntegrationAdapter{kind: model.IntegrationKindYardi},
	}
}
