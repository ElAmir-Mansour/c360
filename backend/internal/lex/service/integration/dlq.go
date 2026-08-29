package integration

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// =============================================================================
// Reliability feature #11 — integration dead-letter queue (DLQ).
//
// When a registry-dispatched integration operation FAILS (a SyncNow / Invoke /
// TestConnection dispatch, or a verified-but-failed inbound webhook handling),
// the registry calls DLQService.RecordFailure to durably capture the failed op so
// an operator can REPLAY it from the admin console. The recorded payload is
// REDACTED (secrets stripped) before it ever reaches storage — cleartext
// credentials are NEVER persisted, logged, or returned.
//
// Replay re-runs the ORIGINAL operation through the registry via the ReplayRunner
// seam (the registry satisfies it; the seam keeps this package free of an import
// cycle on package service). On a successful re-run the row transitions to
// 'replayed'; on a re-failure it stays 'failed' with a bumped attempt counter.
// =============================================================================

// DLQSource classifies which registry operation produced a dead-letter row. It is
// the DeadLetter.Source domain and mirrors the migration's CHECK constraint.
type DLQSource string

const (
	// DLQSourceSync is a failed Syncer.Sync dispatch (SyncNow).
	DLQSourceSync DLQSource = "sync"
	// DLQSourceWebhook is a verified-but-failed inbound webhook handling.
	DLQSourceWebhook DLQSource = "webhook"
	// DLQSourceOutbox is a failed outbound delivery (outbox dispatcher).
	DLQSourceOutbox DLQSource = "outbox"
	// DLQSourceInvoke is a failed Invoker.Invoke action call.
	DLQSourceInvoke DLQSource = "invoke"
)

// Valid reports whether the source is a recognised DLQ source.
func (s DLQSource) Valid() bool {
	switch s {
	case DLQSourceSync, DLQSourceWebhook, DLQSourceOutbox, DLQSourceInvoke:
		return true
	default:
		return false
	}
}

// DeadLetter is one dead-letter record surfaced to the admin console (the API twin
// of repository.IntegrationDLQRow). Payload is the REDACTED operation payload
// (secrets already stripped); Error is a sanitized, operator-safe message. The
// JSON shape matches the pinned reliability API exactly.
type DeadLetter struct {
	ID              uuid.UUID      `json:"id"`
	EndpointID      uuid.UUID      `json:"endpoint_id"`
	Source          DLQSource      `json:"source"`
	Summary         string         `json:"summary"`
	Error           string         `json:"error"`
	Attempts        int            `json:"attempts"`
	Status          string         `json:"status"`
	PayloadRedacted map[string]any `json:"payload_redacted"`
	CreatedAt       time.Time      `json:"created_at"`
	LastAttemptAt   *time.Time     `json:"last_attempt_at,omitempty"`
}

// ReplayResult is the outcome of replaying ONE dead-letter row.
type ReplayResult struct {
	// ID echoes the replayed dead-letter row id.
	ID uuid.UUID `json:"id"`
	// OK reports whether the re-run succeeded (the row is then 'replayed').
	OK bool `json:"ok"`
	// Status is the row's resulting status (replayed | failed).
	Status string `json:"status"`
	// Detail is an operator-safe message (secret-free).
	Detail string `json:"detail"`
}

// BatchReplayResult is the roll-up of ReplayFailed over an endpoint's failed rows.
type BatchReplayResult struct {
	Replayed int `json:"replayed"`
	Failed   int `json:"failed"`
}

// ReplayRunner is the seam DLQService.Replay uses to re-run a failed operation
// through the registry. The IntegrationRegistryService satisfies it (its Replay*
// adapter calls SyncNow / Invoke / TestConnection by source). Taking it as a
// narrow interface here keeps service/integration free of an import cycle on
// package service. Implementations receive the DECRYPTED-config dispatch via the
// registry; this package never handles plaintext config or secrets.
type ReplayRunner interface {
	// ReplayOperation re-runs the original failed operation identified by source +
	// the REDACTED payload (the registry re-resolves plaintext config itself). It
	// returns a sanitized detail and an error on failure. tenantID/userID scope the
	// re-run; endpointID identifies the target endpoint.
	ReplayOperation(ctx context.Context, tenantID, userID, endpointID uuid.UUID, source DLQSource, payload map[string]any) (detail string, err error)
}

// DLQService records failed integration operations and replays them. It is a thin
// service over IntegrationDLQRepository plus the per-kind ConfigSchema (for payload
// redaction) and an optional ReplayRunner (for re-running). A nil repo makes every
// method a safe no-op (RecordFailure swallows, List* return empty) so the registry
// never fails an operation just because the DLQ is unwired.
type DLQService struct {
	repo   *repository.IntegrationDLQRepository
	runner ReplayRunner
	logger zerolog.Logger
	now    func() time.Time
}

// NewDLQService builds a DLQ service over the repository. The ReplayRunner is wired
// separately via WithRunner (it is the registry, which holds the DLQ service — a
// construction cycle resolved by the setter). now defaults to time.Now (UTC).
func NewDLQService(repo *repository.IntegrationDLQRepository, logger zerolog.Logger) *DLQService {
	return &DLQService{
		repo:   repo,
		logger: logger.With().Str("component", "lex-integration-dlq").Logger(),
		now:    func() time.Time { return time.Now().UTC() },
	}
}

// WithRunner wires the replay runner (the registry) after both are constructed.
// Returns the receiver for chaining. A nil runner disables Replay (List/Record
// still work; Replay reports the runner is unwired).
func (s *DLQService) WithRunner(runner ReplayRunner) *DLQService {
	if s != nil {
		s.runner = runner
	}
	return s
}

// RecordFailure durably captures a FAILED integration operation. It REDACTS the
// payload against the endpoint kind's secret-field schema BEFORE persisting (so a
// payload that echoed a credential never lands in cleartext), derives a sanitized
// summary, and writes one row. Best-effort: a nil repo or a write error is logged
// and swallowed so the caller (the registry) never fails the underlying operation
// just because the DLQ could not record it. opErr is sanitized to its message only
// — connectors already sanitize their Detail, and an op error string must not carry
// secrets.
func (s *DLQService) RecordFailure(ctx context.Context, endpoint model.IntegrationEndpoint, source DLQSource, payload map[string]any, opErr error) {
	if s == nil || s.repo == nil {
		return
	}
	if !source.Valid() {
		source = DLQSourceSync
	}
	row := &repository.IntegrationDLQRow{
		TenantID:   endpoint.TenantID,
		EndpointID: endpoint.ID,
		Source:     string(source),
		Summary:    dlqSummary(endpoint, source),
		Payload:    RedactPayloadForKind(endpoint.Kind, payload),
		Error:      sanitizeDLQError(opErr),
		Attempts:   0,
		Status:     repository.DLQStatusFailed,
	}
	if err := s.repo.Record(ctx, row); err != nil {
		s.logger.Error().Err(err).Str("endpoint_id", endpoint.ID.String()).Msg("record integration dead-letter")
	}
}

// List returns the dead-letter rows for ONE endpoint (tenant-scoped), newest
// first. An empty status returns all statuses. Returns an empty slice when the
// repo is unwired.
func (s *DLQService) List(ctx context.Context, tenantID, endpointID uuid.UUID, status string, limit int) ([]DeadLetter, error) {
	if s == nil || s.repo == nil {
		return []DeadLetter{}, nil
	}
	rows, err := s.repo.ListByEndpoint(ctx, tenantID, endpointID, status, limit)
	if err != nil {
		return nil, err
	}
	return mapDeadLetters(rows), nil
}

// ListAll returns the dead-letter rows ACROSS every endpoint for a tenant, newest
// first. Returns an empty slice when the repo is unwired.
func (s *DLQService) ListAll(ctx context.Context, tenantID uuid.UUID, status string, limit int) ([]DeadLetter, error) {
	if s == nil || s.repo == nil {
		return []DeadLetter{}, nil
	}
	rows, err := s.repo.ListByTenant(ctx, tenantID, status, limit)
	if err != nil {
		return nil, err
	}
	return mapDeadLetters(rows), nil
}

// Replay re-runs ONE failed dead-letter row's original operation through the
// ReplayRunner. It loads the row (tenant-scoped, 404 on absence), re-runs the op
// for the recorded source + REDACTED payload, then marks the row 'replayed' on
// success or leaves it 'failed' (attempt counter bumped) on a re-failure. The
// returned ReplayResult is sanitized. A nil runner reports an unwired replay path.
func (s *DLQService) Replay(ctx context.Context, tenantID, userID, dlqID uuid.UUID) (ReplayResult, error) {
	if s == nil || s.repo == nil {
		return ReplayResult{}, fmt.Errorf("lex/integration: dlq repository has no database")
	}
	row, err := s.repo.Get(ctx, tenantID, dlqID)
	if err != nil {
		return ReplayResult{}, err
	}
	return s.replayRow(ctx, tenantID, userID, *row), nil
}

// ReplayFailed batch-replays EVERY 'failed' row for an endpoint (oldest first) and
// returns the replayed/failed roll-up. Each row is replayed independently; one
// re-failure does not abort the batch. Returns a zero result when the repo is
// unwired.
func (s *DLQService) ReplayFailed(ctx context.Context, tenantID, userID, endpointID uuid.UUID) (BatchReplayResult, error) {
	if s == nil || s.repo == nil {
		return BatchReplayResult{}, nil
	}
	rows, err := s.repo.ListFailedForEndpoint(ctx, tenantID, endpointID)
	if err != nil {
		return BatchReplayResult{}, err
	}
	var out BatchReplayResult
	for i := range rows {
		res := s.replayRow(ctx, tenantID, userID, rows[i])
		if res.OK {
			out.Replayed++
		} else {
			out.Failed++
		}
	}
	return out, nil
}

// replayRow re-runs one row's operation and persists the resulting status. It
// never returns an error (a re-failure is a normal outcome captured in the
// ReplayResult); a persistence error is logged only.
func (s *DLQService) replayRow(ctx context.Context, tenantID, userID uuid.UUID, row repository.IntegrationDLQRow) ReplayResult {
	res := ReplayResult{ID: row.ID, Status: row.Status}
	if s.runner == nil {
		res.OK = false
		res.Detail = "replay runner is not wired"
		return res
	}
	now := s.now()
	detail, rerr := s.runner.ReplayOperation(ctx, tenantID, userID, row.EndpointID, DLQSource(row.Source), row.Payload)
	status := repository.DLQStatusReplayed
	if rerr != nil {
		status = repository.DLQStatusFailed
		res.OK = false
		res.Detail = sanitizeDLQError(rerr)
	} else {
		res.OK = true
		res.Detail = detail
		if strings.TrimSpace(res.Detail) == "" {
			res.Detail = "replayed successfully"
		}
	}
	if err := s.repo.MarkAttempt(ctx, tenantID, row.ID, status, now); err != nil {
		s.logger.Error().Err(err).Str("dlq_id", row.ID.String()).Msg("mark dead-letter replay attempt")
	}
	res.Status = status
	return res
}

// mapDeadLetters maps storage rows to API DeadLetter structs. The stored payload is
// already redacted at write time; this is a straight field copy.
func mapDeadLetters(rows []repository.IntegrationDLQRow) []DeadLetter {
	out := make([]DeadLetter, 0, len(rows))
	for i := range rows {
		out = append(out, DeadLetter{
			ID:              rows[i].ID,
			EndpointID:      rows[i].EndpointID,
			Source:          DLQSource(rows[i].Source),
			Summary:         rows[i].Summary,
			Error:           rows[i].Error,
			Attempts:        rows[i].Attempts,
			Status:          rows[i].Status,
			PayloadRedacted: orEmpty(rows[i].Payload),
			CreatedAt:       rows[i].CreatedAt,
			LastAttemptAt:   rows[i].LastAttemptAt,
		})
	}
	return out
}

// RedactPayloadForKind strips any value whose key is a SECRET field for the kind's
// ConfigSchema, replacing it with the RedactedSentinel, so a dead-letter payload
// that echoed an operation credential never persists in cleartext. It also redacts
// a small set of well-known sensitive key fragments (password/secret/token/key)
// defensively, since an operation payload is free-form and may carry credentials
// not in the connector config schema. Non-sensitive keys pass through unchanged.
// It never mutates the input map.
func RedactPayloadForKind(kind model.IntegrationKind, payload map[string]any) map[string]any {
	out := map[string]any{}
	schema, _ := SchemaFor(kind)
	secretKeys := map[string]bool{}
	for _, f := range schema {
		if f.IsSecret() {
			secretKeys[f.Key] = true
		}
	}
	for k, v := range payload {
		if secretKeys[k] || looksSensitiveKey(k) {
			out[k] = RedactedSentinel
			continue
		}
		// Recurse into a nested map (e.g. the invoke action payload carried under the
		// "payload" key) so a credential one level down is redacted too.
		if nested, ok := v.(map[string]any); ok {
			out[k] = RedactPayloadForKind(kind, nested)
			continue
		}
		out[k] = v
	}
	return out
}

// looksSensitiveKey reports whether a free-form payload key reads as a credential
// (defensive redaction for keys not in the connector config schema).
func looksSensitiveKey(key string) bool {
	k := strings.ToLower(key)
	for _, needle := range []string{"password", "secret", "token", "api_key", "apikey", "private_key", "credential", "passphrase"} {
		if strings.Contains(k, needle) {
			return true
		}
	}
	return false
}

// dlqSummary builds a short, operator-safe summary for a dead-letter row from the
// endpoint identity + source (secret-free).
func dlqSummary(endpoint model.IntegrationEndpoint, source DLQSource) string {
	return fmt.Sprintf("%s %s (%s) failed", string(source), endpoint.Code, string(endpoint.Kind))
}

// sanitizeDLQError reduces an error to its message string. Connectors already
// sanitize their Detail/error text (no secrets); this guards against a nil error.
func sanitizeDLQError(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

// IsNotFound reports whether an error is the repository's not-found sentinel, so
// the handler can map a missing dead-letter row to a 404.
func IsNotFound(err error) bool {
	return err == pgx.ErrNoRows
}
