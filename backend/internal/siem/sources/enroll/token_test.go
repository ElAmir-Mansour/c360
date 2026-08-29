package enroll

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/siem/sources"
)

func newTokenManager(t *testing.T) (*TokenManager, *miniredis.Miniredis) {
	t.Helper()
	mr, err := miniredis.Run()
	require.NoError(t, err)
	t.Cleanup(func() { mr.Close() })
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})

	_, priv, err := ed25519.GenerateKey(rand.Reader)
	require.NoError(t, err)
	signer := NewEd25519Signer("test-kid", priv)
	return NewTokenManager(signer, rdb), mr
}

func TestMintAndClaim(t *testing.T) {
	mgr, _ := newTokenManager(t)

	src := uuid.New()
	tenant := uuid.New()
	res, err := mgr.Mint(context.Background(), MintParams{SourceID: src, TenantID: tenant, Purpose: sources.PurposeEnroll, TTL: time.Minute})
	require.NoError(t, err)
	require.NotEmpty(t, res.JWT)

	parsed, err := mgr.Claim(context.Background(), res.JWT, "10.0.0.1")
	require.NoError(t, err)
	require.Equal(t, src.String(), parsed.Sub)
	require.Equal(t, tenant.String(), parsed.Tnt)
}

func TestClaim_SingleUse(t *testing.T) {
	mgr, _ := newTokenManager(t)
	res, err := mgr.Mint(context.Background(), MintParams{SourceID: uuid.New(), TenantID: uuid.New(), Purpose: sources.PurposeEnroll, TTL: time.Minute})
	require.NoError(t, err)
	_, err = mgr.Claim(context.Background(), res.JWT, "1.1.1.1")
	require.NoError(t, err)
	_, err = mgr.Claim(context.Background(), res.JWT, "1.1.1.1")
	require.ErrorIs(t, err, sources.ErrTokenConsumed)
}

func TestClaim_RaceParallel(t *testing.T) {
	mgr, _ := newTokenManager(t)
	res, err := mgr.Mint(context.Background(), MintParams{SourceID: uuid.New(), TenantID: uuid.New(), Purpose: sources.PurposeEnroll, TTL: time.Minute})
	require.NoError(t, err)

	const n = 100
	var (
		ok       atomic.Int64
		consumed atomic.Int64
		other    atomic.Int64
		wg       sync.WaitGroup
		start    = make(chan struct{})
	)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := mgr.Claim(context.Background(), res.JWT, "1.1.1.1")
			switch {
			case err == nil:
				ok.Add(1)
			case isConsumed(err):
				consumed.Add(1)
			default:
				other.Add(1)
			}
		}()
	}
	close(start)
	wg.Wait()
	require.EqualValues(t, 1, ok.Load(), "exactly one Claim must succeed")
	require.EqualValues(t, n-1, consumed.Load())
	require.EqualValues(t, 0, other.Load())
}

func isConsumed(err error) bool {
	return err != nil && (err.Error() != "" && containsAll(err.Error(), "token already consumed"))
}

func containsAll(haystack string, parts ...string) bool {
	for _, p := range parts {
		if !contains(haystack, p) {
			return false
		}
	}
	return true
}

func contains(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}

func TestParse_Expired(t *testing.T) {
	mgr, _ := newTokenManager(t)
	src := uuid.New()
	tenant := uuid.New()
	// Mint with a tiny TTL, then wait it out.
	res, err := mgr.Mint(context.Background(), MintParams{SourceID: src, TenantID: tenant, Purpose: sources.PurposeEnroll, TTL: time.Second})
	require.NoError(t, err)
	time.Sleep(2100 * time.Millisecond)
	_, err = mgr.Parse(context.Background(), res.JWT)
	require.ErrorIs(t, err, sources.ErrTokenInvalid)
}

func TestParse_TamperedSignature(t *testing.T) {
	mgr, _ := newTokenManager(t)
	res, err := mgr.Mint(context.Background(), MintParams{SourceID: uuid.New(), TenantID: uuid.New(), Purpose: sources.PurposeEnroll, TTL: time.Minute})
	require.NoError(t, err)
	// Flip the last few characters of the signature segment so the
	// signature verification fails.
	tampered := res.JWT[:len(res.JWT)-5] + "XXXXX"
	_, err = mgr.Parse(context.Background(), tampered)
	require.ErrorIs(t, err, sources.ErrTokenInvalid)
}

func TestParse_Malformed(t *testing.T) {
	mgr, _ := newTokenManager(t)
	_, err := mgr.Parse(context.Background(), "not-a-jwt")
	require.ErrorIs(t, err, sources.ErrTokenInvalid)
}

func TestParse_BadKID(t *testing.T) {
	mr, _ := miniredis.Run()
	defer mr.Close()
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})

	_, priv1, _ := ed25519.GenerateKey(rand.Reader)
	_, priv2, _ := ed25519.GenerateKey(rand.Reader)
	signer1 := NewEd25519Signer("k1", priv1)
	signer2 := NewEd25519Signer("k2", priv2)

	mgr1 := NewTokenManager(signer1, rdb)
	mgr2 := NewTokenManager(signer2, rdb)

	res, err := mgr1.Mint(context.Background(), MintParams{SourceID: uuid.New(), TenantID: uuid.New(), Purpose: sources.PurposeEnroll, TTL: time.Minute})
	require.NoError(t, err)
	_, err = mgr2.Parse(context.Background(), res.JWT)
	require.ErrorIs(t, err, sources.ErrTokenInvalid)
}

func TestParse_WrongPurpose(t *testing.T) {
	mgr, _ := newTokenManager(t)
	res, err := mgr.Mint(context.Background(), MintParams{SourceID: uuid.New(), TenantID: uuid.New(), Purpose: "bogus", TTL: time.Minute})
	require.NoError(t, err)
	_, err = mgr.Parse(context.Background(), res.JWT)
	require.ErrorIs(t, err, sources.ErrTokenInvalid)
}
