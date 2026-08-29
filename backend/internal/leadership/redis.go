package leadership

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
)

// Elector is the platform abstraction for leader election. Multiple
// implementations may follow (k8s leases, etcd, etc.).
type Elector interface {
	// Run blocks attempting to acquire and hold the leadership lock until ctx
	// is cancelled. OnAcquire fires once each time leadership is acquired;
	// OnLose fires once each time leadership is lost (network blip, TTL
	// expiry, voluntary release).
	Run(ctx context.Context, opts RunOpts) error

	// IsLeader returns the current leadership state. Safe for concurrent use.
	IsLeader() bool

	// Close releases the lock if held. Idempotent.
	Close(ctx context.Context) error
}

// RunOpts is the callback bundle for Run.
type RunOpts struct {
	OnAcquire func(ctx context.Context)
	OnLose    func()
}

// Sentinel errors.
var (
	ErrInvalidConfig = errors.New("leadership: invalid configuration")
)

// extendScript is an atomic check-and-extend: only extend the lock if the
// value still matches our instance ID. This prevents a paused instance whose
// TTL expired in the meantime from accidentally re-extending a lock now held
// by a different instance.
//
//	if get == instanceID -> pexpire ttl_ms, return 1
//	else                  -> return 0
const extendScript = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("PEXPIRE", KEYS[1], ARGV[2])
else
  return 0
end
`

// releaseScript atomically deletes the lock if and only if we still hold it.
const releaseScript = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`

// RedisElection is the Redis-backed Elector.
type RedisElection struct {
	rdb        *redis.Client
	role       string
	instance   string
	key        string
	ttl        time.Duration
	renewEvery time.Duration
	logger     zerolog.Logger
	isLeader   atomic.Bool
	closed     atomic.Bool
	mu         sync.Mutex // serialises Close
}

// NewRedisElection creates a Redis-backed Elector for the given role.
//
// Lock key is "leadership:<role>". ttl is the lock TTL; renewInterval should
// be ttl/3 or smaller. instanceID is a unique-per-replica identifier (pod
// name, hostname+pid, etc).
//
// If any argument is invalid, the constructor still returns a usable Elector
// — Run will fail with ErrInvalidConfig at the first call so problems surface
// at the running site (consistent with the platform's defer-validation
// pattern).
func NewRedisElection(rdb *redis.Client, role, instanceID string, ttl, renewInterval time.Duration, logger *zerolog.Logger) Elector {
	var lg zerolog.Logger
	if logger != nil {
		lg = logger.With().Str("component", "leadership").Str("role", role).Logger()
	} else {
		lg = zerolog.Nop()
	}
	return &RedisElection{
		rdb:        rdb,
		role:       role,
		instance:   instanceID,
		key:        "leadership:" + role,
		ttl:        ttl,
		renewEvery: renewInterval,
		logger:     lg,
	}
}

// validate checks the configuration. Called at Run-time.
func (r *RedisElection) validate() error {
	if r.rdb == nil {
		return fmt.Errorf("%w: redis client is nil", ErrInvalidConfig)
	}
	if r.role == "" {
		return fmt.Errorf("%w: role is required", ErrInvalidConfig)
	}
	if r.instance == "" {
		return fmt.Errorf("%w: instance ID is required", ErrInvalidConfig)
	}
	if r.ttl <= 0 {
		return fmt.Errorf("%w: ttl must be positive", ErrInvalidConfig)
	}
	if r.renewEvery <= 0 || r.renewEvery >= r.ttl {
		return fmt.Errorf("%w: renew interval must be > 0 and < ttl", ErrInvalidConfig)
	}
	return nil
}

// IsLeader returns the current leadership state.
func (r *RedisElection) IsLeader() bool {
	return r.isLeader.Load()
}

// Run is the main election loop.
func (r *RedisElection) Run(ctx context.Context, opts RunOpts) error {
	if err := r.validate(); err != nil {
		return err
	}
	// Acquisition retry cadence — same as renew interval (avoids tight loop).
	acquireEvery := r.renewEvery
	acquireTimer := time.NewTimer(0) // fire immediately on first iter
	defer acquireTimer.Stop()

	renewTimer := time.NewTimer(r.renewEvery)
	defer renewTimer.Stop()
	renewTimer.Stop() // not running until we acquire

	setLeader(r.role, r.instance, false)

	for {
		select {
		case <-ctx.Done():
			r.releaseIfHeld(context.Background())
			return ctx.Err()

		case <-acquireTimer.C:
			if r.closed.Load() {
				return nil
			}
			if r.isLeader.Load() {
				// Defensive: shouldn't fire while we hold leadership.
				acquireTimer.Reset(acquireEvery)
				continue
			}
			ok, err := r.tryAcquire(ctx)
			if err != nil {
				r.logger.Debug().Err(err).Msg("acquire attempt failed")
			}
			if ok {
				r.isLeader.Store(true)
				setLeader(r.role, r.instance, true)
				r.logger.Info().Str("instance", r.instance).Msg("leadership acquired")
				if opts.OnAcquire != nil {
					opts.OnAcquire(ctx)
				}
				renewTimer.Reset(r.renewEvery)
			} else {
				acquireTimer.Reset(acquireEvery)
			}

		case <-renewTimer.C:
			if r.closed.Load() {
				return nil
			}
			extended, err := r.tryExtend(ctx)
			if err != nil || !extended {
				// Lost it. Fall back to acquire mode.
				r.isLeader.Store(false)
				setLeader(r.role, r.instance, false)
				r.logger.Warn().Err(err).Msg("leadership lost")
				if opts.OnLose != nil {
					opts.OnLose()
				}
				acquireTimer.Reset(acquireEvery)
			} else {
				renewTimer.Reset(r.renewEvery)
			}
		}
	}
}

// tryAcquire attempts SET NX PX <ttl>.
func (r *RedisElection) tryAcquire(ctx context.Context) (bool, error) {
	ok, err := r.rdb.SetNX(ctx, r.key, r.instance, r.ttl).Result()
	if err != nil {
		return false, fmt.Errorf("leadership: setnx: %w", err)
	}
	return ok, nil
}

// tryExtend atomically extends the lock if we still hold it.
func (r *RedisElection) tryExtend(ctx context.Context) (bool, error) {
	ttlMillis := int64(r.ttl / time.Millisecond)
	if ttlMillis <= 0 {
		ttlMillis = 1
	}
	res, err := r.rdb.Eval(ctx, extendScript, []string{r.key}, r.instance, ttlMillis).Result()
	if err != nil {
		return false, fmt.Errorf("leadership: extend: %w", err)
	}
	n, _ := res.(int64)
	return n == 1, nil
}

// releaseIfHeld atomically deletes the lock if we still hold it.
func (r *RedisElection) releaseIfHeld(ctx context.Context) {
	if !r.isLeader.Load() {
		return
	}
	_, err := r.rdb.Eval(ctx, releaseScript, []string{r.key}, r.instance).Result()
	if err != nil {
		r.logger.Debug().Err(err).Msg("release failed")
	}
	r.isLeader.Store(false)
	setLeader(r.role, r.instance, false)
}

// Close releases the lock if held. Idempotent.
func (r *RedisElection) Close(ctx context.Context) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed.Swap(true) {
		return nil
	}
	r.releaseIfHeld(ctx)
	return nil
}
