package storetypes

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestIndexName(t *testing.T) {
	tenant := uuid.MustParse("aaaaaaaa-0000-0000-0000-000000000001")
	ts := time.Date(2026, 5, 14, 12, 0, 0, 0, time.UTC)
	if got := IndexName(tenant, ts); got != "siem-aaaaaaaa-0000-0000-0000-000000000001-2026.05.14" {
		t.Errorf("got %s", got)
	}
}

func TestWriteAlias(t *testing.T) {
	if !strings.HasSuffix(WriteAlias(uuid.New()), "-write") {
		t.Error("suffix")
	}
}

func TestIndexPattern(t *testing.T) {
	if !strings.HasSuffix(IndexPattern(uuid.New()), "-*") {
		t.Error("suffix")
	}
}

func TestTemplateName(t *testing.T) {
	if !strings.HasSuffix(TemplateName(uuid.New()), "-template") {
		t.Error("suffix")
	}
}

func TestTransitKeyName(t *testing.T) {
	if !strings.HasPrefix(TransitKeyName(uuid.New()), "siem-tenant-") {
		t.Error("prefix")
	}
}

func TestNewDEKRef(t *testing.T) {
	tenant := uuid.New()
	ref := NewDEKRef(tenant, "siem-foo-2026.05.14", 3)
	s := string(ref)
	if !strings.Contains(s, "siem-tenant-"+tenant.String()) {
		t.Errorf("missing prefix: %s", s)
	}
	if !strings.HasSuffix(s, "#3") {
		t.Errorf("missing suffix: %s", s)
	}
}

func TestDataClassConstants(t *testing.T) {
	if DataClassSwift != "swift" {
		t.Error("swift")
	}
	if DataClassRTGS != "rtgs" {
		t.Error("rtgs")
	}
	if DataClassPII != "pii" {
		t.Error("pii")
	}
	if DataClassCardholder != "cardholder" {
		t.Error("cardholder")
	}
	if DataClassInternal != "internal" {
		t.Error("internal")
	}
	if DataClassPublic != "public" {
		t.Error("public")
	}
}
