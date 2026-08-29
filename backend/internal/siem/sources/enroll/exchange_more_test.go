package enroll

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/siem/sources"
)

func TestExchange_RotateOnWrongStatus(t *testing.T) {
	svc, tm, reader, _, _, _ := newServiceHarness(t)
	tenant := uuid.New()
	src := uuid.New()
	// Source still provisioning — rotation must reject.
	reader.addSource(&sources.Source{ID: src, TenantID: tenant, Status: sources.StatusProvisioning})

	tok, _ := tm.Mint(context.Background(), MintParams{SourceID: src, TenantID: tenant, Purpose: sources.PurposeRotate, TTL: time.Minute})
	_, err := svc.Exchange(context.Background(), ExchangeInput{Token: tok.JWT, CSRPEM: makeCSR(t), IP: "x"})
	require.ErrorIs(t, err, sources.ErrInvalidState)
}

func TestExchange_GarbageJWT(t *testing.T) {
	svc, _, _, _, _, _ := newServiceHarness(t)
	_, err := svc.Exchange(context.Background(), ExchangeInput{Token: "not.a.jwt", CSRPEM: "", IP: "x"})
	require.Error(t, err)
}
