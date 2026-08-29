package attestledger

import (
	"strings"
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

func TestMetrics_NilIsNoOp(t *testing.T) {
	t.Parallel()
	var m *Metrics
	// None of these must panic on a nil receiver.
	m.IncAppended("cleanroom_verdict")
	m.IncVerify(true)
	m.IncAnchored(3)
}

func TestMetrics_RecordsSeries(t *testing.T) {
	t.Parallel()
	reg := prometheus.NewRegistry()
	m := NewMetrics(reg)

	m.IncAppended("failover_attestation")
	m.IncAppended("failover_attestation")
	m.IncVerify(false)
	m.IncAnchored(5)

	if got := testutil.ToFloat64(m.appended.WithLabelValues("failover_attestation")); got != 2 {
		t.Fatalf("appended counter = %v, want 2", got)
	}
	if got := testutil.ToFloat64(m.verifyResult.WithLabelValues("broken")); got != 1 {
		t.Fatalf("verify broken counter = %v, want 1", got)
	}
	if got := testutil.ToFloat64(m.anchored); got != 1 {
		t.Fatalf("anchored counter = %v, want 1", got)
	}
	if got := testutil.ToFloat64(m.anchoredEntries); got != 5 {
		t.Fatalf("anchored entries counter = %v, want 5", got)
	}

	// The series names must be exposed (registry scrape contract).
	families, err := reg.Gather()
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, f := range families {
		names = append(names, f.GetName())
	}
	joined := strings.Join(names, ",")
	for _, want := range []string{
		"dr_attestation_ledger_appended_total",
		"dr_attestation_ledger_verify_total",
		"dr_attestation_ledger_anchored_checkpoints_total",
		"dr_attestation_ledger_anchored_entries_total",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("metric %s not registered (have %s)", want, joined)
		}
	}
}
