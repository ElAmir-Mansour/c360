package main

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/redis/go-redis/v9"
	"github.com/rs/zerolog"
	"gopkg.in/yaml.v3"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/datastream/core"
	"github.com/clario360/platform/internal/dr/framestore"
	"github.com/clario360/platform/internal/dr/iacdr"
	"github.com/clario360/platform/internal/dr/integrations"
	drrepo "github.com/clario360/platform/internal/dr/repository"
	drservice "github.com/clario360/platform/internal/dr/service"
	"github.com/clario360/platform/internal/dr/storageoffload"
	"github.com/clario360/platform/internal/dr/vmcapture"
)

// coveragePlane bundles the three ClarioDR coverage-breadth packages (vmcapture,
// iacdr, storageoffload) so main wires them with a single call, mirroring the
// Batch A intelligencePlane, Batch B resiliencePlane and Batch C
// orchestrationPlane. Each is constructed with the real DR collaborators (DBPool,
// Redis, repository, the durable framestore that the core ingest/apply pipeline
// uses) — no fakes — and exposes its HTTP surface for mounting under /api/v1/dr
// and the leader-singleton background loops it must run on exactly one node.
type coveragePlane struct {
	// mount mounts each package's chi.Router under the already-Auth+Tenant
	// protected /api/v1/dr group; each Router carries its own RequirePermission
	// gates (dr:read queries, dr:write/dr:admin actions).
	mount func(protected chi.Router)

	// startLeaderLoops launches the leader-singleton background loops, each gated
	// by Redis leader election like startRPOMonitor/startFailoverDriver:
	//   - the storage-offload poll/retention claim loop (always), and
	//   - the periodic workload-capture scheduler (only when
	//     DR_VMCAPTURE_SCHEDULE_INTERVAL is configured; otherwise capture is purely
	//     request-driven through the run endpoint).
	startLeaderLoops func(ctx context.Context)

	// workloadSvc (vmcapture) and iacSvc (iacdr) are exposed so the Recover
	// product's Cloud DR sub-solution can COMPOSE their list read surfaces
	// (ListSources / ListSnapshots) for its workload summary — it does not fork
	// or reconstruct either service.
	workloadSvc *vmcapture.Service
	iacSvc      *iacdr.Service
}

// configureCoveragePlane constructs the three coverage-breadth packages with
// their real collaborators. repo + db back every package's tenant-scoped store;
// the vmcapture frame sink writes into the SAME durable applied-frame framestore
// the agent-ingest apply path uses, so a VM/K8s capture pass becomes applied
// frames the recovery-point service can seal — no separate pipeline.
func configureCoveragePlane(
	ctx context.Context,
	db *pgxpool.Pool,
	redisClient *redis.Client,
	repo *drrepo.Repository,
	drSvc *drservice.Service,
	resolver integrations.Resolver,
	metricsReg prometheus.Registerer,
	logger zerolog.Logger,
) *coveragePlane {
	plane := &coveragePlane{}

	tenantRunner := coverageTenantRunner{pool: db}
	systemRunner := drservice.NewPGXSystemRunner(db)

	// ---- vmcapture: VM/K8s workload capture into the frame store ---------
	// Both capturers are constructed (by the binding factory, per registered
	// source) with their REAL sources: a FileBlockSource opened over the configured
	// image path for vm_disk, and a K8s REST ResourceSource for k8s_workload. When
	// a kubeconfig path is configured the K8s REST source is built from it (api
	// server + bearer token + CA from the kubeconfig's current context); otherwise
	// the source is created on demand from each source's own stored config. Every
	// emitted frame is sunk into the durable framestore the core pipeline applies.
	workloadFactory, err := newCoverageBindingFactory(envOr("DR_VMCAPTURE_KUBECONFIG", ""))
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr workload-capture binding factory")
	}
	// Close the loop for VM capture: when an operator has registered+tested a
	// vmware_vsphere integration, the binding factory resolves its live decrypted
	// credentials at capture time and opens a real VSphereBinding from them. A nil
	// resolver (integrations API disabled) leaves the file/k8s behavior unchanged.
	workloadFactory.resolver = resolver
	workloadSvc, err := vmcapture.NewService(vmcapture.ServiceConfig{
		Runner:  tenantRunner,
		Store:   vmcapture.NewStore(),
		Sink:    drWorkloadFrameSink{store: framestore.New(repo, db)},
		Factory: workloadFactory,
		Metrics: vmcapture.NewMetrics(metricsReg),
		Logger:  logger,
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr workload-capture service")
	}
	workloadHandler := vmcapture.NewHandler(workloadSvc, logger)
	// The capture scheduler is request-driven via POST /workload-captures/{id}/run
	// by default; when DR_VMCAPTURE_SCHEDULE_INTERVAL is set it ALSO runs as a
	// leader-singleton periodic scheduler that runs every enabled source that is
	// due. The interval gates whether the periodic path exists at all.
	captureScheduleInterval := durationEnv("DR_VMCAPTURE_SCHEDULE_INTERVAL", 0)
	captureScheduler := newWorkloadCaptureScheduler(workloadSvc, db,
		captureScheduleInterval,
		durationEnv("DR_VMCAPTURE_SCHEDULE_PERIOD", 15*time.Minute),
		intEnv("DR_VMCAPTURE_SCHEDULE_BATCH", 16),
		logger)

	// ---- iacdr: IaC snapshots, drift diffs, reconstitution plans ---------
	// The default three real parsers (terraform state, k8s manifest, helm release)
	// are wired by the service; the diff/plan engines are pure. No background loop:
	// ingest/diff/plan are request-driven.
	iacSvc, err := iacdr.NewService(iacdr.Config{
		Store:   iacdr.NewStore(),
		Runner:  iacdr.PGXRunner{Pool: db},
		Metrics: iacdr.NewMetrics(metricsReg),
		Logger:  logger,
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr iac service")
	}
	iacRouter := iacdr.NewRouter(iacSvc, logger)
	plane.workloadSvc = workloadSvc
	plane.iacSvc = iacSvc

	// ---- storageoffload: SAN/NAS/file snapshot orchestration -------------
	// The real file/loopback provider is ALWAYS the default; production array
	// providers (netapp_ontap, dell_powerstore, nfs) are added when their REST
	// management gateway is configured (DR_STORAGE_<KIND>_ENDPOINT), each behind
	// the common StorageOffloadProvider contract via the HTTP array client. A
	// volume registered for an unconfigured provider is rejected at registration,
	// so the catalog never references a provider that cannot do work.
	offloadStore := storageoffload.NewStore()
	offloadSvc, err := storageoffload.NewService(storageoffload.Deps{
		Store:     offloadStore,
		Runner:    tenantRunner,
		System:    systemRunner,
		Providers: buildStorageOffloadProviders(resolver, logger),
		Metrics:   storageoffload.NewMetrics(metricsReg),
		Logger:    logger,
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr storage-offload service")
	}
	offloadRouter := storageoffload.NewRouter(offloadSvc, logger)
	offloadLoop, err := storageoffload.NewOffloadLoop(storageoffload.OffloadLoopConfig{
		Driver:   offloadSvc,
		Store:    offloadStore,
		System:   systemRunner,
		Logger:   logger,
		Interval: durationEnv("DR_STORAGE_OFFLOAD_INTERVAL", 2*time.Second),
		Batch:    intEnv("DR_STORAGE_OFFLOAD_BATCH", 0),
	})
	if err != nil {
		logger.Fatal().Err(err).Msg("failed to construct dr storage-offload loop")
	}

	// ---- HTTP mounting --------------------------------------------------
	// Each package's Router self-gates with RequirePermission per route, so all
	// three coverage routers mount under the already-Auth+Tenant /api/v1/dr group
	// at "/" via route-walking (mountRoutes) rather than repeated Mount("/", ...):
	//   - vmcapture:      dr:read (sources/epochs), dr:write (register/run capture).
	//   - iacdr:          dr:read (snapshots/diff/plan), dr:write (ingest snapshot).
	//   - storageoffload: dr:read (volumes/snapshots), dr:admin (register volume),
	//                      dr:write (request/replicate snapshots).
	plane.mount = func(protected chi.Router) {
		mountRoutes(protected, workloadHandler.Routes())
		mountRoutes(protected, iacRouter.Routes())
		mountRoutes(protected, offloadRouter.Routes())
	}

	// ---- leader-singleton background loops ------------------------------
	plane.startLeaderLoops = func(loopCtx context.Context) {
		// storage-offload loop: a single leader advances array/file snapshots
		// (CREATING -> READY, REPLICATING -> REPLICATED) and applies retention
		// across tenants on the system (RLS-bypass) path.
		runLeaderSingleton(loopCtx, redisClient, "dr-storage-offload",
			"DR_STORAGE_OFFLOAD", logger, offloadLoop.Run, nil)
		// workload-capture scheduler: only started when a schedule interval is
		// configured; otherwise capture is request-driven and there is no periodic
		// loop. A single leader fires every enabled source that is due, so a source
		// is not captured concurrently on multiple nodes.
		if captureScheduler != nil {
			runLeaderSingleton(loopCtx, redisClient, "dr-vmcapture-scheduler",
				"DR_VMCAPTURE_SCHEDULER", logger, captureScheduler.Run, nil)
		}
	}

	return plane
}

// ---------------------------------------------------------------------------
// shared coverage collaborators
// ---------------------------------------------------------------------------

// coverageTenantRunner adapts the DR pool to the tenant-scoped transaction
// runner the vmcapture and storageoffload services expect (RLS SET LOCAL
// app.current_tenant_id). It is one adapter satisfying both packages'
// structurally-identical TenantRunner contracts.
type coverageTenantRunner struct{ pool *pgxpool.Pool }

func (r coverageTenantRunner) RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(drrepo.DBTX) error) error {
	if r.pool == nil {
		return errors.New("dr coverage: nil transaction pool")
	}
	return database.RunWithTenant(ctx, r.pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

func (r coverageTenantRunner) RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(drrepo.DBTX) error) error {
	if r.pool == nil {
		return errors.New("dr coverage: nil transaction pool")
	}
	return database.RunReadWithTenant(ctx, r.pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

// drWorkloadFrameSink persists workload-capture frames into the same durable
// applied-frame framestore used by agent ingest, so VM/K8s capture output is
// applied through the identical path the core pipeline uses and can be sealed by
// the existing recovery-point service. The capture pass invokes SinkFrame from
// inside its own tenant transaction; the framestore's AppendFrame is idempotent
// on (stream, seq) so a replayed frame with identical bytes is a no-op.
type drWorkloadFrameSink struct {
	store *framestore.Store
}

func (s drWorkloadFrameSink) SinkFrame(ctx context.Context, tenantID uuid.UUID, f core.Frame) error {
	if s.store == nil {
		return errors.New("dr workload capture sink: framestore is not configured")
	}
	_, err := s.store.AppendFrame(ctx, tenantID, f)
	return err
}

// ---------------------------------------------------------------------------
// vmcapture binding factory (real FileBlockSource + kubeconfig-driven K8s REST)
// ---------------------------------------------------------------------------

// coverageBindingFactory builds each registered source's REAL capture binding.
// It delegates to vmcapture's DefaultBindingFactory for vm_disk (a
// FileHypervisorBinding over the configured image path, which opens a real
// FileBlockSource) and for k8s_workload sources that carry their own api_server
// in config. When a kubeconfig is configured AND a k8s_workload source does NOT
// pin its own api_server, the K8s REST ResourceSource is built from the
// kubeconfig's current context (server URL + bearer token + CA), so an operator
// can register K8s captures without restating cluster credentials per source.
type coverageBindingFactory struct {
	delegate *vmcapture.DefaultBindingFactory
	// kube is the parsed kubeconfig current-context cluster/user, nil when no
	// kubeconfig is configured (sources must then carry their own api_server).
	kube *kubeconfigContext
	// resolver, when non-nil, lets a vmware_cbt-bound vm_disk source resolve its
	// live decrypted credentials from the active "vmware_vsphere" integration and
	// open a real VSphereBinding instead of failing as "wired by the integration
	// phase". Nil (integrations API disabled) leaves the default behavior.
	resolver integrations.Resolver
}

// newCoverageBindingFactory parses the kubeconfig at path (when non-empty) so the
// K8s REST source can be built from it on demand. An unreadable/invalid
// kubeconfig is fatal at construction so a misconfiguration fails loudly at boot
// rather than silently per capture.
func newCoverageBindingFactory(kubeconfigPath string) (*coverageBindingFactory, error) {
	f := &coverageBindingFactory{delegate: vmcapture.NewDefaultBindingFactory()}
	if strings.TrimSpace(kubeconfigPath) == "" {
		return f, nil
	}
	kube, err := loadKubeconfigContext(kubeconfigPath)
	if err != nil {
		return nil, fmt.Errorf("loading DR_VMCAPTURE_KUBECONFIG %q: %w", kubeconfigPath, err)
	}
	f.kube = kube
	return f, nil
}

// VMBinding builds the hypervisor binding for a vm_disk source. A vmware_cbt
// binding is resolved from the active "vmware_vsphere" integration (when the
// integrations catalog is enabled): the binding factory merges the integration's
// decrypted endpoint/credentials/CA with the source's own per-capture config
// (vm_name, block gateway, block size) and opens a real VSphereBinding. All other
// bindings (file) delegate to the default factory unchanged. With no resolver, a
// vmware_cbt source falls through to the delegate (which returns ErrNotConfigured),
// preserving the prior behavior exactly.
func (f *coverageBindingFactory) VMBinding(ctx context.Context, s *vmcapture.Source) (vmcapture.HypervisorBinding, error) {
	if f.resolver != nil && s != nil && s.BindingKind == vmcapture.BindingVMwareCBT {
		return f.vsphereBinding(ctx, s)
	}
	return f.delegate.VMBinding(ctx, s)
}

// vsphereBinding resolves the active vmware_vsphere integration for the source's
// tenant and opens a VSphereBinding from its decrypted Config, layered with the
// source's own per-capture config (which the operator restated only for the
// fields that differ per workload: vm_name, block gateway, block size). The
// integration carries the cluster-level secrets (endpoint, username, token, CA);
// the source carries the per-VM targeting. Source values win on overlap so an
// operator can override per workload.
func (f *coverageBindingFactory) vsphereBinding(ctx context.Context, s *vmcapture.Source) (vmcapture.HypervisorBinding, error) {
	tenantID, err := uuid.Parse(s.TenantID)
	if err != nil {
		return nil, fmt.Errorf("vmcapture vsphere: source %s has invalid tenant_id %q: %w", s.ID, s.TenantID, err)
	}
	_, cfg, err := f.resolver.ResolveActive(ctx, tenantID, vmwareVSphereVendor)
	if err != nil {
		if errors.Is(err, integrations.ErrNotFound) {
			return nil, fmt.Errorf("vmcapture vsphere: %w (register and TEST a %s integration to activate it)", err, vmwareVSphereVendor)
		}
		return nil, err
	}

	// Start from the resolved integration credentials, then overlay the source's
	// own config (per-VM targeting / overrides) so source values win on overlap.
	bindCfg := map[string]any{
		"endpoint":    cfg.Endpoint,
		"username":    cfg.Username,
		"token":       cfg.Token,
		"ca_cert_pem": cfg.CACertPEM,
	}
	for k, v := range cfg.Extra {
		bindCfg[k] = v
	}
	for k, v := range s.Config {
		bindCfg[k] = v
	}
	if s.BlockSizeBytes > 0 {
		bindCfg["block_size"] = s.BlockSizeBytes
	}
	return vmcapture.NewVSphereBindingFromConfig(bindCfg)
}

// K8sSource builds the K8s REST ResourceSource. When the source already pins its
// own api_server, or no kubeconfig is configured, it delegates to the default
// factory (which reads the source's own config). Otherwise it constructs a
// RESTResourceSource from the kubeconfig current context, layering the source's
// namespaces/kinds scope on top.
func (f *coverageBindingFactory) K8sSource(ctx context.Context, s *vmcapture.Source) (vmcapture.ResourceSource, error) {
	if f.kube == nil || configHasAPIServer(s) {
		return f.delegate.K8sSource(ctx, s)
	}
	if s.BindingKind != vmcapture.BindingREST {
		// Only the REST binding is kubeconfig-driven; anything else (e.g. a test
		// fixture binding) is left to the default factory.
		return f.delegate.K8sSource(ctx, s)
	}
	return vmcapture.NewRESTResourceSource(vmcapture.RESTConfig{
		APIServer:             f.kube.server,
		BearerToken:           f.kube.token,
		CACertPEM:             f.kube.caPEM,
		InsecureSkipTLSVerify: f.kube.insecure,
		Namespaces:            stringsFromSourceConfig(s, "namespaces"),
		Kinds:                 stringsFromSourceConfig(s, "kinds"),
	})
}

// configHasAPIServer reports whether the source pins its own K8s API server in
// config (so the kubeconfig is not used for it).
func configHasAPIServer(s *vmcapture.Source) bool {
	if s == nil || s.Config == nil {
		return false
	}
	v, _ := s.Config["api_server"].(string)
	return strings.TrimSpace(v) != ""
}

// stringsFromSourceConfig reads a []string scope value from a source's stored
// config (namespaces / kinds), tolerating both []string and JSON []any shapes.
func stringsFromSourceConfig(s *vmcapture.Source, key string) []string {
	if s == nil || s.Config == nil {
		return nil
	}
	switch v := s.Config[key].(type) {
	case []string:
		return append([]string(nil), v...)
	case []any:
		out := make([]string, 0, len(v))
		for _, e := range v {
			if str, ok := e.(string); ok {
				out = append(out, str)
			}
		}
		return out
	default:
		return nil
	}
}

// kubeconfigContext is the resolved cluster+user of a kubeconfig's current
// context: enough to talk to the API server over the REST source.
type kubeconfigContext struct {
	server   string
	token    string
	caPEM    []byte
	insecure bool
}

// kubeconfigFile is the minimal kubeconfig shape we read: clusters, users, and
// the named contexts pairing them, plus the current-context selector.
type kubeconfigFile struct {
	CurrentContext string `yaml:"current-context"`
	Clusters       []struct {
		Name    string `yaml:"name"`
		Cluster struct {
			Server                   string `yaml:"server"`
			CertificateAuthorityData string `yaml:"certificate-authority-data"`
			CertificateAuthority     string `yaml:"certificate-authority"`
			InsecureSkipTLSVerify    bool   `yaml:"insecure-skip-tls-verify"`
		} `yaml:"cluster"`
	} `yaml:"clusters"`
	Users []struct {
		Name string `yaml:"name"`
		User struct {
			Token     string `yaml:"token"`
			TokenFile string `yaml:"tokenFile"`
		} `yaml:"user"`
	} `yaml:"users"`
	Contexts []struct {
		Name    string `yaml:"name"`
		Context struct {
			Cluster string `yaml:"cluster"`
			User    string `yaml:"user"`
		} `yaml:"context"`
	} `yaml:"contexts"`
}

// loadKubeconfigContext reads, parses, and resolves the current context of a
// kubeconfig file into the cluster server/CA + user bearer token the REST source
// needs. It speaks only the subset of kubeconfig the REST source uses (server,
// CA, bearer token); cert-based client auth is not supported by the token-only
// REST source and is rejected with a clear error.
func loadKubeconfigContext(path string) (*kubeconfigContext, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var kc kubeconfigFile
	if err := yaml.Unmarshal(raw, &kc); err != nil {
		return nil, fmt.Errorf("parsing kubeconfig: %w", err)
	}
	if strings.TrimSpace(kc.CurrentContext) == "" {
		return nil, errors.New("kubeconfig has no current-context")
	}
	var clusterName, userName string
	for _, c := range kc.Contexts {
		if c.Name == kc.CurrentContext {
			clusterName = c.Context.Cluster
			userName = c.Context.User
			break
		}
	}
	if clusterName == "" {
		return nil, fmt.Errorf("kubeconfig current-context %q references no cluster", kc.CurrentContext)
	}

	out := &kubeconfigContext{}
	found := false
	for _, c := range kc.Clusters {
		if c.Name != clusterName {
			continue
		}
		found = true
		out.server = strings.TrimSpace(c.Cluster.Server)
		out.insecure = c.Cluster.InsecureSkipTLSVerify
		switch {
		case c.Cluster.CertificateAuthorityData != "":
			decoded, derr := base64.StdEncoding.DecodeString(c.Cluster.CertificateAuthorityData)
			if derr != nil {
				return nil, fmt.Errorf("kubeconfig cluster %q certificate-authority-data: %w", clusterName, derr)
			}
			out.caPEM = decoded
		case c.Cluster.CertificateAuthority != "":
			caBytes, rerr := os.ReadFile(c.Cluster.CertificateAuthority)
			if rerr != nil {
				return nil, fmt.Errorf("kubeconfig cluster %q certificate-authority file: %w", clusterName, rerr)
			}
			out.caPEM = caBytes
		}
		break
	}
	if !found {
		return nil, fmt.Errorf("kubeconfig cluster %q not found", clusterName)
	}
	if out.server == "" {
		return nil, fmt.Errorf("kubeconfig cluster %q has no server", clusterName)
	}

	for _, u := range kc.Users {
		if u.Name != userName {
			continue
		}
		switch {
		case strings.TrimSpace(u.User.Token) != "":
			out.token = strings.TrimSpace(u.User.Token)
		case strings.TrimSpace(u.User.TokenFile) != "":
			tokBytes, rerr := os.ReadFile(u.User.TokenFile)
			if rerr != nil {
				return nil, fmt.Errorf("kubeconfig user %q tokenFile: %w", userName, rerr)
			}
			out.token = strings.TrimSpace(string(tokBytes))
		}
		break
	}
	if out.token == "" {
		return nil, fmt.Errorf("kubeconfig user %q has no bearer token (token/tokenFile); the K8s REST source is token-auth only", userName)
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// vmcapture periodic scheduler (leader-singleton, system-path enumeration)
// ---------------------------------------------------------------------------

// workloadCaptureScheduler is the optional leader-singleton periodic capture
// driver. It is created only when DR_VMCAPTURE_SCHEDULE_INTERVAL is configured;
// otherwise capture is purely request-driven through the run endpoint and this
// is nil. On each tick it enumerates enabled sources due for capture across all
// tenants on the system (RLS-bypass) path — a coverage-owned read that NEVER
// edits the vmcapture store (disjoint ownership) — and runs each through the
// service's own tenant-scoped RunCapture, exactly as the run endpoint does.
type workloadCaptureScheduler struct {
	svc      *vmcapture.Service
	pool     *pgxpool.Pool
	interval time.Duration
	period   time.Duration
	batch    int
	logger   zerolog.Logger
}

// newWorkloadCaptureScheduler returns a scheduler, or nil when interval <= 0
// (request-driven only). period is the minimum spacing between two capture passes
// of the SAME source (a source is due when it has never run or last ran longer
// ago than period); batch caps sources advanced per tick.
func newWorkloadCaptureScheduler(svc *vmcapture.Service, pool *pgxpool.Pool, interval, period time.Duration, batch int, logger zerolog.Logger) *workloadCaptureScheduler {
	if interval <= 0 {
		return nil
	}
	if period <= 0 {
		period = 15 * time.Minute
	}
	if batch <= 0 {
		batch = 16
	}
	return &workloadCaptureScheduler{
		svc:      svc,
		pool:     pool,
		interval: interval,
		period:   period,
		batch:    batch,
		logger:   logger.With().Str("component", "dr_vmcapture_scheduler").Logger(),
	}
}

// Run blocks until ctx is cancelled, ticking every interval. Launch it from the
// leader-election OnAcquire callback so a single instance fires scheduled
// captures (runLeaderSingleton does this).
func (s *workloadCaptureScheduler) Run(ctx context.Context) {
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.tick(ctx); err != nil && ctx.Err() == nil {
				s.logger.Error().Err(err).Msg("dr workload capture scheduler tick failed")
			}
		}
	}
}

// dueSource is one enabled capture source the scheduler resolved as due.
type dueSource struct {
	tenantID uuid.UUID
	sourceID uuid.UUID
}

// dueCaptureSourcesSQL enumerates enabled sources that are due for a fresh
// capture pass: never run, or last run more than `period` ago. The leader-loop
// reads it on the system (RLS-bypass) path so it sees sources across every
// tenant; the subsequent RunCapture re-applies tenant scope.
const dueCaptureSourcesSQL = `
SELECT tenant_id, id
FROM dr_workload_capture_source
WHERE enabled = true
  AND (last_run_at IS NULL OR last_run_at <= now() - ($1::double precision * interval '1 second'))
ORDER BY last_run_at ASC NULLS FIRST
LIMIT $2`

// tick resolves the due sources and runs each capture pass. A per-source failure
// is isolated and logged so a single broken source does not stall the rest.
func (s *workloadCaptureScheduler) tick(ctx context.Context) error {
	var due []dueSource
	if err := database.RunSystemRead(ctx, s.pool, func(tx pgx.Tx) error {
		rows, qerr := tx.Query(ctx, dueCaptureSourcesSQL, s.period.Seconds(), s.batch)
		if qerr != nil {
			return qerr
		}
		defer rows.Close()
		for rows.Next() {
			var d dueSource
			if scanErr := rows.Scan(&d.tenantID, &d.sourceID); scanErr != nil {
				return scanErr
			}
			due = append(due, d)
		}
		return rows.Err()
	}); err != nil {
		return fmt.Errorf("dr workload capture scheduler: resolving due sources: %w", err)
	}

	for _, d := range due {
		if err := ctx.Err(); err != nil {
			return err
		}
		if _, err := s.svc.RunCapture(ctx, d.tenantID, d.sourceID); err != nil {
			s.logger.Warn().Err(err).
				Str("tenant_id", d.tenantID.String()).
				Str("source_id", d.sourceID.String()).
				Msg("scheduled workload capture pass failed")
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// storageoffload provider selection (real file default + config-selected arrays)
// ---------------------------------------------------------------------------

// buildStorageOffloadProviders returns the provider map the orchestrator drives.
// The real file/loopback provider is ALWAYS present as the default; each
// production array kind is added only when its REST management gateway endpoint
// is configured (DR_STORAGE_<KIND>_ENDPOINT), so the catalog never accepts a
// volume for a provider that has no backing client.
func buildStorageOffloadProviders(resolver integrations.Resolver, logger zerolog.Logger) map[string]storageoffload.StorageOffloadProvider {
	providers := map[string]storageoffload.StorageOffloadProvider{
		storageoffload.ProviderFile: storageoffload.NewFileProvider(),
	}
	for _, spec := range []struct{ kind, envPrefix string }{
		{storageoffload.ProviderNetAppONTAP, "DR_STORAGE_NETAPP_ONTAP"},
		{storageoffload.ProviderDellPowerStore, "DR_STORAGE_DELL_POWERSTORE"},
		{storageoffload.ProviderNFS, "DR_STORAGE_NFS"},
	} {
		endpoint := strings.TrimSpace(os.Getenv(spec.envPrefix + "_ENDPOINT"))
		if endpoint == "" {
			continue
		}
		token := os.Getenv(spec.envPrefix + "_TOKEN")
		client := storageoffload.NewHTTPArrayClient(endpoint, token, nil)
		providers[spec.kind] = storageoffload.NewArrayProvider(spec.kind, client)
		logger.Info().
			Str("provider", spec.kind).
			Str("endpoint", endpoint).
			Msg("dr storage-offload array provider wired from config")
	}
	// Registry-backed close-the-loop: when the integrations catalog is enabled and
	// the NetApp ONTAP provider was NOT already wired from env, register an
	// ONTAP provider whose ArrayClient resolves live, per-tenant decrypted
	// credentials from the active "netapp_ontap" integration at request time. A
	// nil resolver (integrations API disabled) leaves the env-only behavior above
	// exactly as it was. Env config wins if both are present (explicit > catalog).
	if resolver != nil {
		if _, wired := providers[storageoffload.ProviderNetAppONTAP]; !wired {
			arrayClient := newResolverArrayClient(resolver, storageoffload.ProviderNetAppONTAP)
			providers[storageoffload.ProviderNetAppONTAP] = storageoffload.NewArrayProvider(storageoffload.ProviderNetAppONTAP, arrayClient)
			logger.Info().
				Str("provider", storageoffload.ProviderNetAppONTAP).
				Msg("dr storage-offload netapp_ontap provider wired from the integrations catalog (live per-tenant credentials)")
		}
	}
	return providers
}

// Compile-time checks that the coverage collaborators satisfy the package
// contracts they are wired into.
var (
	_ vmcapture.FrameSink         = drWorkloadFrameSink{}
	_ vmcapture.BindingFactory    = (*coverageBindingFactory)(nil)
	_ vmcapture.TenantRunner      = coverageTenantRunner{}
	_ storageoffload.TenantRunner = coverageTenantRunner{}
)
