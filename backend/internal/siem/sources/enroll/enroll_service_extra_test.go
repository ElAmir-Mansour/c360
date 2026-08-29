package enroll

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/siem/sources"
)

func TestExchange_UnknownSource(t *testing.T) {
	svc, tm, _, _, _, _ := newServiceHarness(t)
	tenant := uuid.New()
	src := uuid.New()
	tok, _ := tm.Mint(context.Background(), MintParams{SourceID: src, TenantID: tenant, Purpose: sources.PurposeEnroll, TTL: time.Minute})
	_, err := svc.Exchange(context.Background(), ExchangeInput{Token: tok.JWT, CSRPEM: makeCSR(t), IP: "1.1.1.1"})
	require.ErrorIs(t, err, sources.ErrTenantMismatch)
}

func TestExchange_TokenAlreadyConsumed_DB(t *testing.T) {
	svc, tm, reader, tokRepo, _, _ := newServiceHarness(t)
	tenant := uuid.New()
	src := uuid.New()
	reader.addSource(&sources.Source{ID: src, TenantID: tenant, Status: sources.StatusProvisioning})

	tok, _ := tm.Mint(context.Background(), MintParams{SourceID: src, TenantID: tenant, Purpose: sources.PurposeEnroll, TTL: time.Minute})
	// Pre-mark the JTI consumed in the DB-stub. Now the Redis side
	// will succeed but the DB stub will fail with ErrTokenConsumed.
	jti := tok.JTI
	tokRepo.cons[jti] = true

	_, err := svc.Exchange(context.Background(), ExchangeInput{Token: tok.JWT, CSRPEM: makeCSR(t), IP: "1.1.1.1"})
	require.ErrorIs(t, err, sources.ErrTokenConsumed)
}
