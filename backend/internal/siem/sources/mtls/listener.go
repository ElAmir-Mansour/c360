package mtls

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/rs/zerolog"
)

// ListenerConfig captures the boot-time inputs to a mTLS listener.
type ListenerConfig struct {
	Addr           string
	CABundlePath   string
	ServerCertPath string
	ServerKeyPath  string
	ReadTimeout    time.Duration
	WriteTimeout   time.Duration
}

// Listener is the dedicated TLS server for the mTLS-only heartbeat
// route.
type Listener struct {
	cfg    ListenerConfig
	router http.Handler
	logger zerolog.Logger
	server *http.Server
}

// New constructs a Listener. router must already include the
// mTLS Middleware.
func New(cfg ListenerConfig, router http.Handler, logger zerolog.Logger) *Listener {
	if cfg.Addr == "" {
		cfg.Addr = ":8095"
	}
	if cfg.ReadTimeout == 0 {
		cfg.ReadTimeout = 5 * time.Second
	}
	if cfg.WriteTimeout == 0 {
		cfg.WriteTimeout = 5 * time.Second
	}
	return &Listener{
		cfg:    cfg,
		router: router,
		logger: logger.With().Str("component", "siem-mtls-listener").Logger(),
	}
}

// Start blocks running the listener until ctx is done. Errors other
// than http.ErrServerClosed are returned.
func (l *Listener) Start(ctx context.Context) error {
	tlsCfg, err := l.buildTLSConfig()
	if err != nil {
		return err
	}
	l.server = &http.Server{
		Addr:         l.cfg.Addr,
		Handler:      l.router,
		TLSConfig:    tlsCfg,
		ReadTimeout:  l.cfg.ReadTimeout,
		WriteTimeout: l.cfg.WriteTimeout,
	}

	shutdown := make(chan struct{})
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = l.server.Shutdown(shutdownCtx)
		close(shutdown)
	}()

	l.logger.Info().Str("addr", l.cfg.Addr).Msg("mTLS listener starting")
	err = l.server.ListenAndServeTLS("", "") // server cert is loaded into TLSConfig.Certificates by buildTLSConfig
	if errors.Is(err, http.ErrServerClosed) {
		<-shutdown
		return nil
	}
	return err
}

// buildTLSConfig reads the CA bundle and server keypair and constructs a
// TLS config that serves the listener's certificate and requires +
// verifies a client certificate.
func (l *Listener) buildTLSConfig() (*tls.Config, error) {
	if l.cfg.CABundlePath == "" {
		return nil, errors.New("mtls: CA bundle path is required")
	}
	bundle, err := os.ReadFile(l.cfg.CABundlePath)
	if err != nil {
		return nil, fmt.Errorf("mtls: read CA bundle %q: %w", l.cfg.CABundlePath, err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(bundle) {
		return nil, errors.New("mtls: CA bundle has no PEM blocks")
	}
	if l.cfg.ServerCertPath == "" || l.cfg.ServerKeyPath == "" {
		return nil, errors.New("mtls: server cert and key paths are required (SIEM_MTLS_SERVER_CERT_PATH / SIEM_MTLS_SERVER_KEY_PATH)")
	}
	cert, err := tls.LoadX509KeyPair(l.cfg.ServerCertPath, l.cfg.ServerKeyPath)
	if err != nil {
		return nil, fmt.Errorf("mtls: load server keypair %q/%q: %w", l.cfg.ServerCertPath, l.cfg.ServerKeyPath, err)
	}
	return &tls.Config{
		MinVersion:   tls.VersionTLS12,
		Certificates: []tls.Certificate{cert},
		ClientAuth:   tls.RequireAndVerifyClientCert,
		ClientCAs:    pool,
	}, nil
}
