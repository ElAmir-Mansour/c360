package minio

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"hash"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	miniogo "github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/clario360/platform/internal/siem/store/storetypes"
)

// Config bundles the runtime configuration for the MinIO wrapper.
type Config struct {
	// Endpoint is "host:port" without scheme.
	Endpoint string
	// AccessKey / SecretKey are the credentials.
	AccessKey string
	SecretKey string
	// UseSSL toggles HTTPS.
	UseSSL bool
	// Region is the bucket region. Defaults to "us-east-1" (MinIO default).
	Region string
	// Bucket is the production cold-tier bucket name.
	Bucket string
	// WORMSelfTestBucket is the ephemeral bucket used by WORMSelfTest. It
	// must be distinct from Bucket.
	WORMSelfTestBucket string
	// ZstdLevel is the compression level (1-22). Defaults to 19.
	ZstdLevel int
	// SkipServerSideEncryptionCheck disables the BucketHealthy probe's
	// SSE check. Default false; tests sometimes flip this to true on a
	// vanilla MinIO that has no bucket encryption configured.
	SkipServerSideEncryptionCheck bool
}

// Client is the SIEM-02 MinIO facade.
type Client interface {
	SealIndex(ctx context.Context, tenantID uuid.UUID, indexName string,
		source io.Reader, opts SealOptions) (SealResult, error)
	Get(ctx context.Context, key string) (io.ReadCloser, ObjectInfo, error)
	Stat(ctx context.Context, key string) (ObjectInfo, error)
	BucketHealthy(ctx context.Context) error
	WORMSelfTest(ctx context.Context) error
	HealthChecker() *HealthCheckerAdapter
	Close() error
}

// SealOptions controls a SealIndex call.
type SealOptions struct {
	DataClass      storetypes.DataClass
	RetentionYears int       // 0 = use class default
	ContentType    string    // defaults to "application/zstd"
	EventTime      time.Time // determines yyyy/mm in the key
}

// SealResult is returned by SealIndex.
type SealResult struct {
	Key            string    `json:"key"`
	Bytes          int64     `json:"bytes"`
	SHA256         string    `json:"sha256"`
	RetainUntil    time.Time `json:"retain_until"`
	RetentionYears int       `json:"retention_years"`
}

// ObjectInfo trims down minio.ObjectInfo to what callers need.
type ObjectInfo struct {
	Key          string
	Size         int64
	ContentType  string
	ETag         string
	LastModified time.Time
	UserMetadata map[string]string
}

// client implements Client.
type client struct {
	cfg    Config
	api    *miniogo.Client
	log    *zerolog.Logger
	tracer trace.Tracer
	m      *Metrics
}

// NewClient builds a Client from cfg.
func NewClient(ctx context.Context, cfg Config, log *zerolog.Logger, reg prometheus.Registerer) (Client, error) {
	if cfg.Endpoint == "" {
		return nil, fmt.Errorf("minio: endpoint required")
	}
	if cfg.Bucket == "" {
		return nil, fmt.Errorf("minio: bucket required")
	}
	if cfg.Region == "" {
		cfg.Region = "us-east-1"
	}
	if cfg.ZstdLevel <= 0 {
		cfg.ZstdLevel = 19
	}
	if cfg.WORMSelfTestBucket == "" {
		cfg.WORMSelfTestBucket = "siem-cold-test"
	}
	if cfg.WORMSelfTestBucket == cfg.Bucket {
		return nil, fmt.Errorf("minio: WORMSelfTestBucket must differ from Bucket")
	}

	api, err := miniogo.New(cfg.Endpoint, &miniogo.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: cfg.UseSSL,
		Region: cfg.Region,
	})
	if err != nil {
		return nil, fmt.Errorf("minio: new client: %w", err)
	}
	return &client{
		cfg:    cfg,
		api:    api,
		log:    log,
		tracer: otel.Tracer("github.com/clario360/platform/internal/siem/store/minio"),
		m:      NewMetrics(reg),
	}, nil
}

func (c *client) Close() error { return nil }

func (c *client) HealthChecker() *HealthCheckerAdapter {
	return &HealthCheckerAdapter{client: c, bucket: c.cfg.Bucket, endpoint: c.cfg.Endpoint}
}

// startSpan starts an OTEL span tagged with op + bucket.
func (c *client) startSpan(ctx context.Context, op string) (context.Context, trace.Span) {
	return c.tracer.Start(ctx, "minio."+op, trace.WithAttributes(
		attribute.String("bucket", c.cfg.Bucket),
		attribute.String("endpoint", c.cfg.Endpoint),
	))
}

// hashSink is an io.Writer that updates a SHA-256 hash and discards bytes.
type hashSink struct{ h hash.Hash }

func newHashSink() *hashSink                    { return &hashSink{h: sha256.New()} }
func (s *hashSink) Write(p []byte) (int, error) { return s.h.Write(p) }
func (s *hashSink) Sum() string                 { return hex.EncodeToString(s.h.Sum(nil)) }

// classifyMinioError maps minio-go errors to our sentinels.
func classifyMinioError(err error) error {
	if err == nil {
		return nil
	}
	resp := miniogo.ToErrorResponse(err)
	switch {
	case resp.Code == "NoSuchBucket":
		return fmt.Errorf("%w: %s", ErrBucketMissing, err.Error())
	case resp.Code == "NoSuchKey", resp.StatusCode == http.StatusNotFound:
		return fmt.Errorf("%w: %s", ErrObjectNotFound, err.Error())
	case isWORMError(resp):
		return fmt.Errorf("%w: %s", ErrObjectLocked, err.Error())
	}
	return err
}

// isWORMError detects responses that signal a WORM-blocked operation.
// minio-go reports these with various Code values (e.g. "AccessDenied"
// with a message body containing "WORM" / "Object Lock", or a dedicated
// "InvalidRetentionPeriod"). We string-match on the message because the
// upstream code values are not exhaustively documented.
func isWORMError(resp miniogo.ErrorResponse) bool {
	msg := strings.ToLower(resp.Message)
	if resp.StatusCode != 0 && resp.StatusCode != http.StatusOK {
		if strings.Contains(msg, "worm") || strings.Contains(msg, "object lock") ||
			strings.Contains(msg, "retention") || resp.Code == "InvalidRetentionPeriod" {
			return true
		}
	}
	return false
}

// errCheck collapses errors.Is on a sentinel into a one-liner.
func errCheck(err error, target error) bool { return errors.Is(err, target) }
