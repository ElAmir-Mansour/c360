package config

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// loadStoreConfig parses the SIEM_* env vars that drive the SIEM-02
// storage layer. envFn is the same get-hook used by LoadWith so tests can
// inject a deterministic environment.
//
// Validation rules:
//   - SIEM_OPENSEARCH_INSECURE_TLS=true && SIEM_ENV=prod  → error.
//   - SIEM_VAULT_AUTH_METHOD=token     && SIEM_ENV=prod  → handled by vault.ConfigFromEnv;
//     repeated here only when the prod-token combination is detectable from the
//     siem-service vantage point.
//   - SIEM_MINIO_SECRET_KEY masked in String().
func loadStoreConfig(envFn func(string) string, environment string) (StoreConfig, error) {
	get := envFn
	if get == nil {
		get = func(string) string { return "" }
	}
	siemEnv := strings.ToLower(strings.TrimSpace(get("SIEM_ENV")))
	if siemEnv == "" {
		// Map SIEM_ENVIRONMENT shorthand into SIEM_ENV semantics.
		switch strings.ToLower(environment) {
		case "prod", "production":
			siemEnv = "prod"
		default:
			siemEnv = "dev"
		}
	}

	addresses := splitTrim(envOr(get, "SIEM_OPENSEARCH_URL", ""), ",")
	insecureTLS, err := envBool(get, "SIEM_OPENSEARCH_INSECURE_TLS", false)
	if err != nil {
		return StoreConfig{}, err
	}
	if insecureTLS && siemEnv == "prod" {
		return StoreConfig{}, fmt.Errorf("SIEM_OPENSEARCH_INSECURE_TLS=true is not permitted when SIEM_ENV=prod")
	}
	maxBulk, err := envInt(get, "SIEM_OPENSEARCH_MAX_BULK_BYTES", 5*1024*1024)
	if err != nil {
		return StoreConfig{}, err
	}

	bucket := envOr(get, "SIEM_MINIO_BUCKET", "siem-cold")
	wormBucket := envOr(get, "SIEM_MINIO_WORM_SELF_TEST_BUCKET", "siem-cold-test")
	zstdLevel, err := envInt(get, "SIEM_MINIO_ZSTD_LEVEL", 19)
	if err != nil {
		return StoreConfig{}, err
	}
	useSSL, err := envBool(get, "SIEM_MINIO_USE_SSL", false)
	if err != nil {
		return StoreConfig{}, err
	}
	skipSSE, err := envBool(get, "SIEM_MINIO_SKIP_SSE_CHECK", false)
	if err != nil {
		return StoreConfig{}, err
	}

	dekTTL, err := envDuration(get, "SIEM_DEK_CACHE_TTL", 30*time.Minute)
	if err != nil {
		return StoreConfig{}, err
	}
	dekMax, err := envInt(get, "SIEM_DEK_CACHE_MAX", 1024)
	if err != nil {
		return StoreConfig{}, err
	}

	selfTestEnabled, err := envBool(get, "SIEM_SELF_TEST_ENABLED", siemEnv != "prod")
	if err != nil {
		return StoreConfig{}, err
	}

	if vaultAuth := strings.ToLower(strings.TrimSpace(get("SIEM_VAULT_AUTH_METHOD"))); vaultAuth == "token" && siemEnv == "prod" {
		return StoreConfig{}, fmt.Errorf("SIEM_VAULT_AUTH_METHOD=token is not permitted when SIEM_ENV=prod")
	}

	return StoreConfig{
		OpenSearchAddresses:            addresses,
		OpenSearchUsername:             get("SIEM_OPENSEARCH_USERNAME"),
		OpenSearchPassword:             get("SIEM_OPENSEARCH_PASSWORD"),
		OpenSearchInsecureTLS:          insecureTLS,
		OpenSearchHealthMinStatus:      envOr(get, "SIEM_OPENSEARCH_HEALTH_MIN", "yellow"),
		OpenSearchMaxBulkBytes:         maxBulk,
		OpenSearchRolloverMaxAge:       envOr(get, "SIEM_OPENSEARCH_ROLLOVER_MAX_AGE", "24h"),
		OpenSearchRolloverMaxShardSize: envOr(get, "SIEM_OPENSEARCH_ROLLOVER_MAX_SHARD_SIZE", "50gb"),
		MinIOEndpoint:                  envOr(get, "SIEM_MINIO_ENDPOINT", "localhost:9010"),
		MinIOAccessKey:                 get("SIEM_MINIO_ACCESS_KEY"),
		MinIOSecretKey:                 get("SIEM_MINIO_SECRET_KEY"),
		MinIOUseSSL:                    useSSL,
		MinIORegion:                    envOr(get, "SIEM_MINIO_REGION", "us-east-1"),
		MinIOBucket:                    bucket,
		MinIOWORMSelfTestBucket:        wormBucket,
		MinIOZstdLevel:                 zstdLevel,
		MinIOSkipSSECheck:              skipSSE,
		DEKCacheTTL:                    dekTTL,
		DEKCacheMaxEntries:             dekMax,
		SelfTestEnabled:                selfTestEnabled,
		Environment:                    siemEnv,
	}, nil
}

// String returns a diagnostic representation that masks all secret values.
func (s StoreConfig) String() string {
	osAddrs := strings.Join(s.OpenSearchAddresses, ",")
	return fmt.Sprintf(
		"StoreConfig{OS=[%s],OSUser=%s,OSPass=[REDACTED],InsecureTLS=%t,HealthMin=%s,MaxBulk=%d,"+
			"MinIO=%s,Bucket=%s,WORM=%s,SSL=%t,SkipSSE=%t,AccessKey=%s,SecretKey=[REDACTED],"+
			"Zstd=%d,DEK_TTL=%s,DEK_Max=%d,SelfTest=%t,Env=%s}",
		osAddrs, s.OpenSearchUsername,
		s.OpenSearchInsecureTLS, s.OpenSearchHealthMinStatus, s.OpenSearchMaxBulkBytes,
		s.MinIOEndpoint, s.MinIOBucket, s.MinIOWORMSelfTestBucket, s.MinIOUseSSL, s.MinIOSkipSSECheck,
		s.MinIOAccessKey, s.MinIOZstdLevel,
		s.DEKCacheTTL, s.DEKCacheMaxEntries, s.SelfTestEnabled, s.Environment,
	)
}

// ---- internal helpers ----

func envOr(get func(string) string, key, fallback string) string {
	if v := strings.TrimSpace(get(key)); v != "" {
		return v
	}
	return fallback
}

func envInt(get func(string) string, key string, fallback int) (int, error) {
	v := strings.TrimSpace(get(key))
	if v == "" {
		return fallback, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return 0, fmt.Errorf("%s: invalid integer %q: %w", key, v, err)
	}
	return n, nil
}

func envBool(get func(string) string, key string, fallback bool) (bool, error) {
	v := strings.TrimSpace(get(key))
	if v == "" {
		return fallback, nil
	}
	b, err := strconv.ParseBool(v)
	if err != nil {
		return false, fmt.Errorf("%s: invalid bool %q: %w", key, v, err)
	}
	return b, nil
}

func envDuration(get func(string) string, key string, fallback time.Duration) (time.Duration, error) {
	v := strings.TrimSpace(get(key))
	if v == "" {
		return fallback, nil
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return 0, fmt.Errorf("%s: invalid duration %q: %w", key, v, err)
	}
	return d, nil
}
