package appverify

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/events"
)

// EventRecoveryValidated is the normalised event type the failover driver emits
// when the VALIDATING gate passes (events.NewEvent prepends "com.clario360."). Its
// payload carries run_id, group_id and the app_verification detail with one row
// per recovered workload — the source this projector reads.
const EventRecoveryValidated = "com.clario360.datastream.dr.failover.recovery.validated"

// validatedPayload is the subset of the recovery.validated event payload the
// projector reads. The failover driver's emit() adds run_id/group_id; the health
// gate adds the app_verification detail.
type validatedPayload struct {
	RunID           string                 `json:"run_id"`
	GroupID         string                 `json:"group_id"`
	AppVerification *appVerificationDetail `json:"app_verification"`
}

type appVerificationDetail struct {
	Results []appVerificationRow `json:"results"`
}

type appVerificationRow struct {
	SiteID  string  `json:"site_id"`
	Planned bool    `json:"planned"`
	Passed  bool    `json:"passed"`
	Result  *Result `json:"result"`
}

// parseValidatedResults extracts the per-workload app-verification results from a
// recovery.validated payload, scoping them to tenantID. Rows that did not plan an
// app verification (planned=false, e.g. health-only members) are skipped — they
// verified no application and carry no Result.
func parseValidatedResults(tenantID uuid.UUID, data []byte) ([]StoredResult, error) {
	var payload validatedPayload
	if err := json.Unmarshal(data, &payload); err != nil {
		return nil, fmt.Errorf("unmarshal recovery.validated payload: %w", err)
	}
	if payload.AppVerification == nil || len(payload.AppVerification.Results) == 0 {
		return nil, nil
	}
	groupID, err := uuid.Parse(payload.GroupID)
	if err != nil {
		return nil, fmt.Errorf("invalid group_id %q: %w", payload.GroupID, err)
	}

	out := make([]StoredResult, 0, len(payload.AppVerification.Results))
	for _, row := range payload.AppVerification.Results {
		if !row.Planned || row.Result == nil {
			continue
		}
		res := *row.Result
		kind := res.ProfileKind
		if kind == "" {
			kind = res.RequestedKind
		}
		siteID := row.SiteID
		if siteID == "" {
			siteID = res.WorkloadID
		}
		failed := res.FailedChecks
		if failed == nil {
			failed = []string{}
		}
		out = append(out, StoredResult{
			TenantID:       tenantID,
			GroupID:        groupID,
			RunID:          payload.RunID,
			SiteID:         siteID,
			WorkloadID:     res.WorkloadID,
			WorkloadKind:   string(kind),
			Passed:         res.Passed,
			ChecksTotal:    res.ChecksTotal,
			ChecksPassed:   res.ChecksPassed,
			RequiredTotal:  res.RequiredTotal,
			RequiredPassed: res.RequiredPassed,
			FailedChecks:   failed,
			DurationMS:     res.DurationMS,
			FinishedAt:     res.FinishedAt,
			Result:         res,
		})
	}
	return out, nil
}

// resultStore is the persistence surface the projector needs. *Store satisfies it.
type resultStore interface {
	Save(ctx context.Context, db DBTX, rec *StoredResult) error
}

// ResultProjector is the reconcile consumer that projects app-verification
// results from the failover recovery.validated event into the dedicated
// dr_appverify_result table. It is an events.TypedEventHandler, so it plugs into
// the shared DR reconcile consumer exactly like the attestation-ledger consumer;
// running it as a leader singleton plus the idempotent (run_id, site_id) upsert
// means each recovered workload's result is projected exactly once across
// redelivery/restart. It does NOT touch the hot failover path — the gate already
// emitted the event.
type ResultProjector struct {
	store  resultStore
	runner txRunner
	topic  string
	logger zerolog.Logger
}

// NewResultProjector constructs a projector. topic is the DR events topic the
// recovery.validated event is published to (defaults to datastream.dr.events).
func NewResultProjector(store resultStore, runner txRunner, topic string, logger zerolog.Logger) *ResultProjector {
	if topic == "" {
		topic = "datastream.dr.events"
	}
	return &ResultProjector{
		store:  store,
		runner: runner,
		topic:  topic,
		logger: logger.With().Str("consumer", "dr-appverify-projection").Logger(),
	}
}

// Topics returns the bus topics this consumer subscribes to.
func (p *ResultProjector) Topics() []string { return []string{p.topic} }

// EventTypes returns the single event type this consumer projects, so the shared
// consumer's type filter skips everything else on the busy DR events topic.
func (p *ResultProjector) EventTypes() []string { return []string{EventRecoveryValidated} }

// Handle projects one recovery.validated event. A malformed event (missing/invalid
// tenant or undecodable payload) is dropped (logged, nil) so a single bad message
// does not wedge the consumer group; a store failure is returned so the bus
// retries (the upsert makes retry safe).
func (p *ResultProjector) Handle(ctx context.Context, event *events.Event) error {
	tenantID, err := uuid.Parse(event.TenantID)
	if err != nil || tenantID == uuid.Nil {
		p.logger.Warn().Str("tenant_id", event.TenantID).Msg("appverify projection: event missing/invalid tenant id; dropping")
		return nil
	}
	results, err := parseValidatedResults(tenantID, event.Data)
	if err != nil {
		p.logger.Warn().Err(err).Msg("appverify projection: undecodable recovery.validated payload; dropping")
		return nil
	}
	if len(results) == 0 {
		return nil
	}
	if err := p.runner.RunWithTenant(ctx, tenantID, func(db DBTX) error {
		for i := range results {
			if serr := p.store.Save(ctx, db, &results[i]); serr != nil {
				return fmt.Errorf("project appverify result run=%s site=%s: %w", results[i].RunID, results[i].SiteID, serr)
			}
		}
		return nil
	}); err != nil {
		return err
	}
	p.logger.Debug().
		Str("tenant_id", tenantID.String()).
		Int("workloads", len(results)).
		Msg("appverify results projected from recovery.validated")
	return nil
}

var _ events.TypedEventHandler = (*ResultProjector)(nil)
