package repo

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/siem/sources"
)

// TestNilDB exercises the "nil pool" guard in every repo method so
// the safety branches contribute to coverage.
func TestNilDB(t *testing.T) {
	ctx := context.Background()

	s := NewSourcesRepo(nil)
	_, err := s.Insert(ctx, sources.OnboardInput{})
	require.Error(t, err)
	_, err = s.GetByID(ctx, uuid.Nil, uuid.Nil)
	require.Error(t, err)
	_, err = s.GetByName(ctx, uuid.Nil, "x")
	require.Error(t, err)
	_, err = s.GetByThumbprint(ctx, "x")
	require.Error(t, err)
	_, err = s.Update(ctx, uuid.Nil, uuid.Nil, sources.UpdateInput{}, 1)
	require.Error(t, err)
	_, err = s.SetStatus(ctx, uuid.Nil, uuid.Nil, sources.StatusActive, 1)
	require.Error(t, err)
	require.Error(t, s.SetStatusUnchecked(ctx, uuid.Nil, sources.StatusActive))
	require.Error(t, s.SoftDelete(ctx, uuid.Nil, uuid.Nil, 1))
	_, err = s.AttachCert(ctx, uuid.Nil, uuid.Nil, "", "", time.Now(), time.Now(), sources.StatusActive)
	require.Error(t, err)
	require.Error(t, s.MarkCertRevoked(ctx, uuid.Nil, "x"))
	require.Error(t, s.UpdateBaseline(ctx, uuid.Nil, 0, 0))
	require.Error(t, s.TouchLastSeen(ctx, uuid.Nil, time.Now()))
	_, err = s.List(ctx, uuid.Nil, sources.ListQuery{})
	require.Error(t, err)
	_, err = s.ListActive(ctx)
	require.Error(t, err)
	require.Error(t, s.InsertCredentials(ctx, sources.SourceCredentials{}))
	_, err = s.GetCredentials(ctx, uuid.Nil)
	require.Error(t, err)
	_, err = s.CountByTenantStatus(ctx)
	require.Error(t, err)

	e := NewEPSRepo(nil)
	require.Error(t, e.Insert(ctx, sources.EPSSample{}))
	_, err = e.Latest(ctx, uuid.Nil, time.Second)
	require.Error(t, err)
	_, _, err = e.AggregateLastHour(ctx, uuid.Nil)
	require.Error(t, err)
	_, err = e.PruneOlderThan(ctx, time.Now())
	require.Error(t, err)

	tk := NewEnrollmentTokensRepo(nil)
	require.Error(t, tk.Insert(ctx, sources.EnrollmentTokenRecord{}))
	_, err = tk.MarkConsumed(ctx, uuid.Nil, "", time.Now())
	require.Error(t, err)
	_, err = tk.Get(ctx, uuid.Nil)
	require.Error(t, err)

	rv := NewRevocationRepo(nil)
	require.Error(t, rv.Insert(ctx, sources.Revocation{}))
	_, err = rv.Get(ctx, "x")
	require.Error(t, err)
	_, err = rv.ListSince(ctx, time.Time{})
	require.Error(t, err)
	_, err = rv.CountForSource(ctx, uuid.Nil)
	require.Error(t, err)
	_, err = rv.All(ctx)
	require.Error(t, err)
}
