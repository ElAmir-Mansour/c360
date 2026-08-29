package crypto

import (
	"container/list"
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
)

// DEKManager owns the lifecycle of per-(tenant, index) Data Encryption Keys.
// It is safe for concurrent use.
type DEKManager interface {
	// Get returns the DEK for (tenant, indexName), generating + persisting
	// it on first use. The returned slice is owned by the manager — callers
	// MUST NOT mutate or zero it; the manager zeroes the bytes on eviction.
	Get(ctx context.Context, tenantID uuid.UUID, indexName string) (dek []byte, kekVersion int, err error)
	// Invalidate forgets the DEK for (tenant, indexName) but does not delete
	// the envelope from persistence. Useful for tests.
	Invalidate(tenantID uuid.UUID, indexName string)
	// Close zeroes every cached DEK.
	Close() error
}

// DEKManagerConfig tunes the cache.
type DEKManagerConfig struct {
	// TTL is the time-to-live for cache entries. Defaults to 30 minutes.
	TTL time.Duration
	// MaxEntries is the maximum number of cached DEKs. Defaults to 1024.
	MaxEntries int
	// TransitKeyForTenant returns the Vault transit key name for a tenant.
	// Defaults to "siem-tenant-{tenantID}".
	TransitKeyForTenant func(tenantID uuid.UUID) string
}

// DEKManagerDeps are the runtime dependencies. The DB pool is used for DEK
// envelope persistence in siem.index_metadata.
type DEKManagerDeps struct {
	Pool    *pgxpool.Pool
	Transit Transit
	PII     PIIRegistry
	Reg     prometheus.Registerer
}

// dekCacheEntry is a heap of bytes plus its TTL deadline.
type dekCacheEntry struct {
	key        cacheKey
	plaintext  []byte
	kekVersion int
	expires    time.Time
	// elem is the LRU list element so we can move-to-front on access without
	// a separate index.
	elem *list.Element
}

type cacheKey struct {
	tenant string
	index  string
}

type dekManager struct {
	cfg     DEKManagerConfig
	deps    DEKManagerDeps
	mu      sync.Mutex
	entries map[cacheKey]*dekCacheEntry
	order   *list.List // LRU; front = most recently used
	now     func() time.Time

	cacheHits   prometheus.Counter
	cacheMiss   prometheus.Counter
	cacheEvict  prometheus.Counter
	cacheSize   prometheus.Gauge
	generations prometheus.Counter
	decryptOps  prometheus.Counter
}

// NewDEKManager builds a DEKManager with the supplied deps and applies cfg
// defaults. Returns an error only if a required dependency is missing.
func NewDEKManager(cfg DEKManagerConfig, deps DEKManagerDeps) (DEKManager, error) {
	if deps.Transit == nil {
		return nil, fmt.Errorf("crypto: DEKManager requires Transit")
	}
	if cfg.TTL <= 0 {
		cfg.TTL = 30 * time.Minute
	}
	if cfg.MaxEntries <= 0 {
		cfg.MaxEntries = 1024
	}
	if cfg.TransitKeyForTenant == nil {
		cfg.TransitKeyForTenant = func(t uuid.UUID) string {
			return "siem-tenant-" + t.String()
		}
	}
	m := &dekManager{
		cfg:     cfg,
		deps:    deps,
		entries: make(map[cacheKey]*dekCacheEntry),
		order:   list.New(),
		now:     time.Now,
	}
	m.cacheHits = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "siem_dek_cache_hits_total",
		Help: "Number of DEK cache hits.",
	})
	m.cacheMiss = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "siem_dek_cache_miss_total",
		Help: "Number of DEK cache misses (fetched from DB or generated).",
	})
	m.cacheEvict = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "siem_dek_cache_evict_total",
		Help: "Number of DEK cache evictions (LRU or TTL).",
	})
	m.cacheSize = prometheus.NewGauge(prometheus.GaugeOpts{
		Name: "siem_dek_cache_size",
		Help: "Current number of cached DEKs.",
	})
	m.generations = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "siem_dek_generations_total",
		Help: "Number of times a fresh DEK was generated against Vault.",
	})
	m.decryptOps = prometheus.NewCounter(prometheus.CounterOpts{
		Name: "siem_dek_decrypts_total",
		Help: "Number of DEK envelope unwrap operations.",
	})
	if deps.Reg != nil {
		deps.Reg.MustRegister(m.cacheHits, m.cacheMiss, m.cacheEvict, m.cacheSize, m.generations, m.decryptOps)
	}
	return m, nil
}

func (m *dekManager) Get(ctx context.Context, tenantID uuid.UUID, indexName string) ([]byte, int, error) {
	if indexName == "" {
		return nil, 0, fmt.Errorf("crypto: indexName required")
	}
	k := cacheKey{tenant: tenantID.String(), index: indexName}

	// Fast path: cache hit.
	if dek, ver, ok := m.cacheGet(k); ok {
		m.cacheHits.Inc()
		return dek, ver, nil
	}
	m.cacheMiss.Inc()

	keyName := m.cfg.TransitKeyForTenant(tenantID)

	// Slow path: load envelope from persistence (if any), or generate a new
	// DEK and persist it.
	envelope, kekVer, found, err := m.loadEnvelope(ctx, tenantID, indexName)
	if err != nil {
		return nil, 0, fmt.Errorf("%w: load envelope: %v", ErrDEKUnavailable, err)
	}

	var plaintext []byte
	if found {
		pt, decErr := m.deps.Transit.Decrypt(ctx, keyName, envelope)
		if decErr != nil {
			return nil, 0, decErr
		}
		plaintext = pt
		m.decryptOps.Inc()
	} else {
		if err := m.deps.Transit.EnsureKey(ctx, keyName); err != nil {
			if errors.Is(err, ErrDEKUnavailable) {
				return nil, 0, err
			}
			return nil, 0, fmt.Errorf("%w: ensure key: %v", ErrDEKUnavailable, err)
		}
		pt, env, ver, genErr := m.deps.Transit.Generate(ctx, keyName)
		if genErr != nil {
			if errors.Is(genErr, ErrDEKUnavailable) {
				return nil, 0, genErr
			}
			return nil, 0, fmt.Errorf("%w: generate: %v", ErrDEKUnavailable, genErr)
		}
		// Persist envelope. On failure, we zero the plaintext and refuse to
		// proceed — caller must NOT index without persistence.
		piiHash := ""
		if m.deps.PII != nil {
			piiHash = m.deps.PII.SchemaHash()
		}
		if err := m.persistEnvelope(ctx, tenantID, indexName, env, ver, piiHash); err != nil {
			zeroBytes(pt)
			return nil, 0, fmt.Errorf("%w: persist envelope: %v", ErrDEKUnavailable, err)
		}
		plaintext = pt
		kekVer = ver
		m.generations.Inc()
	}

	m.cachePut(k, plaintext, kekVer)
	return plaintext, kekVer, nil
}

func (m *dekManager) Invalidate(tenantID uuid.UUID, indexName string) {
	k := cacheKey{tenant: tenantID.String(), index: indexName}
	m.mu.Lock()
	defer m.mu.Unlock()
	if e, ok := m.entries[k]; ok {
		zeroBytes(e.plaintext)
		m.order.Remove(e.elem)
		delete(m.entries, k)
		m.cacheSize.Set(float64(len(m.entries)))
	}
}

func (m *dekManager) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for k, e := range m.entries {
		zeroBytes(e.plaintext)
		delete(m.entries, k)
	}
	m.order.Init()
	m.cacheSize.Set(0)
	return nil
}

// cacheGet returns (dek, ver, true) on hit. Honors TTL.
func (m *dekManager) cacheGet(k cacheKey) ([]byte, int, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.entries[k]
	if !ok {
		return nil, 0, false
	}
	if m.now().After(e.expires) {
		// expired
		zeroBytes(e.plaintext)
		m.order.Remove(e.elem)
		delete(m.entries, k)
		m.cacheEvict.Inc()
		m.cacheSize.Set(float64(len(m.entries)))
		return nil, 0, false
	}
	m.order.MoveToFront(e.elem)
	return e.plaintext, e.kekVersion, true
}

func (m *dekManager) cachePut(k cacheKey, dek []byte, kekVer int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if e, ok := m.entries[k]; ok {
		// Update in place; zero the prior bytes to avoid double-cached
		// secrets in memory.
		zeroBytes(e.plaintext)
		e.plaintext = dek
		e.kekVersion = kekVer
		e.expires = m.now().Add(m.cfg.TTL)
		m.order.MoveToFront(e.elem)
		return
	}
	// Evict if at capacity.
	for len(m.entries) >= m.cfg.MaxEntries {
		back := m.order.Back()
		if back == nil {
			break
		}
		evicted := back.Value.(*dekCacheEntry)
		zeroBytes(evicted.plaintext)
		m.order.Remove(back)
		delete(m.entries, evicted.key)
		m.cacheEvict.Inc()
	}
	entry := &dekCacheEntry{
		key:        k,
		plaintext:  dek,
		kekVersion: kekVer,
		expires:    m.now().Add(m.cfg.TTL),
	}
	entry.elem = m.order.PushFront(entry)
	m.entries[k] = entry
	m.cacheSize.Set(float64(len(m.entries)))
}

// loadEnvelope queries siem.index_metadata for an existing envelope.
func (m *dekManager) loadEnvelope(ctx context.Context, tenantID uuid.UUID, indexName string) ([]byte, int, bool, error) {
	if m.deps.Pool == nil {
		return nil, 0, false, nil
	}
	var envelope []byte
	var ver int
	err := m.deps.Pool.QueryRow(ctx, `
        SELECT dek_envelope, dek_kek_version
        FROM siem.index_metadata
        WHERE index_name = $1 AND tenant_id = $2
    `, indexName, tenantID).Scan(&envelope, &ver)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, 0, false, nil
		}
		return nil, 0, false, err
	}
	return envelope, ver, true, nil
}

// persistEnvelope upserts a row into siem.index_metadata. Schema version,
// template_hash, and pii_schema_hash are populated by the caller.
func (m *dekManager) persistEnvelope(ctx context.Context, tenantID uuid.UUID, indexName string, envelope []byte, kekVersion int, piiHash string) error {
	if m.deps.Pool == nil {
		// In-memory only mode (tests with no DB). Silently accept.
		return nil
	}
	if piiHash == "" {
		piiHash = "unknown"
	}
	_, err := m.deps.Pool.Exec(ctx, `
        INSERT INTO siem.index_metadata (
            index_name, tenant_id, schema_version, template_hash,
            dek_envelope, dek_kek_version, pii_schema_hash, lifecycle_state
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'hot')
        ON CONFLICT (index_name) DO UPDATE
        SET dek_envelope    = EXCLUDED.dek_envelope,
            dek_kek_version = EXCLUDED.dek_kek_version,
            pii_schema_hash = EXCLUDED.pii_schema_hash
    `, indexName, tenantID, "ecs-8.11+clario-1.0", "pending", envelope, kekVersion, piiHash)
	return err
}

// zeroBytes overwrites b with zeros. The explicit loop prevents the
// compiler from eliding the write under dead-store analysis.
func zeroBytes(b []byte) {
	for i := range b {
		b[i] = 0
	}
}
