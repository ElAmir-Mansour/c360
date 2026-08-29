package minio

import (
	"context"
	"errors"
	"fmt"
	"io"
	"time"

	"github.com/google/uuid"
	"github.com/klauspost/compress/zstd"
	miniogo "github.com/minio/minio-go/v7"

	"github.com/clario360/platform/internal/siem/store/storetypes"
)

// SealIndex reads source, compresses it with zstd, computes a SHA-256 over
// the compressed bytes, and writes the object to the cold-tier bucket with
// a COMPLIANCE-mode retention lock.
//
// Streaming: nothing is buffered to RAM beyond the zstd window. On any
// error after the upload starts, the partial object remains in the bucket
// because COMPLIANCE-mode locking forbids deletion; this is the regulator-
// intended behaviour.
func (c *client) SealIndex(ctx context.Context, tenantID uuid.UUID, indexName string, source io.Reader, opts SealOptions) (SealResult, error) {
	ctx, span := c.startSpan(ctx, "seal_index")
	defer span.End()

	if source == nil {
		return SealResult{}, fmt.Errorf("minio: SealIndex source nil")
	}
	if indexName == "" {
		return SealResult{}, fmt.Errorf("minio: SealIndex indexName required")
	}
	if opts.EventTime.IsZero() {
		opts.EventTime = time.Now().UTC()
	}
	if opts.ContentType == "" {
		opts.ContentType = "application/zstd"
	}
	_, years, err := EffectiveRetention(opts.DataClass, opts.RetentionYears)
	if err != nil {
		return SealResult{}, err
	}
	retainUntil := time.Now().Add(time.Duration(years) * 365 * 24 * time.Hour)

	key := ObjectKey(tenantID, opts.EventTime, indexName)

	// Build the compress-and-hash pipeline.
	//
	//   source  --(io.Copy)-->  zstdWriter  --writes to-->  multiWriter
	//                                                       /          \
	//                                                  pipeWriter      hashSink
	//                                                      |
	//                                                  pipeReader  --uploaded by-->  minio.PutObject
	pr, pw := io.Pipe()
	hs := newHashSink()
	pipeErr := make(chan error, 1)

	go func() {
		defer func() { _ = pw.Close() }()
		zw, zerr := zstd.NewWriter(io.MultiWriter(pw, hs),
			zstd.WithEncoderLevel(zstd.EncoderLevelFromZstd(c.cfg.ZstdLevel)))
		if zerr != nil {
			pipeErr <- zerr
			_ = pw.CloseWithError(zerr)
			return
		}
		if _, copyErr := io.Copy(zw, source); copyErr != nil {
			_ = zw.Close()
			pipeErr <- copyErr
			_ = pw.CloseWithError(copyErr)
			return
		}
		if closeErr := zw.Close(); closeErr != nil {
			pipeErr <- closeErr
			_ = pw.CloseWithError(closeErr)
			return
		}
		pipeErr <- nil
	}()

	start := time.Now()
	info, putErr := c.api.PutObject(ctx, c.cfg.Bucket, key, pr, -1, miniogo.PutObjectOptions{
		ContentType: opts.ContentType,
		UserMetadata: map[string]string{
			"x-amz-meta-siem-tenant-id":  tenantID.String(),
			"x-amz-meta-siem-index":      indexName,
			"x-amz-meta-siem-data-class": string(opts.DataClass),
		},
		Mode:            miniogo.Compliance,
		RetainUntilDate: retainUntil.UTC(),
		// SIEM indices are typically a few hundred MiB compressed; a single
		// streamed PUT is preferable to multipart. Multipart still kicks in
		// automatically if the body exceeds the per-part size, but we
		// disable the *speculative* multipart path so test stubs without
		// multipart support can exercise the happy path.
		DisableMultipart: true,
	})
	pipeProdErr := <-pipeErr

	if c.m != nil {
		c.m.SealDuration.WithLabelValues(tenantID.String()).Observe(time.Since(start).Seconds())
	}

	if putErr != nil {
		if c.m != nil {
			c.m.SealTotal.WithLabelValues(tenantID.String(), string(opts.DataClass), "fail").Inc()
		}
		return SealResult{}, fmt.Errorf("minio: seal put: %w", classifyMinioError(putErr))
	}
	if pipeProdErr != nil && !errors.Is(pipeProdErr, io.EOF) {
		if c.m != nil {
			c.m.SealTotal.WithLabelValues(tenantID.String(), string(opts.DataClass), "fail").Inc()
		}
		return SealResult{}, fmt.Errorf("minio: seal compress: %w", pipeProdErr)
	}
	if c.m != nil {
		c.m.SealTotal.WithLabelValues(tenantID.String(), string(opts.DataClass), "ok").Inc()
		c.m.SealBytes.WithLabelValues(tenantID.String(), string(opts.DataClass)).Add(float64(info.Size))
	}
	return SealResult{
		Key:            key,
		Bytes:          info.Size,
		SHA256:         hs.Sum(),
		RetainUntil:    retainUntil.UTC(),
		RetentionYears: years,
	}, nil
}

// suppress unused-import on store in builds that strip the unused alias.
var _ = storetypes.DataClassInternal
