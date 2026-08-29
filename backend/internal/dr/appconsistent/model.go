// Package appconsistent coordinates application-consistent recovery points for
// ClarioDR (capability #7 / DESIGN_DataStream_DR.md §5).
//
// A crash-consistent recovery point captures only the bytes that happen to be on
// disk at seal time, so in-flight application writes and dirty caches may be only
// partially present. An application-consistent point is captured after the
// protected workload has been *quiesced* (fsfreeze / VSS / DB FLUSH) so all
// in-flight writes are flushed and caches are drained.
//
// The Coordinator runs the protocol:
//
//	quiesce -> place/derive a CONSISTENCY BARRIER marker at the source
//	        -> wait for every member stream to apply through that marker
//	        -> capture/seal the recovery point tagged consistency_level=application
//	        -> thaw (ALWAYS, even on capture failure, via defer)
//
// It persists every attempt as a dr_consistency_barrier row and distinguishes an
// application-consistent result from a merely crash-consistent one.
//
// This package owns its own types, store (over repository.DBTX), router and
// providers; it does not edit the shared DR model/repository/service/handler. The
// integration phase wires the Coordinator's RecoveryPointSealer to the real DR
// service and mounts the router under the DR API.
package appconsistent

import (
	"errors"
	"time"
)

// Sentinel errors surfaced by the package and mapped to HTTP statuses by the
// router.
var (
	// ErrQuiesceFailed means the quiesce (pre-freeze) step failed; no
	// application-consistent point is produced and the workload is left
	// unfrozen (a failed quiesce never freezes the workload).
	ErrQuiesceFailed = errors.New("appconsistent: quiesce failed")
	// ErrThawFailed means the post-thaw step failed. This is serious — the
	// workload may remain frozen — but the barrier and any sealed point are
	// still recorded so an operator can intervene.
	ErrThawFailed = errors.New("appconsistent: thaw failed")
	// ErrCaptureFailed means quiesce succeeded but sealing the recovery point
	// failed. The workload is still thawed (defer) and the barrier is recorded
	// as failed with no recovery_point_id.
	ErrCaptureFailed = errors.New("appconsistent: capture failed")
	// ErrFenceFailed means quiesce succeeded but the replicated streams could
	// not be fenced/drained to the quiesced marker. No recovery point is sealed
	// with an application-consistent label in this case.
	ErrFenceFailed = errors.New("appconsistent: stream fence failed")
	// ErrNotConfigured is returned when a required dependency (sealer, store,
	// provider) is not wired.
	ErrNotConfigured = errors.New("appconsistent: dependency not configured")
	// ErrInvalidInput is returned for malformed coordinator input.
	ErrInvalidInput = errors.New("appconsistent: invalid input")
	// ErrNotFound is returned when no barrier matches a query.
	ErrNotFound = errors.New("appconsistent: barrier not found")
)

// Consistency levels recorded on dr_consistency_barrier.consistency_level and the
// produced recovery point.
const (
	// ConsistencyApplication means the workload was quiesced (in-flight writes
	// flushed, caches drained) before the point was sealed.
	ConsistencyApplication = "application"
	// ConsistencyCrash means no successful quiesce ran — only on-disk bytes were
	// captured.
	ConsistencyCrash = "crash"
)

// Provider kinds recorded on dr_consistency_barrier.provider.
const (
	// ProviderScript runs configured pre-freeze/post-thaw OS commands.
	ProviderScript = "script"
	// ProviderHTTP calls a workload-agent quiesce/thaw webhook.
	ProviderHTTP = "http"
	// ProviderNone means no quiesce provider was configured for the request.
	ProviderNone = "none"
)

// Barrier is one durable quiesce/seal/thaw attempt — the authoritative record of
// the consistency level of a produced recovery point. It maps 1:1 to a
// dr_consistency_barrier row.
type Barrier struct {
	ID              string  `json:"id"`
	TenantID        string  `json:"tenant_id"`
	GroupID         string  `json:"group_id"`
	RecoveryPointID *string `json:"recovery_point_id,omitempty"`
	// ConsistencyLevel is ConsistencyApplication only when the workload was
	// successfully quiesced before sealing; otherwise ConsistencyCrash.
	ConsistencyLevel string `json:"consistency_level"`
	// Provider is the quiesce mechanism that ran (script | http | none).
	Provider string `json:"provider"`
	// BarrierLSN is the source marker the stream fence drained to.
	BarrierLSN string `json:"barrier_lsn"`
	// Success is true only when quiesce, marker drain, seal and thaw all succeeded.
	Success bool `json:"success"`
	// Quiesced reports whether the workload was successfully frozen.
	Quiesced bool `json:"quiesced"`
	// Thawed reports whether the post-thaw step ran and reported success.
	Thawed bool `json:"thawed"`
	// Detail is a human-readable outcome summary (provider output on failure).
	Detail string `json:"detail,omitempty"`
	// Error is the failure reason when Success is false.
	Error             string     `json:"error,omitempty"`
	RequestedBy       *string    `json:"requested_by,omitempty"`
	QuiesceStartedAt  *time.Time `json:"quiesce_started_at,omitempty"`
	QuiesceFinishedAt *time.Time `json:"quiesce_finished_at,omitempty"`
	ThawStartedAt     *time.Time `json:"thaw_started_at,omitempty"`
	ThawFinishedAt    *time.Time `json:"thaw_finished_at,omitempty"`
	CreatedAt         time.Time  `json:"created_at"`
}

// IsApplicationConsistent reports whether the barrier produced an
// application-consistent point (quiesced + sealed successfully).
func (b *Barrier) IsApplicationConsistent() bool {
	return b != nil && b.Success && b.Quiesced &&
		b.ConsistencyLevel == ConsistencyApplication && b.RecoveryPointID != nil
}
