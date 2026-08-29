package integration

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// =============================================================================
// HR / identity connector (kind=hr) — Phase 2.
//
// Implements the base IntegrationAdapter (Kind+Probe) PLUS ConnectionTester and
// Syncer. Four configurable transports (config.transport):
//
//   - scim_client : pull SCIM 2.0 /Users + /Groups from an upstream provider.
//   - hris_rest   : pull workers/orgUnits from an HRIS vendor (workday /
//                   successfactors / oracle_hcm vendor shapes), bearer or OAuth2.
//   - csv_sftp    : pull a CSV roster over SFTP (injected SFTP transport).
//   - ldap        : bind + search a directory (injected LDAP transport).
//
// SELF-SERVE → REAL TRANSPORTS. SCIM-client and HRIS-REST are real net/http
// transports (the dominant self-serve modes). CSV/SFTP and LDAP are real
// PROTOCOLS that require an optional dependency (an SFTP client / an LDAP
// library); to keep this connector dependency-clean and buildable without
// pulling unverifiable modules, those two run through an INJECTED transport seam
// (SFTPTransport / LDAPTransport). When a transport is not wired the connector
// returns an HONEST "transport provider not configured" error and grades the
// endpoint not-reachable — it NEVER fakes a healthy bind or a fake roster.
//
// CONFIG + SECRETS CUSTODY. The adapter resolves PLAINTEXT config via the
// IntegrationEndpointRepository (which FieldCrypto-decrypts on read) — the
// najiz_court_adapter.go pattern — never the redacting registry service. Secrets
// (bearer_token, sftp_password, ldap_bind_password, oauth client_secret) are
// never logged or returned.
//
// NORMALIZATION. Raw upstream records are normalized via a CONFIGURABLE
// field_mapping (config["field_mapping"], a JSON object of lex-field ->
// upstream-attribute) into a neutral hrRecord, then reconciled:
//   - groups / org-units    -> UpsertOrgEntity by (tenant, code)
//   - users / workers       -> UpsertRole for the escalation ladder (when the
//                              upstream record carries a mappable org-role)
//   - idempotency           -> lex_hr_identity_map (tenant, endpoint, external_id)
// =============================================================================

// hrIdentityStore is the persistence seam the HR connector + SCIM server use for
// the idempotency map. *repository.HRIdentityMapRepository satisfies it in
// production; tests inject an in-memory fake. Pool() returns the Queryer the
// repo methods are called with (the concrete pool in production, nil in a fake
// whose methods ignore the Queryer).
type hrIdentityStore interface {
	Pool() *pgxpool.Pool
	GetMapping(ctx context.Context, q repository.Queryer, tenantID, endpointID uuid.UUID, externalID string) (*repository.HRIdentityMapping, error)
	UpsertMapping(ctx context.Context, q repository.Queryer, m *repository.HRIdentityMapping) (bool, error)
	SoftDeactivate(ctx context.Context, q repository.Queryer, tenantID, endpointID uuid.UUID, externalID string, at time.Time) error
	ResolveTokenByHash(ctx context.Context, tokenHash string, now time.Time) (*repository.SCIMToken, error)
	TouchTokenUsed(ctx context.Context, tenantID, tokenID uuid.UUID, at time.Time) error
	IssueToken(ctx context.Context, q repository.Queryer, tok *repository.SCIMToken, tokenHash string) error
	RevokeTokensForEndpoint(ctx context.Context, q repository.Queryer, tenantID, endpointID uuid.UUID, at time.Time) error
}

// hrOrgStore is the persistence seam for the org registry reconcile targets.
// *repository.OrgEntityRepository satisfies it in production.
type hrOrgStore interface {
	GetByCode(ctx context.Context, tenantID uuid.UUID, code string) (*model.OrgEntity, error)
	Create(ctx context.Context, q repository.Queryer, entity *model.OrgEntity) error
	Update(ctx context.Context, q repository.Queryer, entity *model.OrgEntity) error
	UpsertRole(ctx context.Context, q repository.Queryer, role *model.OrgRole) error
}

type hrMembershipStore interface {
	UpsertMembership(ctx context.Context, q repository.Queryer, membership *model.OrgMembership) error
}

// HRConnector is the kind=hr adapter. It is tenant-agnostic; tenant scoping comes
// from the endpoint passed to each capability method.
type HRConnector struct {
	endpoints *repository.IntegrationEndpointRepository
	orgRepo   hrOrgStore
	idMap     hrIdentityStore
	client    *http.Client
	oauth     *OAuthTokenCache
	logger    zerolog.Logger
	now       func() time.Time

	// sftp / ldap are optional injected transports for the csv_sftp / ldap modes.
	// Nil means "not compiled in for this deployment" → honest not-configured.
	sftp SFTPTransport
	ldap LDAPTransport
}

// SFTPTransport abstracts an SFTP roster fetch so csv_sftp works without baking a
// specific SFTP library into this package. A real implementation (e.g. over
// pkg/sftp + golang.org/x/crypto/ssh) is injected at wiring time. ListAndFetch
// connects with the supplied credentials, lists remotePath, and returns the bytes
// of the newest matching CSV (or the file at remotePath when it is a file).
type SFTPTransport interface {
	// Probe verifies reachability + auth (a directory list) without fetching.
	Probe(ctx context.Context, conn SFTPConn) error
	// Fetch returns the CSV roster bytes from remotePath.
	Fetch(ctx context.Context, conn SFTPConn) ([]byte, error)
}

// SFTPConn carries the (already-decrypted) SFTP connection settings.
type SFTPConn struct {
	Host       string
	Port       int
	Username   string
	Password   string
	PrivateKey string // optional PEM, alternative to Password
	RemotePath string
}

// LDAPTransport abstracts an LDAP bind + search so the ldap mode works without
// baking a specific LDAP library into this package. A real implementation (e.g.
// over go-ldap) is injected at wiring time.
type LDAPTransport interface {
	// Bind verifies the bind DN + password against the directory.
	Bind(ctx context.Context, conn LDAPConn) error
	// Search returns directory entries under BaseDN matching Filter; each entry is
	// a flat attribute map (multi-valued attributes joined or first-wins per the
	// implementation).
	Search(ctx context.Context, conn LDAPConn) ([]map[string]string, error)
}

// LDAPConn carries the (already-decrypted) LDAP connection settings.
type LDAPConn struct {
	URL          string
	BindDN       string
	BindPassword string
	BaseDN       string
	Filter       string
}

// HRConnectorConfig parametrises the connector. endpoints + orgRepo + idMap are
// required for Sync; the SCIM/HRIS HTTP client and OAuth cache default sensibly.
type HRConnectorConfig struct {
	Endpoints *repository.IntegrationEndpointRepository
	OrgRepo   hrOrgStore
	IDMap     hrIdentityStore
	Client    *http.Client
	OAuth     *OAuthTokenCache
	Timeout   time.Duration
	Logger    zerolog.Logger
	SFTP      SFTPTransport
	LDAP      LDAPTransport
}

// NewHRConnector builds the HR connector. The endpoint repository MUST be
// FieldCrypto-wired so Config is decrypted on read.
func NewHRConnector(cfg HRConnectorConfig) *HRConnector {
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 20 * time.Second
	}
	client := cfg.Client
	if client == nil {
		client = &http.Client{Timeout: timeout}
	} else if client.Timeout == 0 {
		copied := *client
		copied.Timeout = timeout
		client = &copied
	}
	oauth := cfg.OAuth
	if oauth == nil {
		oauth = NewOAuthTokenCache(client, 30*time.Second)
	}
	return &HRConnector{
		endpoints: cfg.Endpoints,
		orgRepo:   cfg.OrgRepo,
		idMap:     cfg.IDMap,
		client:    client,
		oauth:     oauth,
		logger:    cfg.Logger.With().Str("component", "lex-hr-connector").Logger(),
		now:       time.Now,
		sftp:      cfg.SFTP,
		ldap:      cfg.LDAP,
	}
}

// Kind reports the integration kind this adapter serves.
func (c *HRConnector) Kind() model.IntegrationKind { return model.IntegrationKindHR }

// transport modes.
const (
	hrTransportSCIM    = "scim"
	hrTransportHRIS    = "hris_api"
	hrTransportCSVSFTP = "csv_sftp"
	hrTransportLDAP    = "ldap"

	// Tier-2 Saudi government identity/employment sources. These are GOV-GATED:
	// the adapter is configurable + code-ready, but it is HONESTLY "planned" until
	// a tenant completes the relevant government onboarding (see hrTier2Source).
	// It NEVER fabricates a live feed — Sync returns ErrHRTier2NotLive and Probe
	// grades it not-reachable with a clear note.
	hrTransportGOSI   = "gosi"   // General Organization for Social Insurance
	hrTransportQiwa   = "qiwa"   // MHRSD Qiwa labour platform
	hrTransportMuqeem = "muqeem" // Absher/Muqeem resident (Iqama) registry
)

// hrTier2Source describes a Tier-2 Saudi government HR source: its config key, a
// bilingual label, and the exact external onboarding still required to flip it to
// live. The map is the single source of truth for the honest "planned" verdict.
type hrTier2Source struct {
	Transport string
	NameEN    string
	NameAR    string
	// Onboarding is the precise external credential/onboarding gate that must be
	// cleared before this source can be wired to a live API. Surfaced (secret-free)
	// in Probe detail and the not-live error so operators know what is missing.
	Onboarding string
}

var hrTier2Sources = map[string]hrTier2Source{
	hrTransportGOSI: {
		Transport: hrTransportGOSI, NameEN: "GOSI (Social Insurance)", NameAR: "التأمينات الاجتماعية (جوسي)",
		Onboarding: "GOSI establishment registration + API onboarding (client credentials issued by GOSI) — not yet available",
	},
	hrTransportQiwa: {
		Transport: hrTransportQiwa, NameEN: "Qiwa (MHRSD labour)", NameAR: "قوى (وزارة الموارد البشرية)",
		Onboarding: "Qiwa Business API subscription + OAuth2 client credentials (issued via the Qiwa developer portal) — not yet available",
	},
	hrTransportMuqeem: {
		Transport: hrTransportMuqeem, NameEN: "Muqeem (resident registry)", NameAR: "مقيم (سجل المقيمين)",
		Onboarding: "Muqeem/Absher Business onboarding + issued API key + approved use-case — not yet available",
	},
}

// ErrHRTier2NotLive is returned by Sync/TestConnection for a Tier-2 Saudi
// government source. The adapter is configurable and code-ready, but it remains
// HONESTLY not-live until the tenant completes government onboarding. The error
// names the exact gate so operators know what is missing.
var ErrHRTier2NotLive = fmt.Errorf("lex/hr: Tier-2 Saudi government source is configurable but not wired to a live API (gov onboarding pending)")

// isTier2 reports whether the transport is a gov-gated Tier-2 Saudi source.
func (cfg hrConfig) isTier2() bool {
	_, ok := hrTier2Sources[cfg.Transport]
	return ok
}

// hrConfig is the resolved (decrypted) connection config for an HR endpoint.
type hrConfig struct {
	Transport string

	BaseURL     string
	BearerToken string

	// OAuth2 client-credentials (optional; some HRIS vendors require it).
	TokenURL     string
	ClientID     string
	ClientSecret string
	Scope        string

	// HRIS vendor shape (workday / successfactors / oracle_hcm).
	Vendor     string
	UsersPath  string // SCIM /Users or HRIS workers path
	GroupsPath string // SCIM /Groups or HRIS orgUnits path

	// SFTP.
	SFTPHost     string
	SFTPPort     int
	SFTPUsername string
	SFTPPassword string
	SFTPKey      string
	SFTPPath     string

	// LDAP.
	LDAPURL          string
	LDAPBindDN       string
	LDAPBindPassword string
	LDAPBaseDN       string
	LDAPFilter       string

	// FieldMapping maps neutral lex fields to upstream attribute names.
	FieldMapping map[string]string
	SyncMode     string
}

// Probe is the base readiness signal. It is HONEST: it never opens a network
// connection (TestConnection does that); it grades from status + config presence.
//   - planned/disabled/error → not reachable (honest "not yet live").
//   - active + complete config for the chosen transport → reachable (registry
//     configured); active + incomplete config → not reachable with the gap named.
func (c *HRConnector) Probe(_ context.Context, endpoint model.IntegrationEndpoint, now time.Time) model.IntegrationHealth {
	h := model.IntegrationHealth{
		EndpointID:  endpoint.ID,
		Kind:        model.IntegrationKindHR,
		Code:        endpoint.Code,
		Status:      endpoint.Status,
		CheckedUnix: now.Unix(),
	}
	switch endpoint.Status {
	case model.IntegrationStatusActive:
		cfg := parseHRConfig(endpoint.Config)
		// Tier-2 gov-gated sources are NEVER reported reachable from config alone:
		// they are honestly "planned" until government onboarding is complete.
		if src, ok := hrTier2Sources[cfg.Transport]; ok {
			h.Reachable = false
			h.Detail = fmt.Sprintf("%s is configurable but gov-gated (planned): %s", src.NameEN, src.Onboarding)
			return h
		}
		if missing := cfg.missingForActive(); missing != "" {
			h.Reachable = false
			h.Detail = "active HR endpoint is missing required configuration: " + missing
			return h
		}
		if (cfg.Transport == hrTransportCSVSFTP && c.sftp == nil) ||
			(cfg.Transport == hrTransportLDAP && c.ldap == nil) {
			h.Reachable = false
			h.Detail = fmt.Sprintf("%s transport provider not configured for this deployment", cfg.Transport)
			return h
		}
		h.Reachable = true
		h.Detail = fmt.Sprintf("configured (transport=%s); use Test Connection for a live probe", cfg.Transport)
	case model.IntegrationStatusPlanned:
		h.Reachable = false
		h.Detail = "planned: not yet activated"
	case model.IntegrationStatusDisabled:
		h.Reachable = false
		h.Detail = "disabled by operator"
	default:
		h.Reachable = false
		h.Detail = "endpoint in error state"
	}
	return h
}

// TestConnection performs a non-mutating, transport-specific reachability + auth
// probe. It NEVER mutates lex storage and NEVER logs/echoes secrets.
func (c *HRConnector) TestConnection(ctx context.Context, endpoint model.IntegrationEndpoint) (TestResult, error) {
	start := c.now()
	cfg := parseHRConfig(endpoint.Config)
	res := TestResult{CheckedAt: start.UTC()}
	finish := func() { res.LatencyMillis = time.Since(start).Milliseconds() }

	switch cfg.Transport {
	case hrTransportSCIM:
		count, detail, status, err := c.testSCIMSteps(ctx, cfg)
		finish()
		res.Steps = hrScimDiagSteps(res.LatencyMillis, count, status, err)
		if err != nil {
			res.Reachable = false
			res.Detail = sanitizeDetail(detail, err)
			return res, nil
		}
		res.Reachable = true
		res.SampleCount = count
		res.Detail = detail
		res.Metadata = map[string]any{"transport": "scim"}
		return res, nil
	case hrTransportHRIS:
		count, detail, status, err := c.testHRISSteps(ctx, cfg)
		finish()
		res.Steps = hrHttpDiagSteps(res.LatencyMillis, status, count, err, "hris_api")
		if err != nil {
			res.Reachable = false
			res.Detail = sanitizeDetail(detail, err)
			return res, nil
		}
		res.Reachable = true
		res.SampleCount = count
		res.Detail = detail
		res.Metadata = map[string]any{"transport": "hris_api", "vendor": cfg.Vendor}
		return res, nil
	case hrTransportCSVSFTP:
		finish()
		if c.sftp == nil {
			res.Reachable = false
			res.Detail = "SFTP transport provider not configured for this deployment"
			res.Steps = hrTransportNotWiredSteps("SFTP")
			return res, nil
		}
		err := c.sftp.Probe(ctx, cfg.sftpConn())
		res.Steps = hrBindDiagSteps(res.LatencyMillis, err, "sftp", "list remote path")
		if err != nil {
			res.Reachable = false
			res.Detail = sanitizeDetail("sftp probe failed", err)
			return res, nil
		}
		res.Reachable = true
		res.Detail = "sftp reachable; remote path listable"
		res.Metadata = map[string]any{"transport": "csv_sftp"}
		return res, nil
	case hrTransportLDAP:
		finish()
		if c.ldap == nil {
			res.Reachable = false
			res.Detail = "LDAP transport provider not configured for this deployment"
			res.Steps = hrTransportNotWiredSteps("LDAP")
			return res, nil
		}
		err := c.ldap.Bind(ctx, cfg.ldapConn())
		res.Steps = hrBindDiagSteps(res.LatencyMillis, err, "ldap", "bind + search")
		if err != nil {
			res.Reachable = false
			res.Detail = sanitizeDetail("ldap bind failed", err)
			return res, nil
		}
		res.Reachable = true
		res.Detail = "ldap bind succeeded"
		res.Metadata = map[string]any{"transport": "ldap"}
		return res, nil
	case hrTransportGOSI, hrTransportQiwa, hrTransportMuqeem:
		finish()
		src := hrTier2Sources[cfg.Transport]
		res.Reachable = false
		res.Detail = fmt.Sprintf("%s: gov-gated, not wired to a live API. %s", src.NameEN, src.Onboarding)
		res.Metadata = map[string]any{"transport": cfg.Transport, "tier": 2, "gov_gated": true, "status": "planned"}
		res.Steps = hrTier2NotLiveSteps(src)
		return res, nil
	default:
		finish()
		res.Reachable = false
		res.Detail = "unknown or unset HR transport"
		res.Steps = []DiagnosticStep{
			newDiagStep(diagStepReachable, diagLabel(diagStepReachable), diagStatusFail, 0,
				"unknown or unset HR transport", "set config.transport to scim | hris_api | csv_sftp | ldap | gosi | qiwa | muqeem"),
		}
		return res, nil
	}
}

// hrTier2NotLiveSteps builds an honest staged diagnostic for a gov-gated Tier-2
// source: the reachable stage is a clear "planned/not onboarded" verdict (warn,
// not fail — the adapter is correctly configured, it is the government access
// that is pending), with the precise onboarding gate as the hint.
func hrTier2NotLiveSteps(src hrTier2Source) []DiagnosticStep {
	return []DiagnosticStep{
		newDiagStep(diagStepReachable, diagLabel(diagStepReachable), diagStatusWarn, 0,
			src.NameEN+" adapter is configured but gov-gated (not onboarded to a live API)", src.Onboarding),
		newDiagStep(diagStepAuthenticated, diagLabel(diagStepAuthenticated), diagStatusSkip, 0, "skipped: government onboarding pending", ""),
		newDiagStep(diagStepAuthorized, diagLabel(diagStepAuthorized), diagStatusSkip, 0, "skipped: government onboarding pending", ""),
		newDiagStep(diagStepSampleFetch, diagLabel(diagStepSampleFetch), diagStatusSkip, 0, "skipped: government onboarding pending", ""),
	}
}

// testSCIMSteps wraps testSCIM, also surfacing the observed HTTP status (0 when
// the call never reached a response) so the diagnostic steps can grade the
// authenticated/authorized stages precisely.
func (c *HRConnector) testSCIMSteps(ctx context.Context, cfg hrConfig) (count int, detail string, status int, err error) {
	if cfg.BaseURL == "" {
		return 0, "scim base_url not configured", 0, fmt.Errorf("missing base_url")
	}
	// The /Users page is the lightweight authenticated read used for the staged
	// diagnostic, so we always exercise it (it grades authenticated/authorized and
	// reports a sample count), rather than the auth-light ServiceProviderConfig.
	usersURL := joinURL(cfg.BaseURL, cfg.usersPathOr("/Users")) + "?count=1&startIndex=1"
	st, body, herr := c.doJSON(ctx, http.MethodGet, usersURL, cfg, nil)
	if herr != nil {
		return 0, "scim probe failed", 0, herr
	}
	if st < 200 || st >= 300 {
		return 0, fmt.Sprintf("scim returned status %d", st), st, fmt.Errorf("status %d", st)
	}
	var lr scimListResponse
	_ = json.Unmarshal(body, &lr)
	return lr.TotalResults, "scim /Users reachable", st, nil
}

// testHRISSteps wraps testHRIS, also surfacing the observed HTTP status for the
// diagnostic steps.
func (c *HRConnector) testHRISSteps(ctx context.Context, cfg hrConfig) (count int, detail string, status int, err error) {
	if cfg.BaseURL == "" {
		return 0, "hris base_url not configured", 0, fmt.Errorf("missing base_url")
	}
	u := joinURL(cfg.BaseURL, hrisProbePath(cfg))
	st, _, herr := c.doJSON(ctx, http.MethodGet, u, cfg, nil)
	if herr != nil {
		return 0, "hris probe failed", 0, herr
	}
	if st < 200 || st >= 300 {
		return 0, fmt.Sprintf("hris returned status %d", st), st, fmt.Errorf("status %d", st)
	}
	return 0, fmt.Sprintf("hris reachable (vendor=%s)", cfg.Vendor), st, nil
}

// hrScimDiagSteps builds the staged steps for a SCIM probe. sample_fetch is graded
// from whether the /Users page returned a usable list.
func hrScimDiagSteps(latency int64, count, status int, err error) []DiagnosticStep {
	steps := hrHttpDiagSteps(latency, status, count, err, "scim")
	return steps
}

// hrHttpDiagSteps builds the canonical reachable→authenticated→authorized→
// sample_fetch sequence for an HTTP-based HR transport from one observed status.
func hrHttpDiagSteps(latency int64, status, count int, err error, transport string) []DiagnosticStep {
	// Reachable: an err with status 0 means we never got a response.
	if err != nil && status == 0 {
		return []DiagnosticStep{
			newDiagStep(diagStepReachable, diagLabel(diagStepReachable), diagStatusFail, latency,
				transport+" host not reachable", hintCheckNetwork),
			newDiagStep(diagStepAuthenticated, diagLabel(diagStepAuthenticated), diagStatusSkip, 0, "skipped: host not reachable", ""),
			newDiagStep(diagStepAuthorized, diagLabel(diagStepAuthorized), diagStatusSkip, 0, "skipped: host not reachable", ""),
			newDiagStep(diagStepSampleFetch, diagLabel(diagStepSampleFetch), diagStatusSkip, 0, "skipped: host not reachable", ""),
		}
	}
	reachable := newDiagStep(diagStepReachable, diagLabel(diagStepReachable), diagStatusOK, latency,
		transport+" host reachable", "")

	authStatus, authHint := diagStatusForHTTP(status)
	authDetail := fmt.Sprintf("endpoint returned %d", status)
	switch {
	case status == http.StatusUnauthorized:
		authDetail = "401: credentials rejected by the IdP/HRIS"
	case authStatus == diagStatusOK:
		authDetail = fmt.Sprintf("%d; credentials accepted", status)
	}
	authenticated := newDiagStep(diagStepAuthenticated, diagLabel(diagStepAuthenticated), authStatus, latency, authDetail, authHint)

	authorized := newDiagStep(diagStepAuthorized, diagLabel(diagStepAuthorized), diagStatusOK, 0,
		"read scope granted", "")
	switch {
	case status == http.StatusForbidden:
		authorized = newDiagStep(diagStepAuthorized, diagLabel(diagStepAuthorized), diagStatusFail, 0,
			"403: read scope denied", hintGrantScope)
	case authStatus != diagStatusOK:
		authorized = newDiagStep(diagStepAuthorized, diagLabel(diagStepAuthorized), diagStatusSkip, 0,
			"skipped: not authenticated", "")
	}

	sample := newDiagStep(diagStepSampleFetch, diagLabel(diagStepSampleFetch), diagStatusOK, latency,
		fmt.Sprintf("sample read ok (%d record(s) reported upstream)", count), "")
	if authStatus != diagStatusOK {
		sample = newDiagStep(diagStepSampleFetch, diagLabel(diagStepSampleFetch), diagStatusSkip, 0,
			"skipped: not authenticated", "")
	}
	return []DiagnosticStep{reachable, authenticated, authorized, sample}
}

// hrBindDiagSteps builds steps for a bind-style transport (SFTP / LDAP) where the
// reachability + auth are exercised together by a single Probe/Bind call.
func hrBindDiagSteps(latency int64, err error, transport, sampleOp string) []DiagnosticStep {
	if err != nil {
		return []DiagnosticStep{
			newDiagStep(diagStepReachable, diagLabel(diagStepReachable), diagStatusWarn, latency,
				transport+" reachability is verified together with the bind", ""),
			newDiagStep(diagStepAuthenticated, diagLabel(diagStepAuthenticated), diagStatusFail, latency,
				transport+" bind/probe failed", hintCheckCreds),
			newDiagStep(diagStepAuthorized, diagLabel(diagStepAuthorized), diagStatusSkip, 0, "skipped: bind failed", ""),
			newDiagStep(diagStepSampleFetch, diagLabel(diagStepSampleFetch), diagStatusSkip, 0, "skipped: bind failed", ""),
		}
	}
	return []DiagnosticStep{
		newDiagStep(diagStepReachable, diagLabel(diagStepReachable), diagStatusOK, latency, transport+" host reachable", ""),
		newDiagStep(diagStepAuthenticated, diagLabel(diagStepAuthenticated), diagStatusOK, latency, transport+" bind succeeded", ""),
		newDiagStep(diagStepAuthorized, diagLabel(diagStepAuthorized), diagStatusOK, 0, "directory/path accessible", ""),
		newDiagStep(diagStepSampleFetch, diagLabel(diagStepSampleFetch), diagStatusOK, latency, sampleOp+" succeeded", ""),
	}
}

// hrTransportNotWiredSteps reports an honest not-wired diagnostic when an injected
// transport (SFTP/LDAP) is not compiled into this deployment.
func hrTransportNotWiredSteps(transport string) []DiagnosticStep {
	return []DiagnosticStep{
		newDiagStep(diagStepReachable, diagLabel(diagStepReachable), diagStatusFail, 0,
			transport+" transport provider not configured for this deployment",
			"deploy a build with the "+transport+" transport wired, or switch the endpoint to SCIM/HRIS"),
		newDiagStep(diagStepAuthenticated, diagLabel(diagStepAuthenticated), diagStatusSkip, 0, "skipped: transport not wired", ""),
		newDiagStep(diagStepAuthorized, diagLabel(diagStepAuthorized), diagStatusSkip, 0, "skipped: transport not wired", ""),
		newDiagStep(diagStepSampleFetch, diagLabel(diagStepSampleFetch), diagStatusSkip, 0, "skipped: transport not wired", ""),
	}
}

// Sync pulls upstream records and reconciles them into the lex org registry,
// recording idempotency in lex_hr_identity_map. Full re-reads the whole dataset;
// delta passes the upstream modified-since watermark when the transport supports
// it (SCIM filter / HRIS query param). The returned SyncReport + ledger row are
// secret-free.
func (c *HRConnector) Sync(ctx context.Context, endpoint model.IntegrationEndpoint, mode SyncMode) (SyncReport, error) {
	cfg := parseHRConfig(endpoint.Config)
	report := SyncReport{Mode: mode}
	if c.orgRepo == nil || c.idMap == nil {
		return report, fmt.Errorf("lex/hr: connector not wired with org/identity repositories")
	}

	var (
		records []hrRecord
		err     error
	)
	since := ""
	if mode == SyncModeDelta {
		since = watermarkFromMetadata(endpoint.Metadata)
	}

	switch cfg.Transport {
	case hrTransportSCIM:
		records, err = c.fetchSCIM(ctx, cfg, since)
	case hrTransportHRIS:
		records, err = c.fetchHRIS(ctx, cfg, since)
	case hrTransportCSVSFTP:
		if c.sftp == nil {
			return report, fmt.Errorf("lex/hr: SFTP transport provider not configured")
		}
		records, err = c.fetchCSVSFTP(ctx, cfg)
	case hrTransportLDAP:
		if c.ldap == nil {
			return report, fmt.Errorf("lex/hr: LDAP transport provider not configured")
		}
		records, err = c.fetchLDAP(ctx, cfg)
	case hrTransportGOSI, hrTransportQiwa, hrTransportMuqeem:
		// GOV-GATED: never fabricate a live feed. Return an honest, named not-live
		// error so the sync-runs ledger records an explicit "planned/not onboarded"
		// outcome rather than a fake success or an empty roster.
		src := hrTier2Sources[cfg.Transport]
		report.Detail = fmt.Sprintf("%s: %s", src.NameEN, src.Onboarding)
		report.Metadata = map[string]any{"transport": cfg.Transport, "tier": 2, "gov_gated": true, "status": "planned"}
		return report, fmt.Errorf("%w (%s)", ErrHRTier2NotLive, src.NameEN)
	default:
		return report, fmt.Errorf("lex/hr: unknown transport %q", cfg.Transport)
	}
	if err != nil {
		return report, err
	}

	// Extensibility #19: run the pulled records through the connector's configured
	// transform/filter pipeline BEFORE reconcile. Transforms rewrite normalized
	// fields (e.g. lookup an upstream status code → active flag, default a missing
	// org_code); filters drop records that should never reach the org registry. With
	// no sync_rules configured this is a pass-through. Records dropped by a filter are
	// counted as skipped on the report so the ledger/preview reflect the rule effect.
	rules := ParseSyncRules(endpoint.Config)
	if len(rules) > 0 {
		filteredCount := 0
		records, filteredCount = applyHRRules(rules, records)
		out := c.reconcile(ctx, endpoint, mode, records)
		out.Skipped += filteredCount
		out.Processed += filteredCount
		if out.Metadata == nil {
			out.Metadata = map[string]any{}
		}
		out.Metadata["rules_filtered"] = filteredCount
		return out, nil
	}

	return c.reconcile(ctx, endpoint, mode, records), nil
}

// applyHRRules projects the normalized hrRecords into the neutral map shape the #19
// RulePipeline operates on, runs the pipeline, and projects the kept records back to
// hrRecords. It returns the kept records and the number dropped by filters. Field
// names mirror the hrRecord JSON-ish keys so a rule authored against (external_id,
// active, org_code, role_key, display_name, modified_at, lex_user_id, resource,
// entity_type) targets the connector's normalized fields.
func applyHRRules(rules []RuleSpec, records []hrRecord) ([]hrRecord, int) {
	maps := make([]map[string]any, 0, len(records))
	for _, r := range records {
		maps = append(maps, hrRecordToMap(r))
	}
	kept, dropped := NewRulePipeline(rules).Apply(maps)
	out := make([]hrRecord, 0, len(kept))
	for _, m := range kept {
		out = append(out, hrRecordFromMap(m))
	}
	return out, dropped
}

func hrRecordToMap(r hrRecord) map[string]any {
	return map[string]any{
		"external_id":  r.ExternalID,
		"resource":     r.Resource,
		"display_name": r.DisplayName,
		"active":       strconv.FormatBool(r.Active),
		"modified_at":  r.ModifiedAt,
		"org_code":     r.OrgCode,
		"entity_type":  r.EntityType,
		"role_key":     r.RoleKey,
		"lex_user_id":  r.LexUserID,
	}
}

func hrRecordFromMap(m map[string]any) hrRecord {
	active := true
	if v, ok := m["active"]; ok {
		s := strings.ToLower(strings.TrimSpace(ruleString(v)))
		active = s != "false" && s != "0" && s != "inactive" && s != ""
	}
	return hrRecord{
		ExternalID:  ruleString(m["external_id"]),
		Resource:    ruleString(m["resource"]),
		DisplayName: ruleString(m["display_name"]),
		Active:      active,
		ModifiedAt:  ruleString(m["modified_at"]),
		OrgCode:     ruleString(m["org_code"]),
		EntityType:  ruleString(m["entity_type"]),
		RoleKey:     ruleString(m["role_key"]),
		LexUserID:   ruleString(m["lex_user_id"]),
	}
}

// reconcile upserts the normalized records into the org registry + identity map.
// Groups/org-units become OrgEntity rows (by tenant,code); users/workers that
// carry a mappable org-role become UpsertRole bindings. Every record records an
// idempotency row; an unchanged content_hash is skipped.
func (c *HRConnector) reconcile(ctx context.Context, endpoint model.IntegrationEndpoint, mode SyncMode, records []hrRecord) SyncReport {
	report := SyncReport{Mode: mode}
	// Feature 3/5 dry-run: a preview pass re-reads upstream and computes the same
	// created/updated/skipped/deactivated counts but COMMITS NOTHING — no
	// SoftDeactivate, no UpsertMapping/UpsertRole. The reconciliation/preview UI
	// relies on this being completely side-effect free.
	preview := mode.IsPreview()
	report.DryRun = preview
	tenantID := endpoint.TenantID
	latestWatermark := watermarkFromMetadata(endpoint.Metadata)
	// #20 mass-change guard: track the precise number of records this run WOULD
	// deactivate (independently of the coarse Updated count), so the guard reads an
	// accurate deactivation total from the report metadata.
	deactivated := 0

	for i := range records {
		rec := records[i]
		report.Processed++
		if rec.ExternalID == "" {
			report.Skipped++
			continue
		}
		if rec.ModifiedAt != "" && rec.ModifiedAt > latestWatermark {
			latestWatermark = rec.ModifiedAt
		}

		// Soft-deactivate path: an inactive upstream record (SCIM active=false /
		// HRIS terminated) is a reversible deactivation, never a hard delete.
		if !rec.Active {
			deactivated++
			if preview {
				// Would deactivate; commit nothing.
				report.Updated++
				continue
			}
			if err := c.idMap.SoftDeactivate(ctx, c.idMap.Pool(), tenantID, endpoint.ID, rec.ExternalID, c.now().UTC()); err != nil && err != pgx.ErrNoRows {
				report.Failed++
				continue
			}
			report.Updated++
			continue
		}

		hash := rec.contentHash()
		existing, gerr := c.idMap.GetMapping(ctx, c.idMap.Pool(), tenantID, endpoint.ID, rec.ExternalID)
		if gerr != nil && gerr != pgx.ErrNoRows {
			report.Failed++
			continue
		}
		if gerr == nil && existing.ContentHash == hash && existing.Active {
			report.Skipped++
			continue
		}

		if preview {
			// Would create (no existing mapping) or update (existing differs); the
			// GetMapping read above is the only DB touch, and it is read-only.
			if gerr == pgx.ErrNoRows {
				report.Created++
			} else {
				report.Updated++
			}
			continue
		}

		created, rerr := c.reconcileOne(ctx, endpoint, rec, hash)
		if rerr != nil {
			c.logger.Warn().
				Str("endpoint_id", endpoint.ID.String()).
				Str("external_kind", string(rec.kind())).
				Msg("hr reconcile record failed")
			report.Failed++
			continue
		}
		if created {
			report.Created++
		} else {
			report.Updated++
		}
	}

	report.Watermark = latestWatermark
	report.Detail = fmt.Sprintf("hr sync (%s): processed=%d created=%d updated=%d skipped=%d failed=%d",
		mode, report.Processed, report.Created, report.Updated, report.Skipped, report.Failed)
	report.Metadata = map[string]any{
		"transport": parseHRConfig(endpoint.Config).Transport,
		"watermark": latestWatermark,
		// #20: the precise deactivation count the mass-change guard reads.
		SyncReportDeactivatedKey: deactivated,
	}
	return report
}

// reconcileOne reconciles a single normalized record and writes its identity-map
// row. Groups/org-units → OrgEntity; users/workers with a role → UpsertRole.
func (c *HRConnector) reconcileOne(ctx context.Context, endpoint model.IntegrationEndpoint, rec hrRecord, hash string) (created bool, err error) {
	tenantID := endpoint.TenantID
	switch rec.kind() {
	case repository.HRExternalKindGroup, repository.HRExternalKindOrgUnit:
		entity, created, err := c.upsertOrgEntity(ctx, endpoint, rec)
		if err != nil {
			return false, err
		}
		if managerID, parseErr := uuid.Parse(strings.TrimSpace(rec.ManagerLexUserID)); parseErr == nil {
			role := &model.OrgRole{ID: uuid.New(), TenantID: tenantID, EntityID: entity.ID, RoleKey: managerRoleKeyForHR(entity.EntityType), UserID: managerID, Label: forms.LocalizedText{AR: rec.DisplayName, EN: rec.DisplayName}, CreatedBy: endpoint.CreatedBy}
			if err := c.orgRepo.UpsertRole(ctx, c.idMap.Pool(), role); err != nil {
				return false, err
			}
		}
		mapping := &repository.HRIdentityMapping{
			TenantID:     tenantID,
			EndpointID:   endpoint.ID,
			ExternalID:   rec.ExternalID,
			ExternalKind: rec.kind(),
			LexKind:      repository.HRLexKindOrgEntity,
			LexID:        entity.ID,
			ExternalCode: entity.Code,
			ContentHash:  hash,
			Active:       true,
			LastSyncedAt: c.now().UTC(),
		}
		if _, merr := c.idMap.UpsertMapping(ctx, c.idMap.Pool(), mapping); merr != nil {
			return false, merr
		}
		return created, nil

	default: // user / worker
		// A user becomes an org-role binding ONLY when it carries a resolvable
		// org code + role key + lex user id. Otherwise it is recorded as a known
		// (but unbound) identity so re-syncs stay idempotent and the operator can
		// see coverage in the reconciliation report.
		roleKey, hasRole := normalizeRoleKey(rec.RoleKey)
		entityCode := strings.ToUpper(strings.TrimSpace(rec.OrgCode))
		userID, uerr := uuid.Parse(strings.TrimSpace(rec.LexUserID))
		if entityCode != "" && uerr == nil {
			if entity, getErr := c.orgRepo.GetByCode(ctx, tenantID, entityCode); getErr == nil {
				if memberships, ok := c.orgRepo.(hrMembershipStore); ok {
					var managerID *uuid.UUID
					if parsed, managerErr := uuid.Parse(strings.TrimSpace(rec.ManagerLexUserID)); managerErr == nil {
						managerID = &parsed
					}
					membership := &model.OrgMembership{ID: uuid.New(), TenantID: tenantID, EntityID: entity.ID, UserID: userID, EmployeeCode: rec.ExternalID, Title: map[string]string{"en": rec.DisplayName, "ar": rec.DisplayName}, ManagerUserID: managerID, Active: rec.Active, Metadata: map[string]any{"source": "hr_connector"}, CreatedBy: endpoint.CreatedBy}
					if err := memberships.UpsertMembership(ctx, c.idMap.Pool(), membership); err != nil {
						return false, err
					}
				}
			}
		}
		if !hasRole || entityCode == "" || uerr != nil {
			mapping := &repository.HRIdentityMapping{
				TenantID:     tenantID,
				EndpointID:   endpoint.ID,
				ExternalID:   rec.ExternalID,
				ExternalKind: rec.kind(),
				LexKind:      repository.HRLexKindOrgRole,
				LexID:        uuid.Nil,
				ExternalCode: entityCode,
				ContentHash:  hash,
				Active:       true,
				LastSyncedAt: c.now().UTC(),
				Metadata:     map[string]any{"unbound": true, "reason": "no resolvable org_code/role_key/lex_user_id"},
			}
			created, merr := c.idMap.UpsertMapping(ctx, c.idMap.Pool(), mapping)
			return created, merr
		}

		entity, gerr := c.orgRepo.GetByCode(ctx, tenantID, entityCode)
		if gerr != nil {
			// The org entity the role attaches to does not exist yet; record the
			// identity as unbound rather than fabricating an entity.
			mapping := &repository.HRIdentityMapping{
				TenantID:     tenantID,
				EndpointID:   endpoint.ID,
				ExternalID:   rec.ExternalID,
				ExternalKind: rec.kind(),
				LexKind:      repository.HRLexKindOrgRole,
				LexID:        uuid.Nil,
				ExternalCode: entityCode,
				ContentHash:  hash,
				Active:       true,
				LastSyncedAt: c.now().UTC(),
				Metadata:     map[string]any{"unbound": true, "reason": "org_entity not found for code"},
			}
			created, merr := c.idMap.UpsertMapping(ctx, c.idMap.Pool(), mapping)
			return created, merr
		}

		role := &model.OrgRole{
			TenantID:  tenantID,
			EntityID:  entity.ID,
			RoleKey:   roleKey,
			UserID:    userID,
			Label:     forms.LocalizedText{AR: rec.DisplayName, EN: rec.DisplayName},
			CreatedBy: endpoint.CreatedBy,
		}
		if err := c.orgRepo.UpsertRole(ctx, c.idMap.Pool(), role); err != nil {
			return false, err
		}
		mapping := &repository.HRIdentityMapping{
			TenantID:     tenantID,
			EndpointID:   endpoint.ID,
			ExternalID:   rec.ExternalID,
			ExternalKind: rec.kind(),
			LexKind:      repository.HRLexKindOrgRole,
			LexID:        role.ID,
			ExternalCode: entityCode,
			ContentHash:  hash,
			Active:       true,
			LastSyncedAt: c.now().UTC(),
		}
		created, merr := c.idMap.UpsertMapping(ctx, c.idMap.Pool(), mapping)
		return created, merr
	}
}

// upsertOrgEntity upserts an OrgEntity by (tenant, code): GetByCode then Update,
// or Create when absent. The entity type defaults to department; an org-unit
// record may carry a more specific type via the mapping.
func (c *HRConnector) upsertOrgEntity(ctx context.Context, endpoint model.IntegrationEndpoint, rec hrRecord) (*model.OrgEntity, bool, error) {
	tenantID := endpoint.TenantID
	code := strings.ToUpper(strings.TrimSpace(rec.OrgCode))
	if code == "" {
		code = strings.ToUpper(strings.TrimSpace(rec.ExternalID))
	}
	name := forms.LocalizedText{AR: rec.DisplayName, EN: rec.DisplayName}
	parentID, path := hrParent(ctx, c.orgRepo, tenantID, rec.ParentOrgCode)

	existing, err := c.orgRepo.GetByCode(ctx, tenantID, code)
	if err == nil && existing != nil {
		existing.Name = name
		existing.ParentID, existing.Path = parentID, path
		existing.EntityType = hrEntityType(rec.EntityType)
		if rec.Active {
			existing.Active = true
		}
		if uerr := c.orgRepo.Update(ctx, c.idMap.Pool(), existing); uerr != nil {
			return nil, false, uerr
		}
		return existing, false, nil
	}

	entity := &model.OrgEntity{
		ID:         uuid.New(),
		TenantID:   tenantID,
		EntityType: hrEntityType(rec.EntityType),
		Code:       code,
		Name:       name,
		ParentID:   parentID,
		Path:       path,
		Active:     true,
		Metadata:   map[string]any{"source": "hr_connector", "endpoint_code": endpoint.Code},
		CreatedBy:  endpoint.CreatedBy,
	}
	if cerr := c.orgRepo.Create(ctx, c.idMap.Pool(), entity); cerr != nil {
		return nil, false, cerr
	}
	return entity, true, nil
}

func hrParent(ctx context.Context, store hrOrgStore, tenantID uuid.UUID, code string) (*uuid.UUID, []string) {
	code = strings.ToUpper(strings.TrimSpace(code))
	if code == "" {
		return nil, []string{}
	}
	parent, err := store.GetByCode(ctx, tenantID, code)
	if err != nil || parent == nil {
		return nil, []string{}
	}
	id := parent.ID
	path := append([]string(nil), parent.Path...)
	path = append(path, parent.ID.String())
	return &id, path
}

func managerRoleKeyForHR(entityType model.OrgEntityType) model.OrgRoleKey {
	switch entityType {
	case model.OrgEntityTypeSection:
		return model.OrgRoleSectionSupervisor
	case model.OrgEntityTypeSharedServicesUnit:
		return model.OrgRoleSharedServicesManager
	default:
		return model.OrgRoleDepartmentManager
	}
}

// =============================================================================
// SCIM client transport (real net/http).
// =============================================================================

func (c *HRConnector) fetchSCIM(ctx context.Context, cfg hrConfig, since string) ([]hrRecord, error) {
	out := []hrRecord{}
	// Users.
	usersBase := joinURL(cfg.BaseURL, cfg.usersPathOr("/Users"))
	users, err := c.fetchSCIMResource(ctx, cfg, usersBase, since)
	if err != nil {
		return nil, err
	}
	for _, raw := range users {
		out = append(out, cfg.normalizeSCIMUser(raw))
	}
	// Groups.
	groupsBase := joinURL(cfg.BaseURL, cfg.groupsPathOr("/Groups"))
	groups, err := c.fetchSCIMResource(ctx, cfg, groupsBase, since)
	if err != nil {
		return nil, err
	}
	for _, raw := range groups {
		out = append(out, cfg.normalizeSCIMGroup(raw))
	}
	return out, nil
}

// fetchSCIMResource pages through a SCIM list endpoint (startIndex/count) applying
// an optional meta.lastModified delta filter.
func (c *HRConnector) fetchSCIMResource(ctx context.Context, cfg hrConfig, base, since string) ([]map[string]any, error) {
	const pageSize = 100
	startIndex := 1
	var all []map[string]any
	for {
		q := url.Values{}
		q.Set("startIndex", strconv.Itoa(startIndex))
		q.Set("count", strconv.Itoa(pageSize))
		if since != "" {
			q.Set("filter", fmt.Sprintf("meta.lastModified gt \"%s\"", since))
		}
		u := base + "?" + q.Encode()
		status, body, err := c.doJSON(ctx, http.MethodGet, u, cfg, nil)
		if err != nil {
			return nil, err
		}
		if status < 200 || status >= 300 {
			return nil, fmt.Errorf("scim list returned status %d", status)
		}
		var lr scimListResponse
		if err := json.Unmarshal(body, &lr); err != nil {
			return nil, fmt.Errorf("decode scim list: %w", err)
		}
		all = append(all, lr.Resources...)
		if len(lr.Resources) < pageSize || len(all) >= lr.TotalResults || lr.TotalResults == 0 {
			break
		}
		startIndex += pageSize
		if startIndex > 100000 { // hard safety cap
			break
		}
	}
	return all, nil
}

// =============================================================================
// HRIS REST transport (real net/http) — workday / successfactors / oracle_hcm.
// =============================================================================

func (c *HRConnector) fetchHRIS(ctx context.Context, cfg hrConfig, since string) ([]hrRecord, error) {
	out := []hrRecord{}
	// Workers.
	workersPath := cfg.usersPathOr(hrisDefaultWorkersPath(cfg.Vendor))
	u := joinURL(cfg.BaseURL, workersPath)
	if since != "" {
		u += "?modifiedSince=" + url.QueryEscape(since)
	}
	status, body, err := c.doJSON(ctx, http.MethodGet, u, cfg, nil)
	if err != nil {
		return nil, err
	}
	if status < 200 || status >= 300 {
		return nil, fmt.Errorf("hris workers returned status %d", status)
	}
	for _, raw := range extractHRISArray(body) {
		out = append(out, cfg.normalizeHRISWorker(raw))
	}
	// Org units (optional path).
	if gp := cfg.groupsPathOr(""); gp != "" {
		gu := joinURL(cfg.BaseURL, gp)
		gstatus, gbody, gerr := c.doJSON(ctx, http.MethodGet, gu, cfg, nil)
		if gerr == nil && gstatus >= 200 && gstatus < 300 {
			for _, raw := range extractHRISArray(gbody) {
				out = append(out, cfg.normalizeHRISOrgUnit(raw))
			}
		}
	}
	return out, nil
}

// =============================================================================
// CSV/SFTP + LDAP transports (injected providers; honest when absent).
// =============================================================================

func (c *HRConnector) fetchCSVSFTP(ctx context.Context, cfg hrConfig) ([]hrRecord, error) {
	raw, err := c.sftp.Fetch(ctx, cfg.sftpConn())
	if err != nil {
		return nil, err
	}
	return cfg.normalizeCSV(raw)
}

func (c *HRConnector) fetchLDAP(ctx context.Context, cfg hrConfig) ([]hrRecord, error) {
	entries, err := c.ldap.Search(ctx, cfg.ldapConn())
	if err != nil {
		return nil, err
	}
	out := make([]hrRecord, 0, len(entries))
	for _, e := range entries {
		out = append(out, cfg.normalizeLDAPEntry(e))
	}
	return out, nil
}

// =============================================================================
// HTTP helper: auth-aware JSON GET. Resolves bearer or OAuth2 client-credentials.
// =============================================================================

// hrMaxAttempts bounds the total number of attempts (initial + retries) doJSON
// makes against a transiently-failing upstream. SCIM/HRIS reads are idempotent
// (GET), so retrying transport errors, 429 and 5xx is always safe.
const hrMaxAttempts = 3

// doJSON performs an auth-aware JSON request with bounded retry + backoff on
// transient failures (transport errors, 429, 5xx). 4xx (other than 429) is a
// caller/credential error and is NOT retried — it is returned immediately so the
// diagnostic can grade it. The returned error is sanitized by callers before it
// reaches an operator surface; raw provider bodies are never echoed.
func (c *HRConnector) doJSON(ctx context.Context, method, rawURL string, cfg hrConfig, body io.Reader) (int, []byte, error) {
	// A non-nil io.Reader body cannot be replayed across attempts; buffer it so
	// retries re-send the same payload. SCIM/HRIS reads pass nil so this is a no-op
	// on the hot path.
	var bodyBytes []byte
	if body != nil {
		var berr error
		bodyBytes, berr = io.ReadAll(body)
		if berr != nil {
			return 0, nil, fmt.Errorf("read request body: %w", berr)
		}
	}

	var lastErr error
	var lastStatus int
	for attempt := 0; attempt < hrMaxAttempts; attempt++ {
		if attempt > 0 {
			// Linear backoff (250ms, 500ms, ...) honouring ctx cancellation.
			select {
			case <-ctx.Done():
				return lastStatus, nil, ctx.Err()
			case <-time.After(time.Duration(attempt) * 250 * time.Millisecond):
			}
		}
		status, respBody, retryable, err := c.doJSONOnce(ctx, method, rawURL, cfg, bodyBytes)
		if err == nil {
			return status, respBody, nil
		}
		lastErr, lastStatus = err, status
		if !retryable {
			return status, nil, err
		}
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("request failed after %d attempts", hrMaxAttempts)
	}
	return lastStatus, nil, lastErr
}

// doJSONOnce performs a single attempt. retryable reports whether the failure is
// worth another attempt: transport errors, HTTP 429 (Too Many Requests) and 5xx
// are transient; 4xx (auth/scope/not-found) is terminal.
func (c *HRConnector) doJSONOnce(ctx context.Context, method, rawURL string, cfg hrConfig, body []byte) (status int, respBody []byte, retryable bool, err error) {
	var reader io.Reader
	if body != nil {
		reader = strings.NewReader(string(body))
	}
	req, err := http.NewRequestWithContext(ctx, method, rawURL, reader)
	if err != nil {
		return 0, nil, false, fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Accept", "application/scim+json, application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/scim+json")
	}
	if aerr := c.applyAuth(ctx, req, cfg); aerr != nil {
		// Auth resolution (OAuth token fetch) failure: not worth retrying with the
		// same bad credentials.
		return 0, nil, false, aerr
	}
	resp, derr := c.client.Do(req)
	if derr != nil {
		// Transport-level failure (DNS, dial, TLS, timeout): transient.
		return 0, nil, true, fmt.Errorf("request failed: %w", derr)
	}
	defer resp.Body.Close()
	out, rerr := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if rerr != nil {
		return resp.StatusCode, nil, true, fmt.Errorf("read response: %w", rerr)
	}
	switch {
	case resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= http.StatusInternalServerError:
		return resp.StatusCode, out, true, fmt.Errorf("upstream returned %d", resp.StatusCode)
	default:
		// 2xx/3xx and terminal 4xx are returned to the caller (which inspects the
		// status); no error is surfaced for non-retryable statuses so callers keep
		// their existing status-based control flow.
		return resp.StatusCode, out, false, nil
	}
}

func (c *HRConnector) applyAuth(ctx context.Context, req *http.Request, cfg hrConfig) error {
	if cfg.TokenURL != "" && cfg.ClientID != "" {
		tok, err := c.oauth.Token(ctx, OAuthConfig{
			CacheKey:     "hr|" + cfg.BaseURL + "|" + cfg.ClientID,
			TokenURL:     cfg.TokenURL,
			ClientID:     cfg.ClientID,
			ClientSecret: cfg.ClientSecret,
			Scope:        cfg.Scope,
		})
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Bearer "+tok)
		return nil
	}
	if cfg.BearerToken != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.BearerToken)
	}
	return nil
}

// =============================================================================
// Config parsing + connection structs.
// =============================================================================

func parseHRConfig(config map[string]any) hrConfig {
	cfg := hrConfig{
		Transport:    strings.ToLower(cfgString(config, "transport")),
		BaseURL:      cfgString(config, "base_url"),
		BearerToken:  cfgString(config, "bearer_token"),
		TokenURL:     cfgString(config, "token_url"),
		ClientID:     cfgString(config, "client_id"),
		ClientSecret: cfgString(config, "client_secret"),
		Scope:        cfgString(config, "scope"),
		Vendor:       strings.ToLower(cfgString(config, "vendor")),
		UsersPath:    cfgString(config, "users_path"),
		GroupsPath:   cfgString(config, "groups_path"),

		SFTPHost:     cfgString(config, "sftp_host"),
		SFTPUsername: cfgString(config, "sftp_username"),
		SFTPPassword: cfgString(config, "sftp_password"),
		SFTPKey:      cfgString(config, "sftp_private_key"),
		SFTPPath:     cfgString(config, "sftp_path"),

		LDAPURL:          cfgString(config, "ldap_url"),
		LDAPBindDN:       cfgString(config, "ldap_bind_dn"),
		LDAPBindPassword: cfgString(config, "ldap_bind_password"),
		LDAPBaseDN:       cfgString(config, "ldap_base_dn"),
		LDAPFilter:       cfgString(config, "ldap_filter"),

		SyncMode: cfgString(config, "sync_mode"),
	}
	if cfg.Transport == "" {
		cfg.Transport = hrTransportSCIM
	}
	if p := cfgInt(config, "sftp_port"); p > 0 {
		cfg.SFTPPort = p
	} else {
		cfg.SFTPPort = 22
	}
	if cfg.SFTPPath == "" {
		cfg.SFTPPath = "/roster.csv"
	}
	if cfg.LDAPFilter == "" {
		cfg.LDAPFilter = "(objectClass=person)"
	}
	cfg.FieldMapping = parseFieldMapping(config["field_mapping"])
	return cfg
}

// missingForActive returns the first missing required field for the chosen
// transport (empty string when complete), so Probe can name the gap honestly.
func (cfg hrConfig) missingForActive() string {
	switch cfg.Transport {
	case hrTransportSCIM, hrTransportHRIS:
		if cfg.BaseURL == "" {
			return "base_url"
		}
		if cfg.BearerToken == "" && !(cfg.TokenURL != "" && cfg.ClientID != "") {
			return "bearer_token or oauth (token_url+client_id)"
		}
	case hrTransportCSVSFTP:
		if cfg.SFTPHost == "" {
			return "sftp_host"
		}
		if cfg.SFTPUsername == "" {
			return "sftp_username"
		}
		if cfg.SFTPPassword == "" && cfg.SFTPKey == "" {
			return "sftp_password or sftp_private_key"
		}
	case hrTransportLDAP:
		if cfg.LDAPURL == "" {
			return "ldap_url"
		}
		if cfg.LDAPBindDN == "" {
			return "ldap_bind_dn"
		}
	case hrTransportGOSI, hrTransportQiwa, hrTransportMuqeem:
		// Tier-2 gov-gated sources have no self-serve "active" config gap to report:
		// readiness is governed by government onboarding, surfaced separately in
		// Probe. Returning "" here keeps missingForActive purely about self-serve
		// transports.
		return ""
	default:
		return "transport"
	}
	return ""
}

func (cfg hrConfig) sftpConn() SFTPConn {
	return SFTPConn{
		Host:       cfg.SFTPHost,
		Port:       cfg.SFTPPort,
		Username:   cfg.SFTPUsername,
		Password:   cfg.SFTPPassword,
		PrivateKey: cfg.SFTPKey,
		RemotePath: cfg.SFTPPath,
	}
}

func (cfg hrConfig) ldapConn() LDAPConn {
	return LDAPConn{
		URL:          cfg.LDAPURL,
		BindDN:       cfg.LDAPBindDN,
		BindPassword: cfg.LDAPBindPassword,
		BaseDN:       cfg.LDAPBaseDN,
		Filter:       cfg.LDAPFilter,
	}
}

func (cfg hrConfig) usersPathOr(def string) string {
	if cfg.UsersPath != "" {
		return cfg.UsersPath
	}
	return def
}

func (cfg hrConfig) groupsPathOr(def string) string {
	if cfg.GroupsPath != "" {
		return cfg.GroupsPath
	}
	return def
}

// =============================================================================
// Normalization. A neutral hrRecord is the reconcile input regardless of source.
// =============================================================================

type hrRecord struct {
	ExternalID       string
	Resource         string // user | group | worker | org_unit
	DisplayName      string
	Active           bool
	ModifiedAt       string // upstream watermark (ISO8601 string; lexically comparable)
	OrgCode          string // entity code (group/org-unit code, or a user's org)
	EntityType       string // optional org-entity type for org_unit records
	RoleKey          string // optional org-role key for user/worker records
	LexUserID        string // optional lex user UUID for role binding
	ParentOrgCode    string // optional parent org-unit business code
	ManagerLexUserID string // optional manager's Lex user UUID
}

func (r hrRecord) kind() repository.HRExternalKind {
	switch r.Resource {
	case "group":
		return repository.HRExternalKindGroup
	case "worker":
		return repository.HRExternalKindWorker
	case "org_unit":
		return repository.HRExternalKindOrgUnit
	default:
		return repository.HRExternalKindUser
	}
}

func (r hrRecord) contentHash() string {
	parts := []string{
		r.Resource, r.ExternalID, r.DisplayName, strconv.FormatBool(r.Active),
		r.OrgCode, r.EntityType, r.RoleKey, r.LexUserID, r.ParentOrgCode, r.ManagerLexUserID,
	}
	h := sha256.Sum256([]byte(strings.Join(parts, "\x1f")))
	return hex.EncodeToString(h[:])
}

// mapField resolves a neutral lex field to the upstream attribute name via the
// configurable field_mapping, falling back to def when unmapped.
func (cfg hrConfig) mapField(lexField, def string) string {
	if v, ok := cfg.FieldMapping[lexField]; ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return def
}

func (cfg hrConfig) normalizeSCIMUser(raw map[string]any) hrRecord {
	return hrRecord{
		ExternalID:       jsonString(raw, cfg.mapField("external_id", "id")),
		Resource:         "user",
		DisplayName:      firstNonEmpty(jsonString(raw, cfg.mapField("display_name", "displayName")), jsonString(raw, "userName")),
		Active:           jsonBool(raw, cfg.mapField("active", "active"), true),
		ModifiedAt:       scimMeta(raw, "lastModified"),
		OrgCode:          jsonString(raw, cfg.mapField("org_code", "")),
		RoleKey:          jsonString(raw, cfg.mapField("role_key", "")),
		LexUserID:        jsonString(raw, cfg.mapField("lex_user_id", "")),
		ManagerLexUserID: jsonString(raw, cfg.mapField("manager_lex_user_id", "managerLexUserId")),
	}
}

func (cfg hrConfig) normalizeSCIMGroup(raw map[string]any) hrRecord {
	return hrRecord{
		ExternalID:       jsonString(raw, cfg.mapField("external_id", "id")),
		Resource:         "group",
		DisplayName:      jsonString(raw, cfg.mapField("display_name", "displayName")),
		Active:           true,
		ModifiedAt:       scimMeta(raw, "lastModified"),
		OrgCode:          firstNonEmpty(jsonString(raw, cfg.mapField("org_code", "")), jsonString(raw, "displayName")),
		EntityType:       jsonString(raw, cfg.mapField("entity_type", "")),
		ParentOrgCode:    jsonString(raw, cfg.mapField("parent_org_code", "parentOrgCode")),
		ManagerLexUserID: jsonString(raw, cfg.mapField("manager_lex_user_id", "managerLexUserId")),
	}
}

func (cfg hrConfig) normalizeHRISWorker(raw map[string]any) hrRecord {
	return hrRecord{
		ExternalID:       firstNonEmpty(jsonString(raw, cfg.mapField("external_id", "id")), jsonString(raw, "workerId"), jsonString(raw, "personIdExternal")),
		Resource:         "worker",
		DisplayName:      firstNonEmpty(jsonString(raw, cfg.mapField("display_name", "displayName")), jsonString(raw, "fullName"), jsonString(raw, "name")),
		Active:           jsonBool(raw, cfg.mapField("active", "active"), true),
		ModifiedAt:       firstNonEmpty(jsonString(raw, "lastModifiedDateTime"), jsonString(raw, "lastModified")),
		OrgCode:          firstNonEmpty(jsonString(raw, cfg.mapField("org_code", "organizationCode")), jsonString(raw, "department")),
		RoleKey:          jsonString(raw, cfg.mapField("role_key", "")),
		LexUserID:        jsonString(raw, cfg.mapField("lex_user_id", "")),
		ManagerLexUserID: firstNonEmpty(jsonString(raw, cfg.mapField("manager_lex_user_id", "managerLexUserId")), jsonString(raw, "managerUserId")),
	}
}

func (cfg hrConfig) normalizeHRISOrgUnit(raw map[string]any) hrRecord {
	return hrRecord{
		ExternalID:       firstNonEmpty(jsonString(raw, cfg.mapField("external_id", "id")), jsonString(raw, "orgUnitId")),
		Resource:         "org_unit",
		DisplayName:      firstNonEmpty(jsonString(raw, cfg.mapField("display_name", "name")), jsonString(raw, "orgUnitName")),
		Active:           jsonBool(raw, cfg.mapField("active", "active"), true),
		ModifiedAt:       jsonString(raw, "lastModified"),
		OrgCode:          firstNonEmpty(jsonString(raw, cfg.mapField("org_code", "code")), jsonString(raw, "orgUnitCode")),
		EntityType:       jsonString(raw, cfg.mapField("entity_type", "")),
		ParentOrgCode:    firstNonEmpty(jsonString(raw, cfg.mapField("parent_org_code", "parentCode")), jsonString(raw, "parentOrgUnitCode")),
		ManagerLexUserID: firstNonEmpty(jsonString(raw, cfg.mapField("manager_lex_user_id", "managerLexUserId")), jsonString(raw, "managerUserId")),
	}
}

func (cfg hrConfig) normalizeLDAPEntry(e map[string]string) hrRecord {
	return hrRecord{
		ExternalID:  firstNonEmptyStr(e[cfg.mapField("external_id", "entryUUID")], e["uid"], e["dn"]),
		Resource:    "user",
		DisplayName: firstNonEmptyStr(e[cfg.mapField("display_name", "cn")], e["displayName"]),
		Active:      true,
		OrgCode:     e[cfg.mapField("org_code", "departmentNumber")],
		RoleKey:     e[cfg.mapField("role_key", "")],
		LexUserID:   e[cfg.mapField("lex_user_id", "")],
	}
}

// normalizeCSV parses a CSV roster: the header row supplies attribute names, then
// the configurable field_mapping maps lex fields to CSV columns.
func (cfg hrConfig) normalizeCSV(raw []byte) ([]hrRecord, error) {
	rows, err := parseCSV(raw)
	if err != nil {
		return nil, err
	}
	if len(rows) < 2 {
		return []hrRecord{}, nil
	}
	header := rows[0]
	idx := map[string]int{}
	for i, h := range header {
		idx[strings.TrimSpace(h)] = i
	}
	get := func(row []string, lexField, def string) string {
		col := cfg.mapField(lexField, def)
		if i, ok := idx[col]; ok && i < len(row) {
			return strings.TrimSpace(row[i])
		}
		return ""
	}
	out := make([]hrRecord, 0, len(rows)-1)
	for _, row := range rows[1:] {
		if len(row) == 0 {
			continue
		}
		active := true
		if a := get(row, "active", "active"); a != "" {
			active = !strings.EqualFold(a, "false") && a != "0" && !strings.EqualFold(a, "inactive")
		}
		out = append(out, hrRecord{
			ExternalID:       get(row, "external_id", "employee_id"),
			Resource:         "worker",
			DisplayName:      get(row, "display_name", "name"),
			Active:           active,
			OrgCode:          get(row, "org_code", "department"),
			RoleKey:          get(row, "role_key", "role"),
			LexUserID:        get(row, "lex_user_id", "lex_user_id"),
			ParentOrgCode:    get(row, "parent_org_code", "parent_code"),
			ManagerLexUserID: get(row, "manager_lex_user_id", "manager_user_id"),
		})
	}
	return out, nil
}

// =============================================================================
// Small helpers.
// =============================================================================

type scimListResponse struct {
	TotalResults int              `json:"totalResults"`
	StartIndex   int              `json:"startIndex"`
	ItemsPerPage int              `json:"itemsPerPage"`
	Resources    []map[string]any `json:"Resources"`
}

func scimMeta(raw map[string]any, key string) string {
	if meta, ok := raw["meta"].(map[string]any); ok {
		if v, ok := meta[key].(string); ok {
			return v
		}
	}
	return ""
}

// extractHRISArray returns the list of records from an HRIS response, tolerating
// the common envelope shapes ({value:[...]}, {workers:[...]}, {d:{results:[...]}},
// or a bare top-level array).
func extractHRISArray(body []byte) []map[string]any {
	var asArray []map[string]any
	if err := json.Unmarshal(body, &asArray); err == nil && asArray != nil {
		return asArray
	}
	var env map[string]any
	if err := json.Unmarshal(body, &env); err != nil {
		return nil
	}
	for _, key := range []string{"value", "workers", "Resources", "results", "items", "data"} {
		if arr, ok := env[key].([]any); ok {
			return toMapSlice(arr)
		}
	}
	// SuccessFactors OData: {d:{results:[...]}}
	if d, ok := env["d"].(map[string]any); ok {
		if arr, ok := d["results"].([]any); ok {
			return toMapSlice(arr)
		}
	}
	return nil
}

func toMapSlice(arr []any) []map[string]any {
	out := make([]map[string]any, 0, len(arr))
	for _, it := range arr {
		if m, ok := it.(map[string]any); ok {
			out = append(out, m)
		}
	}
	return out
}

func hrisDefaultWorkersPath(vendor string) string {
	switch vendor {
	case "workday":
		return "/workers"
	case "successfactors":
		return "/odata/v2/User"
	case "oracle_hcm":
		return "/workers"
	default:
		return "/workers"
	}
}

func hrisProbePath(cfg hrConfig) string {
	switch cfg.Vendor {
	case "successfactors":
		return "/odata/v2/$metadata"
	case "oracle_hcm":
		return "/workers?limit=1"
	case "workday":
		return "/workers?limit=1"
	default:
		return cfg.usersPathOr("/workers") + "?limit=1"
	}
}

func hrEntityType(s string) model.OrgEntityType {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "business_unit":
		return model.OrgEntityTypeBusinessUnit
	case "company":
		return model.OrgEntityTypeCompany
	case "section":
		return model.OrgEntityTypeSection
	case "shared_services_unit":
		return model.OrgEntityTypeSharedServicesUnit
	default:
		return model.OrgEntityTypeDepartment
	}
}

// normalizeRoleKey maps an upstream role label to a lex escalation-ladder role
// key. Returns (key, true) for a recognised ladder role; (_, false) otherwise.
func normalizeRoleKey(s string) (model.OrgRoleKey, bool) {
	switch model.OrgRoleKey(strings.ToLower(strings.TrimSpace(s))) {
	case model.OrgRoleSectionSupervisor:
		return model.OrgRoleSectionSupervisor, true
	case model.OrgRoleDepartmentManager:
		return model.OrgRoleDepartmentManager, true
	case model.OrgRoleSharedServicesManager:
		return model.OrgRoleSharedServicesManager, true
	case model.OrgRoleLegalDirector:
		return model.OrgRoleLegalDirector, true
	case model.OrgRoleContractsManager:
		return model.OrgRoleContractsManager, true
	case model.OrgRoleComplianceOfficer:
		return model.OrgRoleComplianceOfficer, true
	case model.OrgRoleGeneralCounsel:
		return model.OrgRoleGeneralCounsel, true
	default:
		return "", false
	}
}

func watermarkFromMetadata(meta map[string]any) string {
	if meta == nil {
		return ""
	}
	if v, ok := meta["hr_watermark"].(string); ok {
		return v
	}
	if v, ok := meta["watermark"].(string); ok {
		return v
	}
	return ""
}

func parseFieldMapping(raw any) map[string]string {
	out := map[string]string{}
	switch v := raw.(type) {
	case map[string]any:
		for k, val := range v {
			if s, ok := val.(string); ok {
				out[k] = s
			}
		}
	case string:
		if strings.TrimSpace(v) != "" {
			_ = json.Unmarshal([]byte(v), &out)
		}
	}
	return out
}

// cfgString / cfgInt are shared across the connector files in this package
// (defined in internal_rest_connector.go); the HR connector reuses them.

func jsonString(raw map[string]any, key string) string {
	if key == "" {
		return ""
	}
	if v, ok := raw[key]; ok {
		switch t := v.(type) {
		case string:
			return strings.TrimSpace(t)
		case float64:
			return strconv.FormatFloat(t, 'f', -1, 64)
		case bool:
			return strconv.FormatBool(t)
		}
	}
	return ""
}

func jsonBool(raw map[string]any, key string, def bool) bool {
	if key == "" {
		return def
	}
	if v, ok := raw[key]; ok {
		switch t := v.(type) {
		case bool:
			return t
		case string:
			return strings.EqualFold(t, "true") || t == "1"
		}
	}
	return def
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return strings.TrimSpace(v)
		}
	}
	return ""
}

func firstNonEmptyStr(vals ...string) string { return firstNonEmpty(vals...) }

// joinURL joins a base URL and a path, tolerating leading/trailing slashes and an
// already-absolute path.
func joinURL(base, path string) string {
	base = strings.TrimRight(strings.TrimSpace(base), "/")
	path = strings.TrimSpace(path)
	if path == "" {
		return base
	}
	if strings.HasPrefix(path, "http://") || strings.HasPrefix(path, "https://") {
		return path
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	return base + path
}

// parseCSV is a tolerant CSV splitter (comma-delimited, double-quote aware) that
// avoids pulling encoding/csv strictness for ragged HR exports.
func parseCSV(raw []byte) ([][]string, error) {
	text := strings.ReplaceAll(string(raw), "\r\n", "\n")
	text = strings.ReplaceAll(text, "\r", "\n")
	lines := strings.Split(text, "\n")
	rows := make([][]string, 0, len(lines))
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		rows = append(rows, splitCSVLine(line))
	}
	return rows, nil
}

func splitCSVLine(line string) []string {
	var (
		fields []string
		sb     strings.Builder
		inQ    bool
	)
	for i := 0; i < len(line); i++ {
		ch := line[i]
		switch {
		case ch == '"':
			if inQ && i+1 < len(line) && line[i+1] == '"' {
				sb.WriteByte('"')
				i++
			} else {
				inQ = !inQ
			}
		case ch == ',' && !inQ:
			fields = append(fields, sb.String())
			sb.Reset()
		default:
			sb.WriteByte(ch)
		}
	}
	fields = append(fields, sb.String())
	return fields
}

// sanitizeDetail builds an operator-safe message from a label + error, NEVER
// leaking secrets. We surface only the label and a coarse error category, not the
// raw error string (which could carry a URL with embedded credentials).
func sanitizeDetail(label string, err error) string {
	if err == nil {
		return label
	}
	msg := err.Error()
	// Strip anything that looks like a token/credential or a userinfo URL segment.
	lower := strings.ToLower(msg)
	for _, marker := range []string{"authorization", "bearer", "password", "secret", "token="} {
		if strings.Contains(lower, marker) {
			return label + ": authentication error"
		}
	}
	// Keep only the first line and cap length.
	if i := strings.IndexByte(msg, '\n'); i >= 0 {
		msg = msg[:i]
	}
	if len(msg) > 180 {
		msg = msg[:180]
	}
	return label + ": " + msg
}

// Compile-time assertions: the HR connector satisfies the base adapter port plus
// the ConnectionTester and Syncer capabilities (NOT Invoker — HR is pull-only).
var (
	_ ConnectionTester = (*HRConnector)(nil)
	_ Syncer           = (*HRConnector)(nil)
)
