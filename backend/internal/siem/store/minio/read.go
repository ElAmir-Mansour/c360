package minio

import (
	"context"
	"fmt"
	"io"

	miniogo "github.com/minio/minio-go/v7"
)

// Get returns an open ReadCloser for the object plus its metadata.
func (c *client) Get(ctx context.Context, key string) (io.ReadCloser, ObjectInfo, error) {
	ctx, span := c.startSpan(ctx, "get")
	defer span.End()

	obj, err := c.api.GetObject(ctx, c.cfg.Bucket, key, miniogo.GetObjectOptions{})
	if err != nil {
		if c.m != nil {
			c.m.GetTotal.WithLabelValues("fail").Inc()
		}
		return nil, ObjectInfo{}, fmt.Errorf("minio: get: %w", classifyMinioError(err))
	}
	stat, err := obj.Stat()
	if err != nil {
		_ = obj.Close()
		if c.m != nil {
			c.m.GetTotal.WithLabelValues("fail").Inc()
		}
		return nil, ObjectInfo{}, fmt.Errorf("minio: stat: %w", classifyMinioError(err))
	}
	if c.m != nil {
		c.m.GetTotal.WithLabelValues("ok").Inc()
	}
	return obj, toObjectInfo(stat), nil
}

// Stat fetches metadata without opening the body.
func (c *client) Stat(ctx context.Context, key string) (ObjectInfo, error) {
	ctx, span := c.startSpan(ctx, "stat")
	defer span.End()

	stat, err := c.api.StatObject(ctx, c.cfg.Bucket, key, miniogo.StatObjectOptions{})
	if err != nil {
		if c.m != nil {
			c.m.GetTotal.WithLabelValues("fail").Inc()
		}
		return ObjectInfo{}, fmt.Errorf("minio: stat: %w", classifyMinioError(err))
	}
	if c.m != nil {
		c.m.GetTotal.WithLabelValues("ok").Inc()
	}
	return toObjectInfo(stat), nil
}

func toObjectInfo(o miniogo.ObjectInfo) ObjectInfo {
	meta := map[string]string{}
	for k, vs := range o.UserMetadata {
		meta[k] = vs
	}
	return ObjectInfo{
		Key:          o.Key,
		Size:         o.Size,
		ContentType:  o.ContentType,
		ETag:         o.ETag,
		LastModified: o.LastModified,
		UserMetadata: meta,
	}
}
