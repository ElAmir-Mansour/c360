package enroll

import (
	"context"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/siem/sources"
)

func TestNew_OverlapDefault(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	_ = redis.NewClient(&redis.Options{Addr: mr.Addr()})
	svc := New(nil, nil, nil, nil, nil, nil, nil, 0, zerolog.Nop())
	require.NotNil(t, svc)
}

func TestMint_Defaults(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})

	mgr, _ := newTokenManager(t)
	_ = rdb

	res, err := mgr.Mint(context.Background(), MintParams{
		SourceID: uuid.New(), TenantID: uuid.New(), Purpose: sources.PurposeEnroll,
		TTL:    0,                // exercises default TTL branch
		Issuer: "", Audience: "", // exercises default iss/aud branch
	})
	require.NoError(t, err)
	require.NotEmpty(t, res.JWT)
	// 15 minutes — default TTL.
	require.WithinDuration(t, time.Now().Add(15*time.Minute), res.ExpiresAt, 5*time.Second)
}
