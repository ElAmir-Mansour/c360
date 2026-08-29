package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// loadSourcesConfig parses the SIEM-03 env vars per PROMPT3.MD §4.11.
// Validation: durations must parse; thresholds must be parseable as
// floats; instance ID is non-empty (falls back to hostname).
func loadSourcesConfig(envFn func(string) string) (SourcesConfig, error) {
	if envFn == nil {
		envFn = func(string) string { return "" }
	}
	getOpt := func(k, fallback string) string {
		if v := envFn(k); v != "" {
			return v
		}
		return fallback
	}
	getDur := func(k string, fallback time.Duration) (time.Duration, error) {
		v := envFn(k)
		if v == "" {
			return fallback, nil
		}
		if n, err := strconv.Atoi(v); err == nil {
			return time.Duration(n) * time.Second, nil
		}
		d, err := time.ParseDuration(v)
		if err != nil {
			return 0, fmt.Errorf("%s: %w", k, err)
		}
		return d, nil
	}
	getInt := func(k string, fallback int) (int, error) {
		v := envFn(k)
		if v == "" {
			return fallback, nil
		}
		n, err := strconv.Atoi(v)
		if err != nil {
			return 0, fmt.Errorf("%s: %w", k, err)
		}
		return n, nil
	}
	getFloat := func(k string, fallback float64) (float64, error) {
		v := envFn(k)
		if v == "" {
			return fallback, nil
		}
		f, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return 0, fmt.Errorf("%s: %w", k, err)
		}
		return f, nil
	}

	leafTTL, err := getDur("SIEM_PKI_LEAF_TTL", 8760*time.Hour)
	if err != nil {
		return SourcesConfig{}, err
	}
	rotWindow, err := getDur("SIEM_PKI_LEAF_ROTATION_WINDOW", 720*time.Hour)
	if err != nil {
		return SourcesConfig{}, err
	}
	overlap, err := getDur("SIEM_PKI_LEAF_OVERLAP", 5*time.Minute)
	if err != nil {
		return SourcesConfig{}, err
	}
	tokTTL, err := getDur("SIEM_ENROLL_TOKEN_TTL", 15*time.Minute)
	if err != nil {
		return SourcesConfig{}, err
	}
	dInterval, err := getDur("SIEM_DETECTOR_INTERVAL", time.Minute)
	if err != nil {
		return SourcesConfig{}, err
	}
	dGap, err := getDur("SIEM_DETECTOR_HEARTBEAT_GAP", 5*time.Minute)
	if err != nil {
		return SourcesConfig{}, err
	}
	epsRetention, err := getDur("SIEM_EPS_SAMPLES_RETENTION", 168*time.Hour)
	if err != nil {
		return SourcesConfig{}, err
	}
	idemTTL, err := getDur("SIEM_IDEMPOTENCY_TTL", 24*time.Hour)
	if err != nil {
		return SourcesConfig{}, err
	}
	baselineMin, err := getInt("SIEM_DETECTOR_BASELINE_MIN_SAMPLES", 60)
	if err != nil {
		return SourcesConfig{}, err
	}
	drift, err := getFloat("SIEM_DETECTOR_DRIFT_THRESHOLD", -0.50)
	if err != nil {
		return SourcesConfig{}, err
	}
	recovery, err := getFloat("SIEM_DETECTOR_RECOVERY_THRESHOLD", -0.30)
	if err != nil {
		return SourcesConfig{}, err
	}
	rate, err := getInt("SIEM_HEARTBEAT_RATE_LIMIT_PER_MIN", 6)
	if err != nil {
		return SourcesConfig{}, err
	}

	instance := getOpt("SIEM_INSTANCE_ID", "")
	if instance == "" {
		h, herr := os.Hostname()
		if herr != nil || h == "" {
			h = "siem-service-unknown"
		}
		instance = h
	}

	return SourcesConfig{
		MTLSListenAddr:            getOpt("SIEM_MTLS_LISTEN_ADDR", ":8095"),
		MTLSCABundlePath:          getOpt("SIEM_MTLS_CA_BUNDLE_PATH", ""),
		MTLSServerCertPath:        getOpt("SIEM_MTLS_SERVER_CERT_PATH", ""),
		MTLSServerKeyPath:         getOpt("SIEM_MTLS_SERVER_KEY_PATH", ""),
		PKIRootMount:              getOpt("SIEM_PKI_ROOT_MOUNT", "pki-siem-root"),
		PKIIntermediatePrefix:     getOpt("SIEM_PKI_INTERMEDIATE_PREFIX", "pki-siem-intermediate-"),
		PKILeafTTL:                leafTTL,
		PKILeafRotationWindow:     rotWindow,
		PKILeafOverlap:            overlap,
		EnrollTokenTTL:            tokTTL,
		EnrollTokenKeyName:        getOpt("SIEM_ENROLL_TOKEN_KEY_NAME", "siem-enrollment-jwt"),
		EnrollTokenPrivateKeyB64:  getOpt("SIEM_ENROLL_TOKEN_PRIVATE_KEY_B64", ""),
		EnrollTokenPrivateKeyPath: getOpt("SIEM_ENROLL_TOKEN_PRIVATE_KEY_PATH", ""),
		DetectorInterval:          dInterval,
		DetectorBaselineMin:       baselineMin,
		DetectorDriftThreshold:    drift,
		DetectorRecoveryThreshold: recovery,
		DetectorHeartbeatGap:      dGap,
		EPSSamplesRetention:       epsRetention,
		HeartbeatRateLimitPerMin:  rate,
		IdempotencyTTL:            idemTTL,
		InstanceID:                instance,
	}, nil
}
