package ransomware

import (
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"
)

func TestMetrics_NilSafe(t *testing.T) {
	t.Parallel()
	var m *Metrics // nil
	// None of these must panic on a nil receiver.
	m.IncSignal("s", SignalEntropy)
	m.IncConfirmed("s")
	m.SetEntropy("s", 7.5)
	m.IncCurated()
}

func TestMetrics_PrivateRegistryWhenNil(t *testing.T) {
	t.Parallel()
	// A nil registerer must not panic (per-instance private registry).
	m := NewMetrics(nil)
	if m == nil {
		t.Fatal("NewMetrics(nil) returned nil")
	}
	m.IncSignal("s", SignalEntropy)
}

func TestMetrics_SignalCounterLabeled(t *testing.T) {
	t.Parallel()
	reg := prometheus.NewRegistry()
	m := NewMetrics(reg)

	m.IncSignal("stream-1", SignalEntropy)
	m.IncSignal("stream-1", SignalEntropy)
	m.IncSignal("stream-1", SignalByteRate)
	m.IncConfirmed("stream-1")
	m.SetEntropy("stream-1", 7.9)
	m.IncCurated()

	mfs, err := reg.Gather()
	if err != nil {
		t.Fatalf("gather: %v", err)
	}
	got := map[string]float64{}
	entropyGauge := map[string]float64{}
	var curated float64
	for _, mf := range mfs {
		switch mf.GetName() {
		case "dr_ransomware_signal":
			for _, mc := range mf.Metric {
				got[labelValue(mc, "stream")+"/"+labelValue(mc, "kind")] = mc.GetCounter().GetValue()
			}
		case "dr_ransomware_entropy_bits":
			for _, mc := range mf.Metric {
				entropyGauge[labelValue(mc, "stream")] = mc.GetGauge().GetValue()
			}
		case "dr_ransomware_clean_point_curated_total":
			for _, mc := range mf.Metric {
				curated = mc.GetCounter().GetValue()
			}
		}
	}

	if got["stream-1/"+SignalEntropy] != 2 {
		t.Fatalf("entropy signal count = %v, want 2", got["stream-1/"+SignalEntropy])
	}
	if got["stream-1/"+SignalByteRate] != 1 {
		t.Fatalf("byte_rate signal count = %v, want 1", got["stream-1/"+SignalByteRate])
	}
	if entropyGauge["stream-1"] != 7.9 {
		t.Fatalf("entropy gauge = %v, want 7.9", entropyGauge["stream-1"])
	}
	if curated != 1 {
		t.Fatalf("curated total = %v, want 1", curated)
	}
}

func TestMetrics_NoDuplicateRegistrationPanic(t *testing.T) {
	t.Parallel()
	// Two instances each on their own private registry must both construct
	// without a duplicate-registration panic (the per-instance registry rule).
	_ = NewMetrics(nil)
	_ = NewMetrics(nil)
}

func labelValue(m *dto.Metric, name string) string {
	for _, l := range m.Label {
		if l.GetName() == name {
			return l.GetValue()
		}
	}
	return ""
}
