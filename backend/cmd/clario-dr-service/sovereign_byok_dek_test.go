package main

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/dr/byok"
)

func TestSovereignDEKSourceReturnsCopyForBYOKZeroing(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	tenantID := uuid.New()
	raw := &fakeDEKManager{
		dek:     []byte("0123456789abcdef0123456789abcdef"),
		version: 3,
	}

	dek, err := (sovereignDEKSource{mgr: raw}).GetDEK(ctx, tenantID, "stream-a")
	require.NoError(t, err)
	require.Equal(t, raw.dek, dek)

	for i := range dek {
		dek[i] = 0
	}
	require.Equal(t, []byte("0123456789abcdef0123456789abcdef"), raw.dek,
		"BYOK zeroing its copy must not zero DEKManager's cache-owned bytes")
}

func TestSovereignWORMDEKProviderFallsBackBeforeBYOKAttach(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	tenantID := uuid.New()
	raw := &fakeDEKManager{
		dek:     []byte("rawrawrawrawrawrawrawrawrawraw12"),
		version: 4,
	}
	provider := newSovereignWORMDEKProvider(raw)

	dek, version, err := provider.Get(ctx, tenantID, "stream-a")
	require.NoError(t, err)
	require.Equal(t, raw.dek, dek)
	require.Equal(t, 4, version)
	require.Equal(t, 1, raw.calls)

	provider.ReleaseDEK(dek)
	require.Equal(t, []byte("rawrawrawrawrawrawrawrawrawraw12"), raw.dek,
		"raw DEKManager-owned bytes must not be zeroed by the WORM release hook")
}

func TestSovereignWORMDEKProviderFallsBackWhenTenantNotEnrolled(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	tenantID := uuid.New()
	raw := &fakeDEKManager{
		dek:     []byte("legacytenantlegacytenantlegacy1234"),
		version: 5,
	}
	gate := &fakeBYOKGate{wrapErr: byok.ErrNotEnrolled}
	provider := newSovereignWORMDEKProvider(raw)
	provider.AttachBYOK(gate)

	dek, version, err := provider.Get(ctx, tenantID, "stream-a")
	require.NoError(t, err)
	require.Equal(t, raw.dek, dek)
	require.Equal(t, 5, version)
	require.Equal(t, 1, gate.wrapCalls)
	require.Zero(t, gate.unwrapCalls)
	require.Equal(t, 1, raw.calls)
}

func TestSovereignWORMDEKProviderGatesEnrolledTenantThroughBYOK(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	tenantID := uuid.New()
	raw := &fakeDEKManager{
		dek:     []byte("rawrawrawrawrawrawrawrawrawraw12"),
		version: 4,
	}
	byokDEK := []byte("byokbyokbyokbyokbyokbyokbyokby12")
	gate := &fakeBYOKGate{
		wrapped: &byok.WrappedDEK{TenantID: tenantID, DEKID: "stream-a", KEKVersion: 9},
		dek:     byokDEK,
	}
	provider := newSovereignWORMDEKProvider(raw)
	provider.AttachBYOK(gate)

	dek, version, err := provider.Get(ctx, tenantID, "stream-a")
	require.NoError(t, err)
	require.Equal(t, byokDEK, dek)
	require.Equal(t, 9, version)
	require.Equal(t, 1, gate.wrapCalls)
	require.Equal(t, 1, gate.unwrapCalls)
	require.Zero(t, raw.calls, "enrolled tenants must not expose WORM to raw DEKManager.Get")

	provider.ReleaseDEK(dek)
	require.Equal(t, make([]byte, len(byokDEK)), byokDEK,
		"BYOK-unwrapped caller-owned DEK must be zeroed after WORM copies it")
}

func TestSovereignWORMDEKProviderFailsClosedOnBYOKErrors(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	tenantID := uuid.New()
	wrapErr := errors.New("custody wrap unavailable")
	unwrapErr := errors.New("custody unwrap unavailable")

	raw := &fakeDEKManager{dek: []byte("rawrawrawrawrawrawrawrawrawraw12"), version: 4}
	provider := newSovereignWORMDEKProvider(raw)
	provider.AttachBYOK(&fakeBYOKGate{wrapErr: wrapErr})
	_, _, err := provider.Get(ctx, tenantID, "stream-a")
	require.ErrorIs(t, err, wrapErr)
	require.Zero(t, raw.calls, "custody failures for enrolled tenants must not fall back to raw DEK")

	raw.calls = 0
	provider.AttachBYOK(&fakeBYOKGate{
		wrapped:   &byok.WrappedDEK{TenantID: tenantID, DEKID: "stream-a", KEKVersion: 9},
		unwrapErr: unwrapErr,
	})
	_, _, err = provider.Get(ctx, tenantID, "stream-a")
	require.ErrorIs(t, err, unwrapErr)
	require.Zero(t, raw.calls, "unwrap failures must fail closed")
}

type fakeDEKManager struct {
	dek     []byte
	version int
	calls   int
}

func (f *fakeDEKManager) Get(context.Context, uuid.UUID, string) ([]byte, int, error) {
	f.calls++
	return f.dek, f.version, nil
}

func (f *fakeDEKManager) Invalidate(uuid.UUID, string) {}

func (f *fakeDEKManager) Close() error { return nil }

type fakeBYOKGate struct {
	wrapped *byok.WrappedDEK
	dek     []byte

	wrapErr   error
	unwrapErr error

	wrapCalls   int
	unwrapCalls int
}

func (f *fakeBYOKGate) WrapDEK(_ context.Context, tenantID uuid.UUID, dekID string) (*byok.WrappedDEK, error) {
	f.wrapCalls++
	if f.wrapErr != nil {
		return nil, f.wrapErr
	}
	if f.wrapped != nil {
		return f.wrapped, nil
	}
	return &byok.WrappedDEK{TenantID: tenantID, DEKID: dekID, KEKVersion: 1}, nil
}

func (f *fakeBYOKGate) UnwrapDEK(context.Context, uuid.UUID, string) ([]byte, error) {
	f.unwrapCalls++
	if f.unwrapErr != nil {
		return nil, f.unwrapErr
	}
	return f.dek, nil
}
