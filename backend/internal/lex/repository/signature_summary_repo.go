package repository

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

// SignatureSummaryRepository serves the contracts-list signature rollup
// (GET /signatures/summary). It is deliberately separate from
// SignatureRepository: it owns exactly one read shape (a batched
// per-contract envelope rollup) and nothing else.
type SignatureSummaryRepository struct {
	db     *pgxpool.Pool
	logger zerolog.Logger
}

func NewSignatureSummaryRepository(db *pgxpool.Pool, logger zerolog.Logger) *SignatureSummaryRepository {
	return &SignatureSummaryRepository{db: db, logger: logger}
}

// RollupByContractIDs returns one rollup row per contract that has at least
// one non-deleted signature envelope, in a SINGLE round-trip (no N+1):
//
//   - latest: DISTINCT ON (contract_id) picks the contract's most recent
//     envelope, preferring non-cancelled ones (a cancelled envelope only wins
//     when ALL of the contract's envelopes are cancelled — the service maps
//     that to "none").
//   - recipient_rollup: pending/signed counts over the selected envelope's
//     signing parties (signer + approver; carbon_copy never blocks).
//   - event_rollup: the most recent signature_events.occurred_at across ALL
//     of the contract's envelopes (last signature activity).
//
// Contracts with no envelopes simply produce no row; the service fills in
// envelope_status "none" so callers still get one entry per requested id.
func (r *SignatureSummaryRepository) RollupByContractIDs(ctx context.Context, tenantID uuid.UUID, contractIDs []uuid.UUID) ([]model.SignatureEnvelopeRollupRow, error) {
	if len(contractIDs) == 0 {
		return []model.SignatureEnvelopeRollupRow{}, nil
	}
	query := `
		WITH latest AS (
			SELECT DISTINCT ON (e.contract_id)
			       e.contract_id,
			       e.id AS envelope_id,
			       e.status,
			       e.provider,
			       COALESCE(e.evidence_metadata->>'provider_adapter', '') AS provider_adapter,
			       e.sent_at
			FROM signature_envelopes e
			WHERE e.tenant_id = $1
			  AND e.contract_id = ANY($2)
			  AND e.deleted_at IS NULL
			ORDER BY e.contract_id, (e.status = 'cancelled') ASC, e.created_at DESC, e.id DESC
		),
		recipient_rollup AS (
			SELECT l.contract_id,
			       COUNT(*) FILTER (
			       	WHERE sr.role IN ('signer','approver')
			       	  AND sr.status IN ('draft','sent','viewed')
			       ) AS pending_count,
			       COUNT(*) FILTER (
			       	WHERE sr.role IN ('signer','approver')
			       	  AND sr.status = 'signed'
			       ) AS signed_count
			FROM latest l
			JOIN signature_recipients sr
			  ON sr.tenant_id = $1 AND sr.envelope_id = l.envelope_id
			GROUP BY l.contract_id
		),
		event_rollup AS (
			SELECT e.contract_id,
			       MAX(se.occurred_at) AS last_event_at
			FROM signature_envelopes e
			JOIN signature_events se
			  ON se.tenant_id = e.tenant_id AND se.envelope_id = e.id
			WHERE e.tenant_id = $1
			  AND e.contract_id = ANY($2)
			  AND e.deleted_at IS NULL
			GROUP BY e.contract_id
		)
		SELECT row_to_json(t)
		FROM (
			SELECT l.contract_id,
			       l.envelope_id,
			       l.status AS envelope_status,
			       l.provider,
			       l.provider_adapter,
			       l.sent_at,
			       COALESCE(rr.pending_count, 0)::int AS pending_count,
			       COALESCE(rr.signed_count, 0)::int AS signed_count,
			       er.last_event_at
			FROM latest l
			LEFT JOIN recipient_rollup rr ON rr.contract_id = l.contract_id
			LEFT JOIN event_rollup er ON er.contract_id = l.contract_id
		) t`
	return queryListJSON[model.SignatureEnvelopeRollupRow](ctx, r.db, query, tenantID, contractIDs)
}
