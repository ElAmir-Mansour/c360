package minio

import (
	"context"
	"fmt"
	"strings"
	"time"

	miniogo "github.com/minio/minio-go/v7"

	"github.com/clario360/platform/internal/observability/health"
)

// BucketHealthy performs two probes against c.cfg.Bucket:
//
//  1. List objects under __siem_self_test/ — expect ≥ 1 sentinel.
//  2. GetBucketEncryption — expect SSE configured (unless
//     Config.SkipServerSideEncryptionCheck is true).
//
// Returns ErrSentinelMissing / ErrEncryptionMisconfigured on failure. Both
// errors are wrapped with %w so callers can errors.Is them.
func (c *client) BucketHealthy(ctx context.Context) error {
	ctx, span := c.startSpan(ctx, "bucket_healthy")
	defer span.End()

	// Sentinel probe.
	sentinelOK := false
	objCh := c.api.ListObjects(ctx, c.cfg.Bucket, miniogo.ListObjectsOptions{
		Prefix:    SelfTestKey(),
		MaxKeys:   1,
		Recursive: true,
	})
	for o := range objCh {
		if o.Err != nil {
			if c.m != nil {
				c.m.BucketHealthyStatus.WithLabelValues(c.cfg.Bucket).Set(0)
			}
			return fmt.Errorf("minio: list sentinel: %w", classifyMinioError(o.Err))
		}
		sentinelOK = true
		break
	}
	if !sentinelOK {
		if c.m != nil {
			c.m.BucketHealthyStatus.WithLabelValues(c.cfg.Bucket).Set(0)
		}
		return fmt.Errorf("%w: bucket=%s", ErrSentinelMissing, c.cfg.Bucket)
	}

	// SSE probe (optional).
	if !c.cfg.SkipServerSideEncryptionCheck {
		_, err := c.api.GetBucketEncryption(ctx, c.cfg.Bucket)
		if err != nil {
			if c.m != nil {
				c.m.BucketHealthyStatus.WithLabelValues(c.cfg.Bucket).Set(0)
			}
			return fmt.Errorf("%w: %v", ErrEncryptionMisconfigured, err)
		}
	}

	if c.m != nil {
		c.m.BucketHealthyStatus.WithLabelValues(c.cfg.Bucket).Set(1)
	}
	return nil
}

// WORMSelfTest writes a tiny sentinel object to c.cfg.WORMSelfTestBucket
// with a 60-second compliance-mode retention, immediately attempts to
// delete it, and asserts that the delete failed with a WORM-protected
// error. Returns ErrWORMSelfTestFailed on any deviation.
//
// The function never touches c.cfg.Bucket (the production cold tier).
func (c *client) WORMSelfTest(ctx context.Context) error {
	ctx, span := c.startSpan(ctx, "worm_self_test")
	defer span.End()

	bucket := c.cfg.WORMSelfTestBucket
	// Ensure the test bucket exists with object-lock. Errors are tolerated
	// because operators may pre-provision the bucket out-of-band.
	exists, err := c.api.BucketExists(ctx, bucket)
	if err != nil {
		if c.m != nil {
			c.m.WORMSelfTestTotal.WithLabelValues("fail").Inc()
		}
		return fmt.Errorf("minio: worm self-test exists: %w", classifyMinioError(err))
	}
	if !exists {
		if err := c.api.MakeBucket(ctx, bucket, miniogo.MakeBucketOptions{
			Region:        c.cfg.Region,
			ObjectLocking: true,
		}); err != nil {
			if c.m != nil {
				c.m.WORMSelfTestTotal.WithLabelValues("fail").Inc()
			}
			return fmt.Errorf("minio: worm self-test mkbucket: %w", classifyMinioError(err))
		}
	}

	objectKey := fmt.Sprintf("worm-self-test/%d.txt", time.Now().UnixNano())
	retainUntil := time.Now().Add(60 * time.Second)

	if _, err := c.api.PutObject(ctx, bucket, objectKey,
		strings.NewReader("siem-02 self-test"), int64(len("siem-02 self-test")),
		miniogo.PutObjectOptions{
			ContentType:     "text/plain",
			Mode:            miniogo.Compliance,
			RetainUntilDate: retainUntil.UTC(),
		}); err != nil {
		if c.m != nil {
			c.m.WORMSelfTestTotal.WithLabelValues("fail").Inc()
		}
		return fmt.Errorf("minio: worm self-test put: %w", classifyMinioError(err))
	}

	// Now try to delete it; this MUST fail.
	rmErr := c.api.RemoveObject(ctx, bucket, objectKey, miniogo.RemoveObjectOptions{})
	if rmErr == nil {
		if c.m != nil {
			c.m.WORMSelfTestTotal.WithLabelValues("fail").Inc()
		}
		return fmt.Errorf("%w: delete unexpectedly succeeded", ErrWORMSelfTestFailed)
	}
	// Accept either our own ErrObjectLocked OR a substring match — different
	// MinIO versions wrap the message slightly differently.
	wrapped := classifyMinioError(rmErr)
	if wrapped == nil ||
		(!errCheckTarget(wrapped, ErrObjectLocked) &&
			!strings.Contains(strings.ToLower(rmErr.Error()), "worm") &&
			!strings.Contains(strings.ToLower(rmErr.Error()), "retention") &&
			!strings.Contains(strings.ToLower(rmErr.Error()), "object lock")) {
		if c.m != nil {
			c.m.WORMSelfTestTotal.WithLabelValues("fail").Inc()
		}
		return fmt.Errorf("%w: unexpected delete error: %v", ErrWORMSelfTestFailed, rmErr)
	}

	if c.m != nil {
		c.m.WORMSelfTestTotal.WithLabelValues("ok").Inc()
	}
	return nil
}

func errCheckTarget(err error, target error) bool {
	return err != nil && target != nil && (err.Error() == target.Error() ||
		strings.Contains(err.Error(), target.Error()))
}

// HealthCheckerAdapter adapts a Client into the platform health.HealthChecker.
type HealthCheckerAdapter struct {
	client   Client
	bucket   string
	endpoint string
}

// Name implements health.HealthChecker.
func (h *HealthCheckerAdapter) Name() string { return "minio_object_lock" }

// Check implements health.HealthChecker.
func (h *HealthCheckerAdapter) Check(ctx context.Context) health.HealthResult {
	details := map[string]interface{}{
		"bucket":   h.bucket,
		"endpoint": h.endpoint,
	}
	if err := h.client.BucketHealthy(ctx); err != nil {
		return health.HealthResult{
			Status:  "unhealthy",
			Error:   err.Error(),
			Details: details,
		}
	}
	return health.HealthResult{Status: "healthy", Details: details}
}
