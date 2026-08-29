package repository

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// PgxDB is the subset of *pgxpool.Pool that the delivery repository uses for
// query execution. Both *pgxpool.Pool (production) and pgxmock.PgxPoolIface
// (tests) satisfy it, so the repository can be unit-tested against a mock while
// production passes a real pool unchanged. The constructors still accept a
// *pgxpool.Pool, so no call site changes.
//
// The tenant-scoped write path in DeliveryRepository.Insert still requires a
// concrete *pgxpool.Pool (database.RunWithTenant opens a real transaction); it
// type-asserts back to the concrete pool so production behaviour is identical
// and only the mock falls through to the direct-exec path.
type PgxDB interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}
