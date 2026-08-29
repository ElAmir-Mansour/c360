package sources

import (
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/stretchr/testify/require"
)

func TestNewMetrics_Registers(t *testing.T) {
	reg := prometheus.NewRegistry()
	m := NewMetrics(reg)
	require.NotNil(t, m)
	require.NotNil(t, m.SourcesTotal)
	require.NotNil(t, m.SourceEPSCurrent)
	require.NotNil(t, m.DetectorRunDuration)

	// Exercise each label set to confirm the registrations are
	// consistent.
	m.SourcesTotal.WithLabelValues("t", "active").Set(1)
	m.SourceEPSCurrent.WithLabelValues("t", "s", "1min").Set(100)
	m.SourceBaselineEPS.WithLabelValues("t", "s").Set(99)
	m.SourceDriftPct.WithLabelValues("t", "s").Set(-0.1)
	m.SourceLastSeenAge.WithLabelValues("t", "s").Set(10)
	m.SourceCertExpiryDays.WithLabelValues("t", "s").Set(365)
	m.ProvisioningAgeSeconds.WithLabelValues("t", "s").Set(60)
	m.EnrollIssuedTotal.WithLabelValues("t", "enroll").Inc()
	m.EnrollConsumedTotal.WithLabelValues("t", "enroll", "ok").Inc()
	m.EnrollReplayBlockedTotal.WithLabelValues("t").Inc()
	m.PKILeafIssuedTotal.WithLabelValues("t").Inc()
	m.PKILeafRevokedTotal.WithLabelValues("t", "rotation").Inc()
	m.MTLSVerificationsTotal.WithLabelValues("ok").Inc()
	m.DetectorRunDuration.Observe(0.001)
	m.DetectorSilentSources.WithLabelValues("t").Set(2)
	m.DetectorSilentTrans.WithLabelValues("t", "drift").Inc()
	m.DetectorRecoveredTotal.WithLabelValues("t").Inc()
	m.HeartbeatRateLimited.WithLabelValues("t", "s").Inc()
	m.HeartbeatIngestedTotal.WithLabelValues("t").Inc()

	// Sanity-check the gather succeeds.
	mfs, err := reg.Gather()
	require.NoError(t, err)
	require.NotEmpty(t, mfs)
}
