package minio

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestObjectKey_Format(t *testing.T) {
	tenant := uuid.MustParse("aaaaaaaa-0000-0000-0000-000000000001")
	ts := time.Date(2026, time.May, 14, 13, 0, 0, 0, time.UTC)
	got := ObjectKey(tenant, ts, "siem-idx-2026.05.14")
	want := "cold/aaaaaaaa-0000-0000-0000-000000000001/2026/05/siem-idx-2026.05.14.ndjson.zst"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestObjectKey_LeadingZeros(t *testing.T) {
	tenant := uuid.New()
	ts := time.Date(2026, time.January, 3, 0, 0, 0, 0, time.UTC)
	got := ObjectKey(tenant, ts, "x")
	if !strings.Contains(got, "/2026/01/") {
		t.Errorf("month not zero-padded: %s", got)
	}
}

func TestObjectKey_ForcesUTC(t *testing.T) {
	tenant := uuid.New()
	// Use a +14h offset zone so that 22:00 UTC-14 (~12:00 UTC) -> day differs
	loc := time.FixedZone("plus14", 14*3600)
	ts := time.Date(2026, time.January, 1, 0, 30, 0, 0, loc) // = 2025-12-31 10:30 UTC
	got := ObjectKey(tenant, ts, "x")
	if !strings.Contains(got, "/2025/12/") {
		t.Errorf("expected UTC-normalised /2025/12/: %s", got)
	}
}

func TestSelfTestKey(t *testing.T) {
	if SelfTestKey() != "__siem_self_test/" {
		t.Errorf("got %q", SelfTestKey())
	}
}
