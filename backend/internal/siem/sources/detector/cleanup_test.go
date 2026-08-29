package detector

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pashagolub/pgxmock/v4"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/siem/sources/repo"
)

func TestCleanupJob_PrunesAndStopsOnCancel(t *testing.T) {
	mock, err := pgxmock.NewPool()
	require.NoError(t, err)
	defer mock.Close()

	mock.ExpectExec("DELETE FROM siem.source_eps_samples").
		WithArgs(pgxmock.AnyArg()).
		WillReturnResult(pgconn.NewCommandTag("DELETE 7"))

	job := NewCleanupJob(repo.NewEPSRepo(mock), time.Hour, 1*time.Millisecond, zerolog.Nop())
	ctx, cancel := context.WithCancel(context.Background())
	go func() { _ = job.Start(ctx) }()
	time.Sleep(20 * time.Millisecond)
	cancel()
}
