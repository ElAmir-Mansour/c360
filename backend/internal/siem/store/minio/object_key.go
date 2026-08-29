package minio

import (
	"fmt"
	"time"

	"github.com/google/uuid"
)

// ObjectKey builds the canonical cold-tier object key:
//
//	cold/{tenant}/{yyyy}/{mm}/{indexName}.ndjson.zst
//
// The date components come from eventTime.UTC(); callers should always pass
// the document's @timestamp (or its most-recent value) rather than time.Now
// so the object lands in the partition that matches its retention class.
func ObjectKey(tenantID uuid.UUID, eventTime time.Time, indexName string) string {
	t := eventTime.UTC()
	return fmt.Sprintf("cold/%s/%04d/%02d/%s.ndjson.zst",
		tenantID, t.Year(), int(t.Month()), indexName)
}

// SelfTestKey returns the canonical self-test sentinel prefix used by
// BucketHealthy probes.
func SelfTestKey() string { return "__siem_self_test/" }
