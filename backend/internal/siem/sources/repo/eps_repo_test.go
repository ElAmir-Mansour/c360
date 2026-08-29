package repo

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/siem/sources"
)

func TestEPSRepo_Insert(t *testing.T) {
	m := mustMock(t)
	r := NewEPSRepo(m)
	id := uuid.New()
	ts := time.Now().UTC()
	m.ExpectExec("INSERT INTO siem.source_eps_samples").
		WithArgs(id, ts, 100, 95, 0, 0, 5, nil).
		WillReturnResult(pgconn.NewCommandTag("INSERT 0 1"))
	require.NoError(t, r.Insert(context.Background(), sources.EPSSample{
		SourceID: id, TS: ts, EPS1Min: 100, EPS5Min: 95, QueueDepth: 5,
	}))
}

func TestEPSRepo_Latest_Empty(t *testing.T) {
	m := mustMock(t)
	r := NewEPSRepo(m)
	id := uuid.New()
	m.ExpectQuery("SELECT.*FROM siem.source_eps_samples").
		WithArgs(id, pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{"source_id", "ts", "eps_1min", "eps_5min",
			"parser_errors_1min", "dropped_1min", "queue_depth", "collector_version"}))
	got, err := r.Latest(context.Background(), id, 5*time.Minute)
	require.NoError(t, err)
	require.Nil(t, got)
}

func TestEPSRepo_Latest_Returns(t *testing.T) {
	m := mustMock(t)
	r := NewEPSRepo(m)
	id := uuid.New()
	ts := time.Now().UTC()
	m.ExpectQuery("SELECT.*FROM siem.source_eps_samples").
		WithArgs(id, pgxmock.AnyArg()).
		WillReturnRows(pgxmock.NewRows([]string{"source_id", "ts", "eps_1min", "eps_5min",
			"parser_errors_1min", "dropped_1min", "queue_depth", "collector_version"}).
			AddRow(id, ts, 100, 95, 0, 0, 5, "vector-x"))
	got, err := r.Latest(context.Background(), id, 5*time.Minute)
	require.NoError(t, err)
	require.NotNil(t, got)
	require.Equal(t, 100, got.EPS1Min)
}

func TestEPSRepo_AggregateLastHour(t *testing.T) {
	m := mustMock(t)
	r := NewEPSRepo(m)
	id := uuid.New()
	m.ExpectQuery("SELECT.*FROM siem.source_eps_samples").
		WithArgs(id).
		WillReturnRows(pgxmock.NewRows([]string{"sum_pe", "sum_dropped"}).AddRow(5, 2))
	pe, d, err := r.AggregateLastHour(context.Background(), id)
	require.NoError(t, err)
	require.Equal(t, 5, pe)
	require.Equal(t, 2, d)
}

func TestEPSRepo_Prune(t *testing.T) {
	m := mustMock(t)
	r := NewEPSRepo(m)
	cutoff := time.Now().Add(-7 * 24 * time.Hour)
	m.ExpectExec("DELETE FROM siem.source_eps_samples").
		WithArgs(cutoff).
		WillReturnResult(pgconn.NewCommandTag("DELETE 42"))
	n, err := r.PruneOlderThan(context.Background(), cutoff)
	require.NoError(t, err)
	require.Equal(t, int64(42), n)
}
