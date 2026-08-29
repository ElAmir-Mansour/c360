package sources

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// Status mirrors the siem.source_status enum from migration 000003.
type Status string

// Status values. Adding new states is allowed; renaming or removing is forbidden.
const (
	StatusProvisioning Status = "provisioning"
	StatusActive       Status = "active"
	StatusSilent       Status = "silent"
	StatusDisabled     Status = "disabled"
	StatusRotating     Status = "rotating"
	StatusError        Status = "error"
)

// AllStatuses enumerates every legal status; useful for validation.
var AllStatuses = []Status{
	StatusProvisioning, StatusActive, StatusSilent,
	StatusDisabled, StatusRotating, StatusError,
}

// Transport mirrors the siem.source_transport enum from migration 000003.
type Transport string

// Transport values. The full set is in the migration; here we expose constants
// for the ones the validation layer needs to special-case.
const (
	TransportSyslogUDP      Transport = "syslog_udp"
	TransportSyslogTCPTLS   Transport = "syslog_tcp_tls"
	TransportCEFSyslog      Transport = "cef_syslog"
	TransportLEEFSyslog     Transport = "leef_syslog"
	TransportWinEventWEC    Transport = "win_event_wec"
	TransportJSONHTTPS      Transport = "json_https"
	TransportKafka          Transport = "kafka"
	TransportFileTail       Transport = "file_tail"
	TransportCloudTrailSQS  Transport = "cloudtrail_sqs"
	TransportGCPPubSub      Transport = "gcp_pubsub"
	TransportAzureEventHub  Transport = "azure_eventhub"
	TransportM365Graph      Transport = "m365_graph"
	TransportGWorkspace     Transport = "gworkspace_reports"
	TransportOktaSystemLog  Transport = "okta_system_log"
	TransportNIBSSIAF       Transport = "nibss_iaf"
	TransportSWIFTAudit     Transport = "swift_audit"
	TransportT24Export      Transport = "t24_export"
	TransportFinacleExport  Transport = "finacle_export"
	TransportFlexcubeExport Transport = "flexcube_export"
	TransportPostilionLog   Transport = "postilion_log"
	TransportISO8583        Transport = "iso8583"
	TransportRTGSAudit      Transport = "rtgs_audit"
	TransportPGAudit        Transport = "pg_audit"
	TransportOracleAudit    Transport = "oracle_audit"
	TransportMSSQLAudit     Transport = "mssql_audit"
	TransportK8sAudit       Transport = "k8s_audit"
	TransportNetflow        Transport = "netflow"
	TransportZeekJSON       Transport = "zeek_json"
	TransportSuricataJSON   Transport = "suricata_json"
)

// AllTransports enumerates every legal transport; used by validation.
var AllTransports = []Transport{
	TransportSyslogUDP, TransportSyslogTCPTLS, TransportCEFSyslog, TransportLEEFSyslog,
	TransportWinEventWEC, TransportJSONHTTPS, TransportKafka, TransportFileTail,
	TransportCloudTrailSQS, TransportGCPPubSub, TransportAzureEventHub, TransportM365Graph,
	TransportGWorkspace, TransportOktaSystemLog, TransportNIBSSIAF, TransportSWIFTAudit,
	TransportT24Export, TransportFinacleExport, TransportFlexcubeExport, TransportPostilionLog,
	TransportISO8583, TransportRTGSAudit, TransportPGAudit, TransportOracleAudit,
	TransportMSSQLAudit, TransportK8sAudit, TransportNetflow, TransportZeekJSON,
	TransportSuricataJSON,
}

// Purpose is the enrollment token purpose claim.
type Purpose string

const (
	PurposeEnroll Purpose = "enroll"
	PurposeRotate Purpose = "rotate"
)

// Source is the in-memory representation of a row in siem.sources.
type Source struct {
	ID                uuid.UUID       `json:"id"`
	TenantID          uuid.UUID       `json:"tenant_id"`
	Name              string          `json:"name"`
	Type              string          `json:"type"`
	Transport         Transport       `json:"transport"`
	Address           string          `json:"address"`
	ExpectedEPS       int             `json:"expected_eps"`
	BaselineEPS       int             `json:"baseline_eps"`
	BaselineSamples   int             `json:"baseline_samples"`
	TZ                string          `json:"tz"`
	ParserID          *uuid.UUID      `json:"parser_id,omitempty"`
	Status            Status          `json:"status"`
	LastSeenAt        *time.Time      `json:"last_seen_at,omitempty"`
	LastHealthAt      *time.Time      `json:"last_health_at,omitempty"`
	MTLSThumbprint    string          `json:"mtls_thumbprint,omitempty"`
	CertSerial        string          `json:"cert_serial,omitempty"`
	CertIssuedAt      *time.Time      `json:"cert_issued_at,omitempty"`
	CertExpiresAt     *time.Time      `json:"cert_expires_at,omitempty"`
	CertRevokedAt     *time.Time      `json:"cert_revoked_at,omitempty"`
	CertRevokedReason string          `json:"cert_revoked_reason,omitempty"`
	Tags              json.RawMessage `json:"tags"`
	Version           int64           `json:"version"`
	CreatedBy         uuid.UUID       `json:"created_by"`
	CreatedAt         time.Time       `json:"created_at"`
	UpdatedAt         time.Time       `json:"updated_at"`
	DeletedAt         *time.Time      `json:"deleted_at,omitempty"`
}

// SourceCredentials mirrors siem.source_credentials. The private key is never
// stored here in the CSR flow — VaultKeyRef is a logical reference for the
// IssueWithKey path which is opt-in and out of scope for this phase.
type SourceCredentials struct {
	SourceID      uuid.UUID  `json:"source_id"`
	VaultPKIMount string     `json:"vault_pki_mount"`
	VaultKeyRef   string     `json:"vault_key_ref"`
	CertPEM       string     `json:"cert_pem"`
	CAChainPEM    string     `json:"ca_chain_pem"`
	CreatedAt     time.Time  `json:"created_at"`
	RotatedAt     *time.Time `json:"rotated_at,omitempty"`
}

// EPSSample mirrors siem.source_eps_samples.
type EPSSample struct {
	SourceID         uuid.UUID `json:"source_id"`
	TS               time.Time `json:"ts"`
	EPS1Min          int       `json:"eps_1min"`
	EPS5Min          int       `json:"eps_5min"`
	ParserErrors1Min int       `json:"parser_errors_1min"`
	Dropped1Min      int       `json:"dropped_1min"`
	QueueDepth       int       `json:"queue_depth"`
	CollectorVersion string    `json:"collector_version,omitempty"`
}

// Revocation mirrors siem.source_cert_revocations.
type Revocation struct {
	Thumbprint string    `json:"thumbprint"`
	SourceID   uuid.UUID `json:"source_id"`
	CertSerial string    `json:"cert_serial"`
	RevokedAt  time.Time `json:"revoked_at"`
	Reason     string    `json:"reason"`
}

// EnrollmentTokenRecord mirrors siem.enrollment_tokens.
type EnrollmentTokenRecord struct {
	JTI            uuid.UUID  `json:"jti"`
	SourceID       uuid.UUID  `json:"source_id"`
	TenantID       uuid.UUID  `json:"tenant_id"`
	Purpose        Purpose    `json:"purpose"`
	IssuedAt       time.Time  `json:"issued_at"`
	ExpiresAt      time.Time  `json:"expires_at"`
	ConsumedAt     *time.Time `json:"consumed_at,omitempty"`
	ConsumedFromIP string     `json:"consumed_from_ip,omitempty"`
	IssuedBy       uuid.UUID  `json:"issued_by"`
}

// EnrollmentToken is the response shape returned to the admin after Onboard
// or RotateCert. The JWT field is shown to the admin exactly once.
type EnrollmentToken struct {
	JWT       string    `json:"jwt"`
	JTI       uuid.UUID `json:"jti"`
	SourceID  uuid.UUID `json:"source_id"`
	TenantID  uuid.UUID `json:"tenant_id"`
	Purpose   Purpose   `json:"purpose"`
	ExpiresAt time.Time `json:"expires_at"`
}

// Health is the response shape of GET /sources/{id}/health.
type Health struct {
	ID                  uuid.UUID  `json:"id"`
	Name                string     `json:"name"`
	Status              Status     `json:"status"`
	LastSeenAt          *time.Time `json:"last_seen_at,omitempty"`
	EPS1Min             int        `json:"eps_1min"`
	EPS5Min             int        `json:"eps_5min"`
	BaselineEPS         int        `json:"baseline_eps"`
	BaselineLocked      bool       `json:"baseline_locked"`
	DriftPct            float64    `json:"drift_pct"`
	ParserErrors1H      int        `json:"parser_errors_1h"`
	Dropped1H           int        `json:"dropped_1h"`
	CertExpiresAt       *time.Time `json:"cert_expires_at,omitempty"`
	DaysUntilCertExpiry int        `json:"days_until_cert_expiry"`
	CertRevoked         bool       `json:"cert_revoked"`
	LastHealthAt        *time.Time `json:"last_health_at,omitempty"`
}

// OnboardInput is what callers pass to Service.Onboard.
type OnboardInput struct {
	TenantID    uuid.UUID
	Name        string
	Type        string
	Transport   Transport
	Address     string
	ExpectedEPS int
	TZ          string
	Tags        json.RawMessage
	CreatedBy   uuid.UUID
}

// UpdateInput is the patch payload for Service.Update. Pointer-typed fields
// are interpreted as "if non-nil, apply"; otherwise leave untouched.
type UpdateInput struct {
	Type        *string
	Address     *string
	ExpectedEPS *int
	TZ          *string
	Tags        json.RawMessage
}

// ListQuery is the parameter bundle for Service.List.
type ListQuery struct {
	Status    *Status
	Type      *string
	Transport *Transport
	Q         string
	Tags      map[string]string
	Cursor    string
	Limit     int
}

// ListResult bundles a page of sources with the cursor for the next page.
type ListResult struct {
	Items      []Source `json:"items"`
	NextCursor string   `json:"next_cursor,omitempty"`
}
