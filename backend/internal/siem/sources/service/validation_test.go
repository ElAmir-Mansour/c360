package service

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/siem/sources"
)

type addrCase struct {
	transport sources.Transport
	addr      string
	wantErr   bool
}

func TestValidateAddress_Fixtures(t *testing.T) {
	cases := []addrCase{
		// syslog_udp positives
		{sources.TransportSyslogUDP, "10.0.0.1:514", false},
		{sources.TransportSyslogUDP, "host.example.com:514", false},
		{sources.TransportSyslogUDP, "fw-1:1514", false},
		// syslog_udp negatives
		{sources.TransportSyslogUDP, "10.0.0.1", true},
		{sources.TransportSyslogUDP, ":514", true},
		{sources.TransportSyslogUDP, "host:abc", true},
		{sources.TransportSyslogUDP, "host:0", true},
		{sources.TransportSyslogUDP, "host:70000", true},

		// syslog_tcp_tls
		{sources.TransportSyslogTCPTLS, "host:6514", false},
		{sources.TransportSyslogTCPTLS, "host:-1", true},

		// json_https / nibss_iaf
		{sources.TransportJSONHTTPS, "https://api.example.com/ingest", false},
		{sources.TransportJSONHTTPS, "http://api.example.com", true},
		{sources.TransportJSONHTTPS, "ftp://api.example.com", true},
		{sources.TransportJSONHTTPS, "https://", true},
		{sources.TransportNIBSSIAF, "https://nibss.com.ng/iaf", false},
		{sources.TransportNIBSSIAF, "https://", true},

		// cloudtrail_sqs
		{sources.TransportCloudTrailSQS, "arn:aws:sqs:us-east-1:123456789012:my-queue", false},
		{sources.TransportCloudTrailSQS, "arn:aws:s3:::bucket", true},
		{sources.TransportCloudTrailSQS, "not-an-arn", true},

		// file_tail positives
		{sources.TransportFileTail, "/var/log/firewall.log", false},
		{sources.TransportFileTail, "/opt/audit.log", false},
		// file_tail negatives - security guardrail
		{sources.TransportFileTail, "/etc/passwd", true},
		{sources.TransportFileTail, "/etc", true},
		{sources.TransportFileTail, "/var/log/secure", true},
		{sources.TransportFileTail, "/var/log/auth.log", true},
		{sources.TransportFileTail, "/proc/cpuinfo", true},
		{sources.TransportFileTail, "/sys/devices", true},
		{sources.TransportFileTail, "relative/path.log", true},

		// swift_audit / rtgs_audit must also reject /etc
		{sources.TransportSWIFTAudit, "/swift/audit.log", false},
		{sources.TransportSWIFTAudit, "/etc/swift", true},
		{sources.TransportRTGSAudit, "/rtgs/audit.log", false},
		{sources.TransportRTGSAudit, "/proc/info", true},

		// kafka
		{sources.TransportKafka, "broker1:9092,broker2:9092", false},
		{sources.TransportKafka, "broker:9092/topic", false},
		{sources.TransportKafka, "broker", true},
		{sources.TransportKafka, "broker:abc", true},

		// gcp_pubsub / gworkspace
		{sources.TransportGCPPubSub, "projects/x/topics/y", false},
		{sources.TransportGCPPubSub, "flat", true},
		{sources.TransportGWorkspace, "customer/Cabc/applications/admin", false},

		// netflow / zeek / suricata
		{sources.TransportNetflow, "10.0.0.1:2055", false},
		{sources.TransportZeekJSON, "h:6379", false},
		{sources.TransportSuricataJSON, "h:514", false},

		// k8s_audit / pg_audit / oracle / mssql
		{sources.TransportK8sAudit, "api:6443", false},
		{sources.TransportPGAudit, "db:5432", false},
		{sources.TransportOracleAudit, "db:1521", false},
		{sources.TransportMSSQLAudit, "db:1433", false},

		// Extra positive coverage to satisfy the 30-positive lower bound
		{sources.TransportCEFSyslog, "siem:514", false},
		{sources.TransportLEEFSyslog, "siem:1514", false},
		{sources.TransportWinEventWEC, "wec.example.com:5985", false},
		{sources.TransportOktaSystemLog, "okta.example.com:443", false},
		{sources.TransportM365Graph, "graph.microsoft.com:443", false},
		{sources.TransportAzureEventHub, "evhub.servicebus:443", false},
		{sources.TransportT24Export, "/var/t24/export.log", false},
		{sources.TransportFinacleExport, "/var/finacle/export.log", false},
		{sources.TransportFlexcubeExport, "/var/flexcube/export.log", false},
		{sources.TransportPostilionLog, "/var/postilion/audit.log", false},
		{sources.TransportISO8583, "iso8583:8583", false},

		// Extra negatives to satisfy the 30-negative bound
		{sources.TransportCEFSyslog, "no-port", true},
		{sources.TransportLEEFSyslog, "host:", true},
		{sources.TransportT24Export, "/etc/t24/export.log", true},
		{sources.TransportFinacleExport, "rel/path.log", true},
		{sources.TransportPostilionLog, "/proc/postilion.log", true},
		{sources.TransportISO8583, "8583", true},
		{sources.TransportNetflow, "", true},
		{sources.TransportZeekJSON, "host", true},
		{sources.TransportK8sAudit, ":6443", true},
	}
	require.GreaterOrEqual(t, countPositive(cases), 30)
	require.GreaterOrEqual(t, countNegative(cases), 30)
	for _, c := range cases {
		err := validateAddress(c.transport, c.addr)
		if c.wantErr {
			require.Errorf(t, err, "expected error for %s/%s", c.transport, c.addr)
		} else {
			require.NoErrorf(t, err, "unexpected error for %s/%s", c.transport, c.addr)
		}
	}
}

func countPositive(cs []addrCase) int {
	n := 0
	for _, c := range cs {
		if !c.wantErr {
			n++
		}
	}
	return n
}

func countNegative(cs []addrCase) int {
	n := 0
	for _, c := range cs {
		if c.wantErr {
			n++
		}
	}
	return n
}

func TestValidate_NameTagsTz(t *testing.T) {
	good := sources.OnboardInput{
		TenantID: uuid.New(), Name: "fw-01", Type: "firewall",
		Transport: sources.TransportSyslogUDP, Address: "10.0.0.1:514",
		ExpectedEPS: 100, TZ: "Africa/Lagos", CreatedBy: uuid.New(),
	}
	require.NoError(t, Validate(good))

	// Negative cases for name.
	badNames := []string{"X", "ab", strings.Repeat("a", 65), "_underscore", "WithCaps", "has spaces"}
	for _, n := range badNames {
		in := good
		in.Name = n
		require.Error(t, Validate(in), "expected error for name %q", n)
	}
	// Bad tz.
	in := good
	in.TZ = "Not/A/Zone"
	require.Error(t, Validate(in))
	// Bad expected_eps.
	in = good
	in.ExpectedEPS = -1
	require.Error(t, Validate(in))
	in.ExpectedEPS = 1_000_001
	require.Error(t, Validate(in))
	// Bad transport.
	in = good
	in.Transport = "no-such-transport"
	require.Error(t, Validate(in))
	// Bad type (empty).
	in = good
	in.Type = ""
	require.Error(t, Validate(in))
	// Bad tags.
	in = good
	in.Tags = json.RawMessage(`{"1bad":"v"}`)
	require.Error(t, Validate(in))
	in.Tags = json.RawMessage(`{"key":"` + strings.Repeat("v", 129) + `"}`)
	require.Error(t, Validate(in))
	// 17 keys.
	tags := map[string]string{}
	for i := 0; i < 17; i++ {
		tags[string(rune('a'+i))+"key"] = "v"
	}
	raw, _ := json.Marshal(tags)
	in.Tags = raw
	require.Error(t, Validate(in))
}

func TestValidate_30PositiveNameFixtures(t *testing.T) {
	// 30+ positive name examples to satisfy the test-fixture lower bound.
	positiveNames := []string{
		"abc", "fw-01", "fw-02", "fw-rack-3", "core-fw-east-1",
		"perimeter-1", "perimeter-2", "perimeter-edge", "edge-1",
		"vpn-gw", "vpn-1", "vpn-2", "wifi-ap-01", "wifi-ap-02",
		"db-prod-1", "db-prod-2", "siem-collector", "auditor-1",
		"win-server-01", "linux-host-1", "router-1", "router-2",
		"router-core", "switch-1", "switch-2", "endpoint-1",
		"endpoint-2", "endpoint-3", "edr-1", "edr-2", "edr-3",
		"3-letter", "9-letters",
	}
	require.GreaterOrEqual(t, len(positiveNames), 30)
	for _, n := range positiveNames {
		require.NoError(t, Validate(sources.OnboardInput{
			TenantID: uuid.New(), Name: n, Type: "fw",
			Transport: sources.TransportSyslogUDP, Address: "h:514",
			CreatedBy: uuid.New(),
		}), "expected name %q to pass", n)
	}
}

func TestValidateUpdate(t *testing.T) {
	addr := "10.0.0.5:514"
	bad := "10.0.0.5"
	tz := "Europe/London"
	expected := 100
	badExpected := -1
	typ := "ids"
	emptyTyp := ""

	require.NoError(t, ValidateUpdate(sources.UpdateInput{Address: &addr, TZ: &tz, ExpectedEPS: &expected, Type: &typ}, sources.TransportSyslogUDP))
	require.Error(t, ValidateUpdate(sources.UpdateInput{Address: &bad}, sources.TransportSyslogUDP))
	require.Error(t, ValidateUpdate(sources.UpdateInput{ExpectedEPS: &badExpected}, sources.TransportSyslogUDP))
	require.Error(t, ValidateUpdate(sources.UpdateInput{Type: &emptyTyp}, sources.TransportSyslogUDP))
}
