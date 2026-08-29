package service

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	apperrors "github.com/clario360/platform/internal/errors"
	"github.com/clario360/platform/internal/lex/model"
)

func TestRollupEnvelopeStatusMapping(t *testing.T) {
	tests := []struct {
		name        string
		status      model.SignatureEnvelopeStatus
		signedCount int
		want        model.ContractSignatureSummaryStatus
	}{
		{"draft", model.SignatureEnvelopeDraft, 0, model.ContractSignatureDraft},
		{"sent no signatures", model.SignatureEnvelopeSent, 0, model.ContractSignatureSent},
		{"sent partially signed", model.SignatureEnvelopeSent, 1, model.ContractSignaturePartiallySigned},
		{"viewed no signatures", model.SignatureEnvelopeViewed, 0, model.ContractSignatureSent},
		{"viewed partially signed", model.SignatureEnvelopeViewed, 2, model.ContractSignaturePartiallySigned},
		{"signed", model.SignatureEnvelopeSigned, 3, model.ContractSignatureCompleted},
		{"declined", model.SignatureEnvelopeDeclined, 1, model.ContractSignatureDeclined},
		{"expired", model.SignatureEnvelopeExpired, 0, model.ContractSignatureExpired},
		{"cancelled rolls up as none", model.SignatureEnvelopeCancelled, 0, model.ContractSignatureNone},
		{"unknown rolls up as none", model.SignatureEnvelopeStatus("bogus"), 0, model.ContractSignatureNone},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := rollupEnvelopeStatus(tt.status, tt.signedCount); got != tt.want {
				t.Fatalf("rollupEnvelopeStatus(%q, %d) = %q, want %q", tt.status, tt.signedCount, got, tt.want)
			}
		})
	}
}

func TestRollupSignatureProvider(t *testing.T) {
	tests := []struct {
		name     string
		provider model.SignatureProvider
		adapter  string
		want     model.ContractSignatureProvider
	}{
		{"native passes through", model.SignatureProviderNative, "native.deterministic", model.ContractSignatureProviderNative},
		{"nafath passes through", model.SignatureProviderNafath, "", model.ContractSignatureProviderNafath},
		{"najiz passes through", model.SignatureProviderNajiz, "najiz", model.ContractSignatureProviderNajiz},
		{"external stays external", model.SignatureProviderExternal, "external.deterministic", model.ContractSignatureProviderExternal},
		{"external + emdha adapter resolves to emdha", model.SignatureProviderExternal, "emdha", model.ContractSignatureProviderEmdha},
		{"external + emdha sub-adapter resolves to emdha", model.SignatureProviderExternal, "emdha.live", model.ContractSignatureProviderEmdha},
		{"non-external ignores emdha adapter", model.SignatureProviderNative, "emdha", model.ContractSignatureProviderNative},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := rollupSignatureProvider(tt.provider, tt.adapter); got != tt.want {
				t.Fatalf("rollupSignatureProvider(%q, %q) = %q, want %q", tt.provider, tt.adapter, got, tt.want)
			}
		})
	}
}

func TestIsSignatureStuck(t *testing.T) {
	now := time.Date(2026, 7, 9, 12, 0, 0, 0, time.UTC)
	eightDaysAgo := now.Add(-8 * 24 * time.Hour)
	twoDaysAgo := now.Add(-2 * 24 * time.Hour)
	tests := []struct {
		name   string
		status model.ContractSignatureSummaryStatus
		sentAt *time.Time
		want   bool
	}{
		{"sent 8 days ago is stuck", model.ContractSignatureSent, &eightDaysAgo, true},
		{"partially signed 8 days ago is stuck", model.ContractSignaturePartiallySigned, &eightDaysAgo, true},
		{"sent 2 days ago is not stuck", model.ContractSignatureSent, &twoDaysAgo, false},
		{"completed 8 days ago is not stuck", model.ContractSignatureCompleted, &eightDaysAgo, false},
		{"declined 8 days ago is not stuck", model.ContractSignatureDeclined, &eightDaysAgo, false},
		{"sent with nil sent_at is not stuck", model.ContractSignatureSent, nil, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := isSignatureStuck(tt.status, tt.sentAt, now); got != tt.want {
				t.Fatalf("isSignatureStuck(%q, %v) = %v, want %v", tt.status, tt.sentAt, got, tt.want)
			}
		})
	}
}

func TestMapContractSignatureRollup(t *testing.T) {
	now := time.Date(2026, 7, 9, 12, 0, 0, 0, time.UTC)
	contractID := uuid.New()
	sentAt := now.Add(-9 * 24 * time.Hour)
	lastEventAt := now.Add(-time.Hour)

	summary := mapContractSignatureRollup(model.SignatureEnvelopeRollupRow{
		ContractID:      contractID,
		EnvelopeID:      uuid.New(),
		EnvelopeStatus:  model.SignatureEnvelopeSent,
		Provider:        model.SignatureProviderExternal,
		ProviderAdapter: "emdha",
		SentAt:          &sentAt,
		PendingCount:    2,
		SignedCount:     1,
		LastEventAt:     &lastEventAt,
	}, now)

	if summary.ContractID != contractID {
		t.Fatalf("ContractID = %s, want %s", summary.ContractID, contractID)
	}
	if summary.EnvelopeStatus != model.ContractSignaturePartiallySigned {
		t.Fatalf("EnvelopeStatus = %q, want partially_signed", summary.EnvelopeStatus)
	}
	if summary.Provider == nil || *summary.Provider != model.ContractSignatureProviderEmdha {
		t.Fatalf("Provider = %v, want emdha", summary.Provider)
	}
	if summary.PendingCount != 2 {
		t.Fatalf("PendingCount = %d, want 2", summary.PendingCount)
	}
	if summary.LastEventAt == nil || !summary.LastEventAt.Equal(lastEventAt) {
		t.Fatalf("LastEventAt = %v, want %v", summary.LastEventAt, lastEventAt)
	}
	if !summary.Stuck {
		t.Fatal("Stuck = false, want true (sent 9 days ago)")
	}
}

func TestMapContractSignatureRollupCancelledSuppressesProviderAndPending(t *testing.T) {
	now := time.Date(2026, 7, 9, 12, 0, 0, 0, time.UTC)
	lastEventAt := now.Add(-48 * time.Hour)
	sentAt := now.Add(-30 * 24 * time.Hour)

	summary := mapContractSignatureRollup(model.SignatureEnvelopeRollupRow{
		ContractID:      uuid.New(),
		EnvelopeID:      uuid.New(),
		EnvelopeStatus:  model.SignatureEnvelopeCancelled,
		Provider:        model.SignatureProviderNative,
		ProviderAdapter: "native.deterministic",
		SentAt:          &sentAt,
		PendingCount:    3,
		SignedCount:     1,
		LastEventAt:     &lastEventAt,
	}, now)

	if summary.EnvelopeStatus != model.ContractSignatureNone {
		t.Fatalf("EnvelopeStatus = %q, want none", summary.EnvelopeStatus)
	}
	if summary.Provider != nil {
		t.Fatalf("Provider = %v, want nil for none rollup", summary.Provider)
	}
	if summary.PendingCount != 0 {
		t.Fatalf("PendingCount = %d, want 0 for none rollup", summary.PendingCount)
	}
	if summary.Stuck {
		t.Fatal("Stuck = true, want false for none rollup")
	}
	if summary.LastEventAt == nil || !summary.LastEventAt.Equal(lastEventAt) {
		t.Fatalf("LastEventAt = %v, want %v (history preserved)", summary.LastEventAt, lastEventAt)
	}
}

type stubSignatureSummaryReader struct {
	rows       []model.SignatureEnvelopeRollupRow
	err        error
	gotIDs     []uuid.UUID
	gotTenant  uuid.UUID
	callsCount int
}

func (s *stubSignatureSummaryReader) RollupByContractIDs(_ context.Context, tenantID uuid.UUID, contractIDs []uuid.UUID) ([]model.SignatureEnvelopeRollupRow, error) {
	s.callsCount++
	s.gotTenant = tenantID
	s.gotIDs = contractIDs
	return s.rows, s.err
}

func TestSignatureSummaryServiceFillsNoneAndPreservesOrder(t *testing.T) {
	tenantID := uuid.New()
	withEnvelope := uuid.New()
	withoutEnvelope := uuid.New()
	sentAt := time.Now().UTC().Add(-time.Hour)

	reader := &stubSignatureSummaryReader{
		rows: []model.SignatureEnvelopeRollupRow{{
			ContractID:     withEnvelope,
			EnvelopeID:     uuid.New(),
			EnvelopeStatus: model.SignatureEnvelopeSent,
			Provider:       model.SignatureProviderNajiz,
			SentAt:         &sentAt,
			PendingCount:   1,
		}},
	}
	svc := NewSignatureSummaryService(reader, zerolog.Nop())

	// Duplicate + nil ids collapse; response preserves first-occurrence order.
	items, err := svc.Summary(context.Background(), tenantID, []uuid.UUID{withoutEnvelope, withEnvelope, withoutEnvelope, uuid.Nil})
	if err != nil {
		t.Fatalf("Summary() error = %v", err)
	}
	if reader.callsCount != 1 {
		t.Fatalf("repository calls = %d, want 1 (single batched query)", reader.callsCount)
	}
	if reader.gotTenant != tenantID {
		t.Fatalf("tenant = %s, want %s", reader.gotTenant, tenantID)
	}
	if len(reader.gotIDs) != 2 {
		t.Fatalf("deduped ids = %d, want 2", len(reader.gotIDs))
	}
	if len(items) != 2 {
		t.Fatalf("len(items) = %d, want 2", len(items))
	}
	if items[0].ContractID != withoutEnvelope || items[0].EnvelopeStatus != model.ContractSignatureNone {
		t.Fatalf("items[0] = %+v, want %s with status none", items[0], withoutEnvelope)
	}
	if items[0].Provider != nil || items[0].PendingCount != 0 || items[0].Stuck {
		t.Fatalf("items[0] = %+v, want empty provider/pending/stuck for none", items[0])
	}
	if items[1].ContractID != withEnvelope || items[1].EnvelopeStatus != model.ContractSignatureSent {
		t.Fatalf("items[1] = %+v, want %s with status sent", items[1], withEnvelope)
	}
	if items[1].Provider == nil || *items[1].Provider != model.ContractSignatureProviderNajiz {
		t.Fatalf("items[1].Provider = %v, want najiz", items[1].Provider)
	}
}

func TestSignatureSummaryServiceValidation(t *testing.T) {
	svc := NewSignatureSummaryService(&stubSignatureSummaryReader{}, zerolog.Nop())

	if _, err := svc.Summary(context.Background(), uuid.New(), nil); err == nil {
		t.Fatal("Summary() error = nil, want validation error for empty contract_ids")
	} else {
		var appErr *apperrors.AppError
		if !errors.As(err, &appErr) || appErr.Status != http.StatusUnprocessableEntity {
			t.Fatalf("error = %v, want 422 validation AppError", err)
		}
	}

	tooMany := make([]uuid.UUID, contractSignatureSummaryMaxIDs+1)
	for i := range tooMany {
		tooMany[i] = uuid.New()
	}
	if _, err := svc.Summary(context.Background(), uuid.New(), tooMany); err == nil {
		t.Fatalf("Summary() error = nil, want validation error above %d ids", contractSignatureSummaryMaxIDs)
	}
}

func TestSignatureSummaryServiceWrapsRepositoryError(t *testing.T) {
	svc := NewSignatureSummaryService(&stubSignatureSummaryReader{err: errors.New("boom")}, zerolog.Nop())
	if _, err := svc.Summary(context.Background(), uuid.New(), []uuid.UUID{uuid.New()}); err == nil {
		t.Fatal("Summary() error = nil, want internal error")
	}
}
