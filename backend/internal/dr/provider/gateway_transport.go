package provider

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"
)

// Vendor-transit hardening errors (Wave 3). All fail CLOSED: a malformed pin,
// an incoherent mTLS pair, or an unsupported floor prevents construction rather
// than silently degrading to an insecure client.
var (
	// ErrTLSConfig marks a malformed CA bundle, mTLS client pair, or unsupported
	// minimum-TLS floor supplied to the gateway transport builder.
	ErrTLSConfig = fmt.Errorf("%w: provider gateway TLS configuration invalid", ErrNotConfigured)
	// ErrInsecureEndpoint marks a non-https (plaintext) gateway endpoint/path.
	// The gateway carries regulated recovery envelopes; plaintext is refused.
	ErrInsecureEndpoint = fmt.Errorf("%w: provider gateway endpoint must be https", ErrNotConfigured)
)

// transport dialer/idle tuning shared by every hardened gateway client. Kept
// conservative: recovery calls are low-frequency and must not hang a failover.
const (
	gatewayDialTimeout           = 10 * time.Second
	gatewayKeepAlive             = 30 * time.Second
	gatewayTLSHandshakeTimeout   = 10 * time.Second
	gatewayIdleConnTimeout       = 90 * time.Second
	gatewayExpectContinueTimeout = 1 * time.Second
	gatewayResponseHeaderTimeout = 30 * time.Second
	gatewayMaxIdleConns          = 16
)

// buildHardenedTLSConfig assembles the outbound TLS config for the provider
// gateway. It:
//
//   - sets MinVersion to the configured floor (>= TLS 1.2, up to 1.3);
//   - PINS RootCAs to the supplied CA bundle when present (never the system
//     pool) so a mis-issued/self-signed gateway cert is rejected;
//   - loads an optional mTLS client identity (both cert+key PEM required); and
//   - always leaves InsecureSkipVerify false.
//
// It fails closed on any malformed PEM, incoherent mTLS pair, or unsupported
// floor.
func buildHardenedTLSConfig(cfg Config) (*tls.Config, error) {
	minVer, err := parseMinTLS(cfg.MinTLSVersion)
	if err != nil {
		return nil, err
	}

	tlsCfg := &tls.Config{
		MinVersion:         minVer,
		InsecureSkipVerify: false, //nolint:gosec // explicit: pin verification is always on.
	}

	// Pin the gateway server cert to a configured CA bundle when supplied.
	if pem := strings.TrimSpace(cfg.CABundlePEM); pem != "" {
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM([]byte(cfg.CABundlePEM)) {
			return nil, fmt.Errorf("%w: CA bundle PEM contains no valid certificates", ErrTLSConfig)
		}
		tlsCfg.RootCAs = pool
	}

	// Optional mTLS client identity. Both halves must be present together.
	cert := strings.TrimSpace(cfg.ClientCertPEM)
	key := strings.TrimSpace(cfg.ClientKeyPEM)
	switch {
	case cert == "" && key == "":
		// no mTLS identity configured
	case cert == "" || key == "":
		return nil, fmt.Errorf("%w: mTLS requires BOTH client cert and client key PEM", ErrTLSConfig)
	default:
		pair, err := tls.X509KeyPair([]byte(cfg.ClientCertPEM), []byte(cfg.ClientKeyPEM))
		if err != nil {
			return nil, fmt.Errorf("%w: mTLS client key pair: %v", ErrTLSConfig, err)
		}
		tlsCfg.Certificates = []tls.Certificate{pair}
	}

	return tlsCfg, nil
}

// newHardenedClient builds the ONE outbound *http.Client for a gateway adapter,
// wiring the hardened TLS config into a bounded *http.Transport. Constructed
// once in NewGatewayAdapter; a malformed pin fails construction.
func newHardenedClient(cfg Config, requestTimeout time.Duration) (*http.Client, error) {
	tlsCfg, err := buildHardenedTLSConfig(cfg)
	if err != nil {
		return nil, err
	}
	transport := &http.Transport{
		Proxy: http.ProxyFromEnvironment,
		DialContext: (&net.Dialer{
			Timeout:   gatewayDialTimeout,
			KeepAlive: gatewayKeepAlive,
		}).DialContext,
		ForceAttemptHTTP2:     true,
		TLSClientConfig:       tlsCfg,
		TLSHandshakeTimeout:   gatewayTLSHandshakeTimeout,
		MaxIdleConns:          gatewayMaxIdleConns,
		MaxIdleConnsPerHost:   gatewayMaxIdleConns,
		IdleConnTimeout:       gatewayIdleConnTimeout,
		ExpectContinueTimeout: gatewayExpectContinueTimeout,
		ResponseHeaderTimeout: gatewayResponseHeaderTimeout,
	}
	return &http.Client{
		Timeout:   requestTimeout,
		Transport: transport,
	}, nil
}

// parseMinTLS resolves the configured minimum-TLS floor. Empty defaults to
// TLS 1.2; the floor can never be lowered below 1.2.
func parseMinTLS(v string) (uint16, error) {
	switch strings.TrimSpace(v) {
	case "", "1.2", "12", "TLS1.2", "tls1.2":
		return tls.VersionTLS12, nil
	case "1.3", "13", "TLS1.3", "tls1.3":
		return tls.VersionTLS13, nil
	default:
		return 0, fmt.Errorf("%w: unsupported minimum TLS version %q (want 1.2 or 1.3)", ErrTLSConfig, v)
	}
}

// requireHTTPS returns an error unless the endpoint parses to an https URL with
// a host. It rejects http:// (plaintext) fail-closed. Empty is treated as "not
// configured" by callers; this only judges a NON-EMPTY endpoint.
func requireHTTPS(endpoint string) error {
	e := strings.TrimSpace(endpoint)
	if e == "" {
		return nil
	}
	lower := strings.ToLower(e)
	if strings.HasPrefix(lower, "http://") {
		return fmt.Errorf("%w: %q uses plaintext http", ErrInsecureEndpoint, redactURL(e))
	}
	if !strings.HasPrefix(lower, "https://") {
		return fmt.Errorf("%w: %q is not an https URL", ErrInsecureEndpoint, redactURL(e))
	}
	return nil
}

// redactURL trims a URL to scheme+host for safe error/log inclusion (no query,
// no path that could carry a token).
func redactURL(raw string) string {
	if i := strings.Index(raw, "?"); i >= 0 {
		raw = raw[:i]
	}
	return raw
}
