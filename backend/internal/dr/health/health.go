// Package health provides clario-dr-service readiness checks. It composes the
// shared dependency probes (Postgres + Redis) and the recovery-point substrate
// probes (Vault Transit + MinIO object-lock bucket) so the admin router's
// /readyz reports the control plane's true ability to serve seal, attest, and
// failover paths (DESIGN_DataStream_DR.md §4.1 health).
package health

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	obshealth "github.com/clario360/platform/internal/observability/health"
)

// Checkers returns the readiness probes for the DR control plane: the database
// it persists every FSM transition to, and (when configured) the Redis used for
// leader election. nil dependencies are skipped, so a Redis-less local run
// still reports ready on its database alone.
func Checkers(pool *pgxpool.Pool, rdb *redis.Client) []obshealth.HealthChecker {
	var checkers []obshealth.HealthChecker
	if pool != nil {
		checkers = append(checkers, obshealth.NewPostgresHealthChecker(pool))
	}
	if rdb != nil {
		checkers = append(checkers, obshealth.NewRedisHealthChecker(rdb))
	}
	return checkers
}

// WORMBucketStore is the recovery-point store surface needed by readiness.
type WORMBucketStore interface {
	EnsureBucket(ctx context.Context) error
	Bucket() string
}

// RecoveryPointCheckers returns readiness probes for the DR recovery-point
// substrate: Vault Transit and the MinIO/S3 object-lock bucket.
func RecoveryPointCheckers(store WORMBucketStore, endpoint string, vaultChecker obshealth.HealthChecker) []obshealth.HealthChecker {
	checkers := make([]obshealth.HealthChecker, 0, 2)
	if vaultChecker != nil {
		checkers = append(checkers, vaultChecker)
	}
	if store != nil {
		checkers = append(checkers, NewWORMBucketHealthChecker(store, endpoint))
	}
	return checkers
}

// WORMBucketHealthChecker proves the DR recovery-point bucket is reachable and
// object-lock ready by running the same idempotent bucket-ensure path used
// before sealing recovery points.
type WORMBucketHealthChecker struct {
	store    WORMBucketStore
	endpoint string
}

// NewWORMBucketHealthChecker adapts a WORM recovery-point store into the
// platform health checker contract.
func NewWORMBucketHealthChecker(store WORMBucketStore, endpoint string) *WORMBucketHealthChecker {
	return &WORMBucketHealthChecker{store: store, endpoint: endpoint}
}

func (h *WORMBucketHealthChecker) Name() string { return "minio_object_lock" }

func (h *WORMBucketHealthChecker) Check(ctx context.Context) obshealth.HealthResult {
	details := map[string]interface{}{
		"bucket":   h.store.Bucket(),
		"endpoint": h.endpoint,
		"purpose":  "dr_recovery_points",
	}
	if err := h.store.EnsureBucket(ctx); err != nil {
		return obshealth.HealthResult{
			Status:  "unhealthy",
			Error:   err.Error(),
			Details: details,
		}
	}
	return obshealth.HealthResult{Status: "healthy", Details: details}
}
