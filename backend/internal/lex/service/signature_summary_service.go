package service

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/lex/model"
)

const (
	// contractSignatureSummaryMaxIDs caps a single rollup request. The contracts
	// list requests rollups for the visible page (25–100 rows), so 200 leaves
	// generous headroom while bounding the ANY($2) array.
	contractSignatureSummaryMaxIDs = 200

	// signatureStuckThreshold marks an envelope as stuck: sent more than this
	// long ago and still awaiting signatures.
	signatureStuckThreshold = 7 * 24 * time.Hour
)

// signatureSummaryReader is the read seam over
// repository.SignatureSummaryRepository (interface here so the pure rollup
// mapping is unit-testable without a database).
type signatureSummaryReader interface {
	RollupByContractIDs(ctx context.Context, tenantID uuid.UUID, contractIDs []uuid.UUID) ([]model.SignatureEnvelopeRollupRow, error)
}

// SignatureSummaryService produces the per-contract envelope rollup behind
// GET /signatures/summary — the contracts-list signature column.
type SignatureSummaryService struct {
	repo   signatureSummaryReader
	logger zerolog.Logger
	now    func() time.Time
}

func NewSignatureSummaryService(repo signatureSummaryReader, logger zerolog.Logger) *SignatureSummaryService {
	return &SignatureSummaryService{
		repo:   repo,
		logger: logger.With().Str("service", "lex-signature-summary").Logger(),
		now:    time.Now,
	}
}

// Summary returns exactly one ContractSignatureSummary per distinct requested
// contract id, preserving first-occurrence request order. Contracts without a
// (non-cancelled) envelope report envelope_status "none". The whole batch is
// served by ONE repository query.
func (s *SignatureSummaryService) Summary(ctx context.Context, tenantID uuid.UUID, contractIDs []uuid.UUID) ([]model.ContractSignatureSummary, error) {
	ids := dedupeContractIDs(contractIDs)
	if len(ids) == 0 {
		return nil, validationError("contract_ids is required", map[string]string{"contract_ids": "required"})
	}
	if len(ids) > contractSignatureSummaryMaxIDs {
		return nil, validationError(
			fmt.Sprintf("contract_ids accepts at most %d ids", contractSignatureSummaryMaxIDs),
			map[string]string{"contract_ids": fmt.Sprintf("max %d", contractSignatureSummaryMaxIDs)},
		)
	}
	rows, err := s.repo.RollupByContractIDs(ctx, tenantID, ids)
	if err != nil {
		return nil, internalError("load contract signature rollup", err)
	}
	now := s.now().UTC()
	byContract := make(map[uuid.UUID]model.ContractSignatureSummary, len(rows))
	for _, row := range rows {
		byContract[row.ContractID] = mapContractSignatureRollup(row, now)
	}
	out := make([]model.ContractSignatureSummary, 0, len(ids))
	for _, id := range ids {
		if summary, ok := byContract[id]; ok {
			out = append(out, summary)
			continue
		}
		out = append(out, model.ContractSignatureSummary{
			ContractID:     id,
			EnvelopeStatus: model.ContractSignatureNone,
		})
	}
	return out, nil
}

// mapContractSignatureRollup collapses a raw rollup row into the API shape.
// Pure — all inputs explicit — so the status/provider/stuck mapping is
// directly unit-testable.
func mapContractSignatureRollup(row model.SignatureEnvelopeRollupRow, now time.Time) model.ContractSignatureSummary {
	status := rollupEnvelopeStatus(row.EnvelopeStatus, row.SignedCount)
	summary := model.ContractSignatureSummary{
		ContractID:     row.ContractID,
		EnvelopeStatus: status,
		LastEventAt:    row.LastEventAt,
	}
	if status == model.ContractSignatureNone {
		// All of the contract's envelopes are cancelled: no active signature
		// process. last_event_at is still reported (real signature history);
		// provider/pending are suppressed like the no-envelope case.
		return summary
	}
	provider := rollupSignatureProvider(row.Provider, row.ProviderAdapter)
	summary.Provider = &provider
	summary.PendingCount = row.PendingCount
	summary.Stuck = isSignatureStuck(status, row.SentAt, now)
	return summary
}

// rollupEnvelopeStatus maps the envelope FSM status onto the summary enum. A
// sent (or viewed) envelope where at least one signing party has already
// signed rolls up as partially_signed; a cancelled envelope rolls up as none
// (the repository only selects a cancelled envelope when the contract has no
// non-cancelled ones).
func rollupEnvelopeStatus(status model.SignatureEnvelopeStatus, signedCount int) model.ContractSignatureSummaryStatus {
	switch status {
	case model.SignatureEnvelopeDraft:
		return model.ContractSignatureDraft
	case model.SignatureEnvelopeSent, model.SignatureEnvelopeViewed:
		if signedCount > 0 {
			return model.ContractSignaturePartiallySigned
		}
		return model.ContractSignatureSent
	case model.SignatureEnvelopeSigned:
		return model.ContractSignatureCompleted
	case model.SignatureEnvelopeDeclined:
		return model.ContractSignatureDeclined
	case model.SignatureEnvelopeExpired:
		return model.ContractSignatureExpired
	case model.SignatureEnvelopeCancelled:
		return model.ContractSignatureNone
	default:
		return model.ContractSignatureNone
	}
}

// rollupSignatureProvider resolves the stored provider to the summary
// provider. emdha envelopes are persisted as provider='external' with
// provider_adapter 'emdha' (see EmdhaSignatureProviderDispatcher), so the
// adapter is folded back into a distinct "emdha" value.
func rollupSignatureProvider(provider model.SignatureProvider, adapter string) model.ContractSignatureProvider {
	if provider == model.SignatureProviderExternal &&
		(adapter == emdhaSignatureAdapter || strings.HasPrefix(adapter, emdhaSignatureAdapter+".")) {
		return model.ContractSignatureProviderEmdha
	}
	return model.ContractSignatureProvider(provider)
}

// isSignatureStuck reports whether an envelope still awaiting signatures
// (sent / partially_signed) was sent more than signatureStuckThreshold ago.
func isSignatureStuck(status model.ContractSignatureSummaryStatus, sentAt *time.Time, now time.Time) bool {
	if status != model.ContractSignatureSent && status != model.ContractSignaturePartiallySigned {
		return false
	}
	if sentAt == nil {
		return false
	}
	return now.Sub(*sentAt) > signatureStuckThreshold
}

// dedupeContractIDs drops uuid.Nil and duplicates while preserving
// first-occurrence order (the response order contract).
func dedupeContractIDs(ids []uuid.UUID) []uuid.UUID {
	seen := make(map[uuid.UUID]struct{}, len(ids))
	out := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		if id == uuid.Nil {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	return out
}
