package service

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/events"
	"github.com/clario360/platform/internal/events/outbox"
	"github.com/clario360/platform/internal/workflow/model"
	"github.com/clario360/platform/internal/workflow/repository"
)

// ErrConflict is returned when a promotion or guarded mutation is rejected
// because a definition version is immutable, or because a promotion is not a
// legal next step in the dev→staging→prod FSM. Callers (and the INTEGRATE-wired
// HTTP handler) map it to 409 Conflict. It wraps model.ErrConflict so existing
// errors.Is checks against the model sentinel keep working.
var ErrConflict = repository.ErrPromotionConflict

// promotionStore is the persistence surface PromotionService needs. It mirrors
// repository.PromotionRepository so tests can substitute an in-memory store.
type promotionStore interface {
	GetByID(ctx context.Context, db repository.PromotionDBTX, tenantID, id string) (*repository.PromotionRecord, error)
	GetLineageKey(ctx context.Context, db repository.PromotionDBTX, tenantID, id string) (string, error)
	SetStage(ctx context.Context, db repository.PromotionDBTX, tenantID, id, stage string) error
	SetImmutable(ctx context.Context, db repository.PromotionDBTX, tenantID, id string, immutable bool) error
	StampPromotion(ctx context.Context, db repository.PromotionDBTX, tenantID, id, promotedBy string, promotedAt time.Time) error
	ListByLineage(ctx context.Context, db repository.PromotionDBTX, tenantID, definitionKey string) ([]*repository.PromotionRecord, error)
	CountProdActiveSiblings(ctx context.Context, db repository.PromotionDBTX, tenantID, definitionKey, excludeID string) (int, error)
}

// txRunner abstracts "run fn inside one transaction, giving it a handle that is
// both a repository.PromotionDBTX and an outbox.Querier". Production uses
// poolTxRunner (real pgx transaction); tests inject a fake that hands fn a
// recording handle so the staged outbox event is observable without a database.
type txRunner interface {
	RunInTx(ctx context.Context, fn func(db repository.PromotionDBTX) error) error
	// Pool returns a non-transactional handle for read-only paths.
	Pool() repository.PromotionDBTX
}

// poolTxRunner is the production txRunner backed by a pgx pool. Wiring it into
// the workflow-engine service container is the INTEGRATE phase's job; it is
// provided here so the promotion service is complete and usable.
type poolTxRunner struct {
	pool *pgxpool.Pool
}

// NewPoolTxRunner adapts a pgx pool to the txRunner the PromotionService needs.
func NewPoolTxRunner(pool *pgxpool.Pool) txRunner {
	return &poolTxRunner{pool: pool}
}

func (r *poolTxRunner) RunInTx(ctx context.Context, fn func(db repository.PromotionDBTX) error) error {
	return database.RunInTx(ctx, r.pool, func(tx pgx.Tx) error {
		return fn(tx)
	})
}

func (r *poolTxRunner) Pool() repository.PromotionDBTX { return r.pool }

// ErrPromotionApprovalRequired is returned when a staging→prod promotion is
// attempted without the second-actor approval the production gate requires (GAP
// C). Callers (and the HTTP handler) map it to 403/409 so the operator supplies
// an approval. It wraps ErrConflict so existing errors.Is(err, ErrConflict)
// checks continue to treat a blocked promotion as a conflict.
var ErrPromotionApprovalRequired = fmt.Errorf("staging→prod promotion requires a distinct approver: %w", ErrConflict)

// ErrProdApprovalSelf is returned when the approver of a staging→prod promotion
// is the same actor who requested/authored it — a separation-of-duties violation
// (maker ≠ checker). Wraps ErrConflict.
var ErrProdApprovalSelf = fmt.Errorf("staging→prod promotion approver must differ from the requester (separation of duties): %w", ErrConflict)

// ErrProdActiveConflict is returned when a staging→prod promotion is rejected
// because ANOTHER active version of the same lineage already occupies prod: a
// lineage may have at most ONE prod-promoted active version, which is the single
// version runtime event/lineage starts resolve to. The operator must archive (or
// otherwise retire) the incumbent prod-active version first. Wraps ErrConflict so
// existing errors.Is(err, ErrConflict) checks continue to classify it as a 409.
var ErrProdActiveConflict = fmt.Errorf("another active version of this lineage is already promoted to prod (only one prod-active version is allowed): %w", ErrConflict)

// ProdApproval carries the second-actor authorization for a staging→prod
// promotion (GAP C). It is supplied only on the approval-aware promote path; the
// legacy PromoteDefinition path leaves it nil and — unless the service is
// configured to require prod approval — promotes as before.
type ProdApproval struct {
	// ApprovedBy is the actor who authorizes the production promotion. It MUST
	// differ from the requester (promotedBy) under separation of duties.
	ApprovedBy string
	// Reason is an optional free-text justification recorded on the audit event.
	Reason string
}

// PromotionService runs the workflow-definition promotion FSM (dev→staging→prod)
// and the immutability guard. Every stage change and its
// workflow.definition.promoted outbox event commit in one transaction (DESIGN
// §3.3). The service is the single owner of the FSM ordering and immutability
// rules; the repository provides only persistence primitives.
type PromotionService struct {
	store  promotionStore
	runner txRunner
	logger zerolog.Logger

	// requireProdApproval, when true, gates every staging→prod promotion behind a
	// distinct-approver ProdApproval (GAP C: no single unapproved workflow:admin
	// transition into prod). It is OFF by default so NewPromotionService and every
	// existing test/caller behave exactly as before; the workflow-engine turns it
	// on via WithProdApprovalGate for the regulated deployment.
	requireProdApproval bool
}

// NewPromotionService constructs a PromotionService. The production-approval gate
// is OFF by default (backward compatible); enable it via WithProdApprovalGate.
func NewPromotionService(store promotionStore, runner txRunner, logger zerolog.Logger) *PromotionService {
	return &PromotionService{
		store:  store,
		runner: runner,
		logger: logger.With().Str("service", "workflow-promotion").Logger(),
	}
}

// WithProdApprovalGate enables (require=true) or disables the staging→prod
// distinct-approver gate and returns the receiver for chaining. When enabled, the
// legacy PromoteDefinition path (which carries no approval) is REJECTED for a
// staging→prod move with ErrPromotionApprovalRequired; callers must use
// PromoteDefinitionWithApproval and supply a distinct approver.
func (s *PromotionService) WithProdApprovalGate(require bool) *PromotionService {
	s.requireProdApproval = require
	return s
}

// nextStage returns the single legal successor of a stage in the promotion FSM.
// The FSM is strictly linear: dev→staging→prod, no skips, no backwards moves.
// The second return is false when the stage has no successor (prod is terminal)
// or is unknown.
func nextStage(current string) (string, bool) {
	switch current {
	case repository.StageDev:
		return repository.StageStaging, true
	case repository.StageStaging:
		return repository.StageProd, true
	default:
		return "", false
	}
}

// PromoteDefinition advances one definition version exactly one step along the
// dev→staging→prod FSM. It rejects skips (dev→prod), backwards moves
// (staging→dev), no-ops (staging→staging), and unknown target stages with
// ErrConflict. On a legal promote it, in a single transaction:
//   - sets the new stage,
//   - sets immutable=true once the version reaches staging or prod,
//   - stamps promoted_at / promoted_by,
//   - stages a workflow.definition.promoted event via outbox.Write.
//
// It returns the updated PromotionRecord. Because definitions are JSONB loaded
// at runtime, the promote takes effect with no service redeploy (FR-WORKFLOW-003
// "config release").
func (s *PromotionService) PromoteDefinition(ctx context.Context, tenantID, defID, toStage string) (*repository.PromotionRecord, error) {
	// Legacy entry point: no actor, no approval. When the prod gate is enabled a
	// staging→prod move through this path is rejected (the caller must use the
	// approval-aware method); otherwise behaviour is unchanged.
	return s.promote(ctx, tenantID, defID, toStage, "", nil)
}

// PromoteDefinitionWithApproval is the GOVERNED promote path. It records the real
// actor (promotedBy — fixing the historical empty-string promoted_by stamp) and,
// for a staging→prod move, requires a distinct-approver ProdApproval when the prod
// gate is enabled (GAP C). The approver identity and reason are recorded on the
// immutable workflow.definition.promoted audit event that the platform's
// hash-chain audit subsystem consumes off platform.workflow.events (GAP B).
func (s *PromotionService) PromoteDefinitionWithApproval(ctx context.Context, tenantID, defID, toStage, promotedBy string, approval *ProdApproval) (*repository.PromotionRecord, error) {
	return s.promote(ctx, tenantID, defID, toStage, promotedBy, approval)
}

// promote is the shared FSM/immutability/outbox body behind both public entry
// points. promotedBy is stamped on the row and event (empty on the legacy path);
// approval carries the second-actor authorization for a gated staging→prod move.
func (s *PromotionService) promote(ctx context.Context, tenantID, defID, toStage, promotedBy string, approval *ProdApproval) (*repository.PromotionRecord, error) {
	if tenantID == "" {
		return nil, fmt.Errorf("tenant id is required")
	}
	if defID == "" {
		return nil, fmt.Errorf("definition id is required")
	}
	if !repository.ValidStages[toStage] {
		return nil, fmt.Errorf("invalid target stage %q: %w", toStage, ErrConflict)
	}

	// GAP C — staging→prod approval gate. Enforced BEFORE the transaction so a
	// blocked promotion never touches the row or stages an event. Only a
	// staging→prod move is gated; dev→staging is unaffected.
	if s.requireProdApproval && toStage == repository.StageProd {
		if approval == nil || approval.ApprovedBy == "" {
			return nil, ErrPromotionApprovalRequired
		}
		// Separation of duties: the approver must differ from the requester.
		if promotedBy != "" && approval.ApprovedBy == promotedBy {
			return nil, ErrProdApprovalSelf
		}
	}

	var result *repository.PromotionRecord

	err := s.runner.RunInTx(ctx, func(db repository.PromotionDBTX) error {
		rec, err := s.store.GetByID(ctx, db, tenantID, defID)
		if err != nil {
			return fmt.Errorf("loading definition for promotion: %w", err)
		}

		// The target must be exactly the FSM successor of the current stage.
		want, ok := nextStage(rec.Stage)
		if !ok {
			return fmt.Errorf("definition %s is at terminal stage %q and cannot be promoted: %w", defID, rec.Stage, ErrConflict)
		}
		if toStage != want {
			return fmt.Errorf("illegal promotion %s→%s for definition %s (only %s→%s is allowed): %w",
				rec.Stage, toStage, defID, rec.Stage, want, ErrConflict)
		}

		// STAGE/STATUS RECONCILIATION — a lineage may have at most ONE prod-promoted
		// active version (the single version runtime event/lineage starts resolve
		// to). Cross-check BEFORE the stage change, inside this transaction, so a
		// prod promotion that would create a second prod-active sibling is rejected
		// fail-closed and the row is never mutated. Only enforced on the prod move;
		// dev→staging is unaffected (staging may legitimately coexist with prod).
		if toStage == repository.StageProd && rec.Status == model.DefinitionStatusActive {
			n, cerr := s.store.CountProdActiveSiblings(ctx, db, tenantID, rec.DefinitionKey, rec.ID)
			if cerr != nil {
				return fmt.Errorf("checking prod-active siblings: %w", cerr)
			}
			if n > 0 {
				return ErrProdActiveConflict
			}
		}

		now := time.Now().UTC()

		if err := s.store.SetStage(ctx, db, tenantID, defID, toStage); err != nil {
			return fmt.Errorf("setting stage: %w", err)
		}

		// Any stage at staging or beyond is immutable. nextStage guarantees
		// toStage is staging or prod here, so the version always becomes
		// immutable on a successful promote.
		if toStage == repository.StageStaging || toStage == repository.StageProd {
			if err := s.store.SetImmutable(ctx, db, tenantID, defID, true); err != nil {
				return fmt.Errorf("setting immutable: %w", err)
			}
		}

		// Stamp the REAL actor (was hardcoded ""). Empty only on the legacy path.
		if err := s.store.StampPromotion(ctx, db, tenantID, defID, promotedBy, now); err != nil {
			return fmt.Errorf("stamping promotion: %w", err)
		}

		// Stage the promotion event in the SAME transaction (DESIGN §3.3,
		// transactional outbox). The relay publishes it to platform.workflow.events,
		// where the platform hash-chain audit subsystem consumes it into an
		// immutable, tamper-evident audit entry (GAP B) — no separate audit system
		// is introduced here. The event carries the actor + approver so the audit
		// trail answers who promoted and who approved.
		payload := map[string]any{
			"definition_id":  rec.ID,
			"definition_key": rec.DefinitionKey,
			"name":           rec.Name,
			"version":        rec.Version,
			"from_stage":     rec.Stage,
			"to_stage":       toStage,
			"immutable":      toStage == repository.StageStaging || toStage == repository.StageProd,
			"promoted_at":    now.Format(time.RFC3339Nano),
			"promoted_by":    promotedBy,
		}
		if approval != nil {
			payload["approved_by"] = approval.ApprovedBy
			if approval.Reason != "" {
				payload["approval_reason"] = approval.Reason
			}
		}
		evt, err := events.NewEvent("workflow.definition.promoted", "workflow-engine", tenantID, payload)
		if err != nil {
			return fmt.Errorf("building promotion event: %w", err)
		}
		if err := outbox.Write(ctx, db, events.Topics.WorkflowEvents, evt); err != nil {
			return fmt.Errorf("staging promotion event: %w", err)
		}

		// Reload the canonical post-promote record so the caller sees the
		// committed stage/immutable/stamp values from one consistent read.
		updated, err := s.store.GetByID(ctx, db, tenantID, defID)
		if err != nil {
			return fmt.Errorf("reloading promoted definition: %w", err)
		}
		result = updated
		return nil
	})
	if err != nil {
		s.logger.Warn().Err(err).
			Str("tenant_id", tenantID).
			Str("definition_id", defID).
			Str("to_stage", toStage).
			Msg("promotion rejected")
		return nil, err
	}

	s.logger.Info().
		Str("tenant_id", tenantID).
		Str("definition_id", defID).
		Str("definition_key", result.DefinitionKey).
		Str("stage", result.Stage).
		Str("promoted_by", promotedBy).
		Bool("immutable", result.Immutable).
		Msg("workflow definition promoted")

	return result, nil
}

// ImmutableGuard returns ErrConflict (→409) when the definition version is
// immutable (promoted to staging or prod) and nil when it is still a mutable
// draft. The INTEGRATE phase calls this at the top of Update/Archive so editing
// a promoted version is rejected and the caller forks a new draft instead.
// A missing definition surfaces its lookup error (model.ErrNotFound), not a
// false "mutable" pass.
func (s *PromotionService) ImmutableGuard(ctx context.Context, tenantID, defID string) error {
	if tenantID == "" {
		return fmt.Errorf("tenant id is required")
	}
	if defID == "" {
		return fmt.Errorf("definition id is required")
	}

	rec, err := s.store.GetByID(ctx, s.runner.Pool(), tenantID, defID)
	if err != nil {
		return fmt.Errorf("loading definition for immutability check: %w", err)
	}
	if rec.Immutable {
		return fmt.Errorf("definition %s (version %d, stage %s) is immutable and cannot be modified: %w",
			defID, rec.Version, rec.Stage, ErrConflict)
	}
	return nil
}

// GetLineage returns every live version of a logical definition (all versions
// sharing a definition_key) within a tenant, newest version first, each with its
// stage and immutability. It powers GET /definitions/{key}/lineage.
func (s *PromotionService) GetLineage(ctx context.Context, tenantID, definitionKey string) ([]*repository.PromotionRecord, error) {
	if tenantID == "" {
		return nil, fmt.Errorf("tenant id is required")
	}
	if definitionKey == "" {
		return nil, fmt.Errorf("definition key is required")
	}

	records, err := s.store.ListByLineage(ctx, s.runner.Pool(), tenantID, definitionKey)
	if err != nil {
		return nil, fmt.Errorf("listing lineage: %w", err)
	}
	return records, nil
}

// LineageOf resolves a single definition version id to its stable lineage key,
// the convenience the handler uses to redirect /definitions/{id}/lineage to the
// keyed list. Kept here so the FSM and lineage helpers travel together.
func (s *PromotionService) LineageOf(ctx context.Context, tenantID, defID string) (string, error) {
	if tenantID == "" {
		return "", fmt.Errorf("tenant id is required")
	}
	if defID == "" {
		return "", fmt.Errorf("definition id is required")
	}
	key, err := s.store.GetLineageKey(ctx, s.runner.Pool(), tenantID, defID)
	if err != nil {
		return "", fmt.Errorf("resolving lineage key: %w", err)
	}
	return key, nil
}
