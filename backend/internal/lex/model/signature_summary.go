package model

import (
	"time"

	"github.com/google/uuid"
)

// ContractSignatureSummaryStatus is the per-contract e-signature rollup status
// shown on the contracts list workspace. It collapses the envelope FSM
// (SignatureEnvelopeStatus) plus recipient progress into the handful of states
// the list UI renders: a contract with no (or only cancelled) envelopes is
// "none"; a sent/viewed envelope with at least one signer already signed is
// "partially_signed"; a fully signed envelope is "completed".
type ContractSignatureSummaryStatus string

const (
	ContractSignatureNone            ContractSignatureSummaryStatus = "none"
	ContractSignatureDraft           ContractSignatureSummaryStatus = "draft"
	ContractSignatureSent            ContractSignatureSummaryStatus = "sent"
	ContractSignaturePartiallySigned ContractSignatureSummaryStatus = "partially_signed"
	ContractSignatureCompleted       ContractSignatureSummaryStatus = "completed"
	ContractSignatureDeclined        ContractSignatureSummaryStatus = "declined"
	ContractSignatureExpired         ContractSignatureSummaryStatus = "expired"
)

// ContractSignatureProvider widens SignatureProvider with "emdha" for the
// rollup surface. emdha (Saudi TSP) envelopes are persisted with
// provider='external' and evidence_metadata->>'provider_adapter'='emdha'
// (see service.EmdhaSignatureProviderDispatcher); the summary resolves that
// adapter back to a distinct provider value so the UI can badge emdha
// envelopes separately from generic external ones.
type ContractSignatureProvider string

const (
	ContractSignatureProviderNative   ContractSignatureProvider = "native"
	ContractSignatureProviderNafath   ContractSignatureProvider = "nafath"
	ContractSignatureProviderNajiz    ContractSignatureProvider = "najiz"
	ContractSignatureProviderEmdha    ContractSignatureProvider = "emdha"
	ContractSignatureProviderExternal ContractSignatureProvider = "external"
)

// SignatureEnvelopeRollupRow is the raw single-query rollup row produced by
// SignatureSummaryRepository.RollupByContractIDs: the latest relevant
// (non-cancelled preferred) envelope per contract plus recipient counts and
// the contract's most recent signature event. Status/provider mapping to the
// API shape happens in the service layer (pure, unit-tested).
type SignatureEnvelopeRollupRow struct {
	ContractID      uuid.UUID               `json:"contract_id"`
	EnvelopeID      uuid.UUID               `json:"envelope_id"`
	EnvelopeStatus  SignatureEnvelopeStatus `json:"envelope_status"`
	Provider        SignatureProvider       `json:"provider"`
	ProviderAdapter string                  `json:"provider_adapter"`
	SentAt          *time.Time              `json:"sent_at,omitempty"`
	PendingCount    int                     `json:"pending_count"`
	SignedCount     int                     `json:"signed_count"`
	LastEventAt     *time.Time              `json:"last_event_at,omitempty"`
}

// ContractSignatureSummary is the per-contract envelope rollup returned by
// GET /signatures/summary. Exactly one entry is returned per requested
// contract id (contracts without envelopes report envelope_status "none").
type ContractSignatureSummary struct {
	ContractID     uuid.UUID                      `json:"contract_id"`
	EnvelopeStatus ContractSignatureSummaryStatus `json:"envelope_status"`
	Provider       *ContractSignatureProvider     `json:"provider,omitempty"`
	PendingCount   int                            `json:"pending_count"`
	LastEventAt    *time.Time                     `json:"last_event_at,omitempty"`
	// Stuck flags an envelope that was sent more than 7 days ago and is still
	// awaiting signatures (rolled status sent / partially_signed).
	Stuck bool `json:"stuck"`
}
