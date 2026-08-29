package store_test

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/siem/store"
)

func TestIndexName(t *testing.T) {
	tenant := uuid.MustParse("aaaaaaaa-0000-0000-0000-000000000001")
	ts := time.Date(2026, 5, 14, 12, 0, 0, 0, time.UTC)
	got := store.IndexName(tenant, ts)
	want := "siem-aaaaaaaa-0000-0000-0000-000000000001-2026.05.14"
	if got != want {
		t.Errorf("got %s want %s", got, want)
	}
}

func TestWriteAlias(t *testing.T) {
	tenant := uuid.MustParse("aaaaaaaa-0000-0000-0000-000000000001")
	if got, want := store.WriteAlias(tenant), "siem-aaaaaaaa-0000-0000-0000-000000000001-write"; got != want {
		t.Errorf("got %s want %s", got, want)
	}
}

func TestIndexPattern(t *testing.T) {
	tenant := uuid.MustParse("aaaaaaaa-0000-0000-0000-000000000001")
	if got := store.IndexPattern(tenant); !strings.HasSuffix(got, "-*") {
		t.Errorf("pattern should end with -*: %s", got)
	}
}

func TestTransitKeyName(t *testing.T) {
	tenant := uuid.MustParse("aaaaaaaa-0000-0000-0000-000000000001")
	if got := store.TransitKeyName(tenant); !strings.HasPrefix(got, "siem-tenant-") {
		t.Errorf("transit key name = %s", got)
	}
}

func TestTemplateName(t *testing.T) {
	tenant := uuid.MustParse("aaaaaaaa-0000-0000-0000-000000000001")
	if got := store.TemplateName(tenant); !strings.HasSuffix(got, "-template") {
		t.Errorf("got %s", got)
	}
}

func TestNewDEKRef(t *testing.T) {
	tenant := uuid.MustParse("aaaaaaaa-0000-0000-0000-000000000001")
	ref := store.NewDEKRef(tenant, "siem-idx-2026.05.14", 7)
	want := "siem-tenant-aaaaaaaa-0000-0000-0000-000000000001/siem-idx-2026.05.14#7"
	if string(ref) != want {
		t.Errorf("got %s want %s", ref, want)
	}
}

func TestDataClassConstants(t *testing.T) {
	if store.DataClassSwift != "swift" || store.DataClassRTGS != "rtgs" || store.DataClassPII != "pii" {
		t.Error("data class aliases broke")
	}
}
