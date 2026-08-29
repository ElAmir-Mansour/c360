package store

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/observability/health"
	"github.com/clario360/platform/internal/siem/store/crypto"
	storeminio "github.com/clario360/platform/internal/siem/store/minio"
	storeos "github.com/clario360/platform/internal/siem/store/opensearch"
	"github.com/clario360/platform/internal/vault"
)

// Dependencies bundles the platform-provided dependencies needed to build
// a Store. All fields are required unless the doc string says otherwise.
type Dependencies struct {
	DB         *pgxpool.Pool         // for DEK envelope persistence (may be nil in tests)
	Logger     *zerolog.Logger       // structured logger
	Registerer prometheus.Registerer // per-instance metrics registry
	Vault      vault.Client          // adapter target for crypto/transit
}

// Store composes the three subpackage clients and the Vault adapter.
type Store struct {
	OS     storeos.Client
	Object storeminio.Client
	Crypto crypto.FieldCrypto
	DEK    crypto.DEKManager
	PII    crypto.PIIRegistry
	Vault  vault.Client

	deps Dependencies
	cfg  Config
	m    *Metrics
}

// SelfTestResult is returned from Store.SelfTest.
type SelfTestResult struct {
	OpenSearch string `json:"opensearch"`
	MinIO      string `json:"minio"`
	Vault      string `json:"vault"`
	ObjectLock string `json:"object_lock"`
}

// New constructs a Store from deps and opts. Either WithConfig(...) must
// supply a Config or callers must inject every subcomponent via the With*
// options.
func New(ctx context.Context, deps Dependencies, opts ...Option) (*Store, error) {
	s := &Store{deps: deps, Vault: deps.Vault}
	for _, opt := range opts {
		opt(s)
	}
	if deps.Logger == nil {
		return nil, fmt.Errorf("store: Logger required")
	}
	s.m = NewMetrics(deps.Registerer)

	// Build PII registry first; the schema hash is a Prometheus gauge label.
	if s.PII == nil {
		pii, err := crypto.NewPIIRegistry()
		if err != nil {
			return nil, fmt.Errorf("store: load pii registry: %w", err)
		}
		s.PII = pii
	}
	if s.m != nil && s.PII != nil {
		s.m.PIISchemaHash.WithLabelValues(s.PII.SchemaHash()).Set(1)
	}

	if s.DEK == nil {
		dek, err := crypto.NewDEKManager(s.cfg.DEK, crypto.DEKManagerDeps{
			Pool:    deps.DB,
			Transit: crypto.NewTransit(deps.Vault),
			PII:     s.PII,
			Reg:     deps.Registerer,
		})
		if err != nil {
			return nil, fmt.Errorf("store: build DEK manager: %w", err)
		}
		s.DEK = dek
	}
	if s.Crypto == nil {
		fc, err := crypto.NewFieldCrypto(crypto.FieldCryptoDeps{
			DEK: s.DEK,
			PII: s.PII,
			Reg: deps.Registerer,
		})
		if err != nil {
			return nil, fmt.Errorf("store: build field crypto: %w", err)
		}
		s.Crypto = fc
	}
	if s.OS == nil {
		osCli, err := storeos.NewClient(ctx, s.cfg.OpenSearch, deps.Logger, deps.Registerer)
		if err != nil {
			return nil, fmt.Errorf("store: build opensearch client: %w", err)
		}
		s.OS = osCli
	}
	if s.Object == nil {
		mc, err := storeminio.NewClient(ctx, s.cfg.MinIO, deps.Logger, deps.Registerer)
		if err != nil {
			return nil, fmt.Errorf("store: build minio client: %w", err)
		}
		s.Object = mc
	}

	return s, nil
}

// Close releases resources held by all subclients.
func (s *Store) Close() error {
	var errs []error
	if s.OS != nil {
		if err := s.OS.Close(); err != nil {
			errs = append(errs, err)
		}
	}
	if s.Object != nil {
		if err := s.Object.Close(); err != nil {
			errs = append(errs, err)
		}
	}
	if s.DEK != nil {
		if err := s.DEK.Close(); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// HealthCheckers returns the platform-style health checkers for the three
// subsystems. Callers register them with svc.Health.AddCheckers(...).
func (s *Store) HealthCheckers() []health.HealthChecker {
	out := make([]health.HealthChecker, 0, 3)
	if s.OS != nil {
		out = append(out, s.OS.HealthChecker())
	}
	if s.Object != nil {
		out = append(out, s.Object.HealthChecker())
	}
	return out
}

// SelfTest runs the SIEM-02 admin self-test sequence and reports each
// component's outcome. SelfTest is intended for the dev-only
// /_meta/self-test endpoint; in prod, the endpoint returns 404.
func (s *Store) SelfTest(ctx context.Context) (SelfTestResult, error) {
	timeout := s.cfg.SelfTestTimeout
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	res := SelfTestResult{}

	if _, err := s.OS.ClusterHealth(ctx); err != nil {
		s.recordSelfTest("fail")
		return res, fmt.Errorf("%w: opensearch: %v", ErrSelfTestFailed, err)
	}
	res.OpenSearch = "ok"

	if err := s.Object.BucketHealthy(ctx); err != nil {
		s.recordSelfTest("fail")
		return res, fmt.Errorf("%w: minio: %v", ErrSelfTestFailed, err)
	}
	res.MinIO = "ok"

	if err := s.Vault.Health(ctx); err != nil {
		s.recordSelfTest("fail")
		return res, fmt.Errorf("%w: vault: %v", ErrSelfTestFailed, err)
	}
	res.Vault = "ok"

	if err := s.Object.WORMSelfTest(ctx); err != nil {
		s.recordSelfTest("fail")
		return res, fmt.Errorf("%w: object_lock: %v", ErrSelfTestFailed, err)
	}
	res.ObjectLock = "enforced"

	s.recordSelfTest("ok")
	return res, nil
}

func (s *Store) recordSelfTest(result string) {
	if s.m != nil {
		s.m.SelfTestRuns.WithLabelValues(result).Inc()
	}
}

// Config returns a copy of the Store's effective Config. Useful for the
// admin /_meta endpoint to surface read-only diagnostics.
func (s *Store) Config() Config { return s.cfg }
