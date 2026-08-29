// Package leadership is the platform-wide leader-election primitive.
//
// It exposes the Elector interface plus a Redis-backed implementation
// (NewRedisElection). Future implementations (e.g. k8s leases, etcd) can
// satisfy the same interface and be slotted in by callers without changing the
// callsite.
//
// # Behaviour
//
// A Redis Elector attempts to acquire a SET-NX lock on a namespaced key.
// While leader, the goroutine periodically extends the lock via an atomic
// Lua check-and-extend script (so a paused-then-resumed instance whose TTL
// expired in the meantime cannot accidentally re-extend a lock held by
// another instance). On loss (lock not held / network blip), OnLose fires
// exactly once and the goroutine returns to acquire mode.
//
// The lock key is "leadership:<role>". Multiple roles (e.g. "siem-detector"
// vs "siem-rotation-cleanup") can co-exist on the same Redis without
// interference.
//
// # Concurrency model
//
// Run blocks until ctx is cancelled or Close is called. It is safe to call
// IsLeader from any goroutine. Close is idempotent.
//
// # Metrics
//
// A Prometheus gauge siem_leadership_leader{role,instance} is exported via
// the package-local registry (see metrics.go). Callers wanting to attach the
// gauge to their own registry can call RegisterMetrics(reg).
package leadership
