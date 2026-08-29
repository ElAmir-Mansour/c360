// Command clario-dr-agent is the ClarioDR capture agent (DESIGN_DataStream_DR.md
// §2.2). It runs on CUSTOMER INFRASTRUCTURE (the primary site) as a static,
// air-gap-friendly binary. It:
//
//  1. loads its self-contained config (control-plane URL, enrollment token or an
//     already-persisted cert, source specs, local checkpoint cache path);
//  2. enrolls with the sovereign control plane over PKI/mTLS if it has no valid
//     cert yet (generate keypair + CSR -> POST the single-use enrollment token to
//     the enroll endpoint -> persist the issued leaf cert + CA chain);
//  3. runs the configured shared-replication-core Capturer(s) and ships the
//     captured frames — compressed, encrypted, resumable — to the control-plane
//     mTLS ingest listener;
//  4. resumes each stream from the durable local checkpoint cache on reconnect or
//     restart;
//  5. shuts down gracefully on SIGINT/SIGTERM.
//
// Build a static binary: CGO_ENABLED=0 go build -o clario-dr-agent ./cmd/clario-dr-agent
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/datastream/core"
	"github.com/clario360/platform/internal/dr/agent"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "clario-dr-agent: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	var (
		configPath = flag.String("config", "", "path to the agent YAML config file")
		enrollOnly = flag.Bool("enroll-only", false, "enroll (if needed) and exit without shipping")
		logLevel   = flag.String("log-level", "info", "log level: debug|info|warn|error")
		jsonLogs   = flag.Bool("json-logs", false, "emit JSON logs instead of console logs")
	)
	flag.Parse()

	logger := buildLogger(*logLevel, *jsonLogs)

	cfg, err := loadConfig(*configPath)
	if err != nil {
		return err
	}
	if err := cfg.validate(); err != nil {
		return fmt.Errorf("invalid config: %w", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// --- Local stores: enrolled identity + resumable checkpoint cache ---
	identityStore, err := agent.NewIdentityStore(cfg.CacheDir)
	if err != nil {
		return err
	}
	checkpoints, err := agent.NewFileCheckpointStore(cfg.CacheDir)
	if err != nil {
		return err
	}

	// --- Enroll if there is no valid cert yet (CSR -> leaf cert + CA) ---
	identity, err := ensureEnrolled(ctx, cfg, identityStore, logger)
	if err != nil {
		return err
	}
	logger.Info().
		Str("serial", identity.Serial).
		Time("not_after", identity.NotAfter).
		Msg("agent enrolled identity ready")
	identityProvider, err := agent.NewMutableIdentityProvider(identity)
	if err != nil {
		return err
	}

	if *enrollOnly {
		logger.Info().Msg("enroll-only: enrollment complete, exiting")
		return nil
	}

	// --- Metrics endpoint (optional) ---
	reg := prometheus.NewRegistry()
	metrics := core.NewMetrics(reg)

	sources, err := cfg.toSourceSpecs()
	if err != nil {
		return err
	}
	defer zeroSourceDEKs(sources)
	startIdentityRenewal(ctx, cfg, identityStore, identityProvider, logger)

	rt, err := agent.NewRuntime(agent.Config{
		IngestURL:           cfg.IngestURL,
		IdentityProvider:    identityProvider,
		Sources:             sources,
		Checkpoints:         checkpoints,
		ReconnectBackoff:    cfg.ReconnectBackoff,
		MaxReconnectBackoff: cfg.MaxReconnectBackoff,
		ThrottleBytesPerSec: cfg.ThrottleBytesPerSec,
		Metrics:             metrics,
		ServerName:          cfg.ServerName,
		InsecureSkipVerify:  cfg.InsecureSkipVerify,
		Logger:              logger,
	})
	if err != nil {
		return err
	}

	var metricsSrv *http.Server
	if cfg.MetricsAddr != "" {
		metricsSrv = startMetricsServer(cfg.MetricsAddr, reg, rt.Status, agentHealthStaleAfter(cfg.MaxReconnectBackoff), logger)
	}

	logger.Info().
		Int("sources", len(sources)).
		Str("ingest_url", cfg.IngestURL).
		Msg("clario-dr-agent starting capture+ship")

	runErr := rt.Run(ctx)

	if metricsSrv != nil {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_ = metricsSrv.Shutdown(shutdownCtx)
		cancel()
	}

	if runErr != nil {
		return runErr
	}
	logger.Info().Msg("clario-dr-agent shut down cleanly")
	return nil
}

func zeroSourceDEKs(sources []agent.SourceSpec) {
	for i := range sources {
		for j := range sources[i].DEK {
			sources[i].DEK[j] = 0
		}
	}
}

// ensureEnrolled returns a valid enrolled identity: it reuses a persisted,
// unexpired cert when present, otherwise it performs the real enrollment
// exchange (keypair + CSR -> enroll endpoint -> leaf cert + CA) and persists the
// result so the next start reuses it.
func ensureEnrolled(ctx context.Context, cfg *agentConfig, store *agent.IdentityStore, logger zerolog.Logger) (*agent.Identity, error) {
	if store.Exists() {
		id, err := store.Load()
		if err != nil {
			return nil, fmt.Errorf("load persisted identity: %w", err)
		}
		logger.Info().Msg("reusing persisted enrolled certificate")
		return id, nil
	}

	if cfg.EnrollmentToken == "" {
		return nil, errors.New("no valid enrolled certificate and no enrollment token provided (set enrollment_token or CLARIO_DR_AGENT_ENROLLMENT_TOKEN)")
	}
	if cfg.ControlPlaneURL == "" {
		return nil, errors.New("enrollment required but control_plane_url is not set")
	}

	caBundle, err := cfg.resolveCABundle()
	if err != nil {
		return nil, err
	}

	logger.Info().Str("control_plane", cfg.ControlPlaneURL).Msg("enrolling: generating keypair + CSR and exchanging the enrollment token")
	id, err := agent.NewEnrollClient().Enroll(ctx, agent.EnrollConfig{
		ControlPlaneURL: cfg.ControlPlaneURL,
		Token:           cfg.EnrollmentToken,
		AgentID:         cfg.AgentID,
		TenantID:        cfg.TenantID,
		SiteID:          cfg.SiteID,
		CABundlePEM:     caBundle,
	})
	if err != nil {
		return nil, fmt.Errorf("enrollment exchange failed: %w", err)
	}
	if err := store.Save(id); err != nil {
		return nil, fmt.Errorf("persist issued certificate: %w", err)
	}
	logger.Info().Msg("enrollment complete: leaf certificate and CA chain persisted")
	return id, nil
}

func startMetricsServer(addr string, reg *prometheus.Registry, status func() agent.RuntimeStatus, staleAfter time.Duration, logger zerolog.Logger) *http.Server {
	mux := newAgentMetricsHandler(reg, status, staleAfter, time.Now)
	srv := &http.Server{Addr: addr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		logger.Info().Str("addr", addr).Msg("serving agent metrics")
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error().Err(err).Msg("metrics server stopped")
		}
	}()
	return srv
}

type agentHealthResponse struct {
	Status            string                      `json:"status"`
	Reason            string                      `json:"reason,omitempty"`
	CheckedAt         time.Time                   `json:"checked_at"`
	StaleAfterSeconds float64                     `json:"stale_after_seconds"`
	Streams           []agent.StreamRuntimeStatus `json:"streams"`
}

func newAgentMetricsHandler(reg *prometheus.Registry, status func() agent.RuntimeStatus, staleAfter time.Duration, now func() time.Time) http.Handler {
	if now == nil {
		now = time.Now
	}
	mux := http.NewServeMux()
	mux.Handle("/metrics", promhttp.HandlerFor(reg, promhttp.HandlerOpts{}))
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		var snapshot agent.RuntimeStatus
		if status != nil {
			snapshot = status()
		}
		code, body := evaluateAgentHealth(snapshot, now().UTC(), staleAfter)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(body)
	})
	return mux
}

func evaluateAgentHealth(snapshot agent.RuntimeStatus, now time.Time, staleAfter time.Duration) (int, agentHealthResponse) {
	if staleAfter <= 0 {
		staleAfter = time.Minute
	}
	resp := agentHealthResponse{
		Status:            "healthy",
		CheckedAt:         now.UTC(),
		StaleAfterSeconds: staleAfter.Seconds(),
		Streams:           snapshot.Streams,
	}
	if len(snapshot.Streams) == 0 {
		resp.Status = "unhealthy"
		resp.Reason = "no streams configured"
		return http.StatusServiceUnavailable, resp
	}

	code := http.StatusOK
	for _, stream := range snapshot.Streams {
		switch stream.Phase {
		case agent.StreamPhaseFailed:
			resp.Status = "unhealthy"
			resp.Reason = fmt.Sprintf("stream %s failed", stream.StreamID)
			return http.StatusServiceUnavailable, resp
		case agent.StreamPhaseReconnecting:
			code = markAgentHealthDegraded(&resp, code, fmt.Sprintf("stream %s reconnecting", stream.StreamID))
		case agent.StreamPhaseConfigured, agent.StreamPhaseStarting:
			if !stream.Running || statusAge(now, stream.UpdatedAt) > staleAfter {
				code = markAgentHealthDegraded(&resp, code, fmt.Sprintf("stream %s not yet shipping", stream.StreamID))
			}
		case agent.StreamPhaseStopped:
			code = markAgentHealthDegraded(&resp, code, fmt.Sprintf("stream %s stopped", stream.StreamID))
		}
		if streamHasStaleUnackedFrame(stream, now, staleAfter) {
			code = markAgentHealthDegraded(&resp, code, fmt.Sprintf("stream %s has unacked frames older than %.0fs", stream.StreamID, staleAfter.Seconds()))
		}
	}
	return code, resp
}

func markAgentHealthDegraded(resp *agentHealthResponse, code int, reason string) int {
	if resp.Status == "healthy" {
		resp.Status = "degraded"
		resp.Reason = reason
		return http.StatusServiceUnavailable
	}
	return code
}

func streamHasStaleUnackedFrame(stream agent.StreamRuntimeStatus, now time.Time, staleAfter time.Duration) bool {
	if stream.Phase != agent.StreamPhaseShipping || stream.LastFrameAt.IsZero() {
		return false
	}
	if !stream.LastAckAt.IsZero() && !stream.LastAckAt.Before(stream.LastFrameAt) {
		return false
	}
	return statusAge(now, stream.LastFrameAt) > staleAfter
}

func statusAge(now, ts time.Time) time.Duration {
	if ts.IsZero() || now.Before(ts) {
		return 0
	}
	return now.Sub(ts)
}

func agentHealthStaleAfter(maxReconnectBackoff time.Duration) time.Duration {
	staleAfter := 2 * maxReconnectBackoff
	if staleAfter < 30*time.Second {
		return 30 * time.Second
	}
	if staleAfter > 5*time.Minute {
		return 5 * time.Minute
	}
	return staleAfter
}

func buildLogger(level string, jsonLogs bool) zerolog.Logger {
	lvl, err := zerolog.ParseLevel(level)
	if err != nil {
		lvl = zerolog.InfoLevel
	}
	zerolog.SetGlobalLevel(lvl)
	if jsonLogs {
		return zerolog.New(os.Stderr).Level(lvl).With().Timestamp().Str("service", "clario-dr-agent").Logger()
	}
	return zerolog.New(zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.RFC3339}).
		Level(lvl).With().Timestamp().Str("service", "clario-dr-agent").Logger()
}
