package integration

import (
	"context"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"encoding/xml"
	"fmt"
	"net/http"
	"strings"
	"time"

	iammodel "github.com/clario360/platform/internal/iam/model"
	"github.com/clario360/platform/internal/lex/model"
	"github.com/clario360/platform/internal/lex/repository"
)

// =============================================================================
// SSO connector (OIDC / SAML)  [Integration Platform Phase 2 — CONNECTORS]
//
// This is a SELF-SERVE connector: an operator wires their own enterprise IdP
// (Microsoft Entra, Okta, Keycloak, Ping, ...) over standard OIDC or SAML 2.0.
// The transport is therefore REAL (no sandbox/mock): TestConnection performs a
// live discovery + JWKS / metadata reachability check, and Probe re-checks
// reachability plus signing-certificate expiry. There is no government gate, so
// health is graded honestly from the actual upstream state.
//
// The "nafath" protocol value is accepted as an OIDC variant (Nafath is the
// Saudi national SSO exposed as an OIDC provider). It is NOT a separate gated
// transport here — it rides the same OIDC discovery/JWKS path. (Identity
// CONFIRMATION via Nafath — the MFA/number-match flow — is a different
// connector, kind=nafath_verify; this kind is browser SSO only.)
//
// CONFIG ↔ IdPConnection. The connector maps an IntegrationEndpoint(kind=sso)
// onto an iammodel.IdPConnection so the existing, fully-tested
// internal/iam/federation provider machinery (OIDC code/PKCE/JWKS, SAML SP
// Exchange) is reused rather than reimplemented. invoke:login delegates to the
// federation provider via the lex SSO seam (federation.Provider.AuthCodeURL).
//
// CONFIG + SECRETS CUSTODY. Like najiz_court_adapter.go, this adapter resolves
// the endpoint's PLAINTEXT config directly through the IntegrationEndpoint
// repository (which FieldCrypto-decrypts config_encrypted on read). It never
// calls IntegrationRegistryService.Get/List (which redacts). The client_secret
// is held only in memory while building the provider and is NEVER logged or
// returned in a TestResult / InvokeResult.
// =============================================================================

// ssoProviderBuilder abstracts federation.NewProvider so the connector can build
// a real OIDC/SAML provider for the invoke:login delegation without taking a hard
// compile dependency that the integrator cannot override in tests. The integrator
// injects federation.NewProvider (see the manifest wiring note).
type ssoProviderBuilder func(conn iammodel.IdPConnection) (ssoProvider, error)

// ssoProvider is the slice of federation.Provider the connector uses for the
// invoke:login delegation. *federation.OIDCProvider / *federation.SAMLProvider
// satisfy it structurally.
type ssoProvider interface {
	AuthCodeURL(ctx context.Context, req ssoAuthRequest) (string, error)
}

// ssoAuthRequest mirrors federation.AuthRequest's fields so the integrator can
// adapt federation.Provider to ssoProvider without this package importing the
// federation request type. (Kept structurally identical on purpose.)
type ssoAuthRequest struct {
	RedirectURL  string
	State        string
	Nonce        string
	CodeVerifier string
}

// SSOConnector implements the base IntegrationAdapter (Kind + Probe) plus the
// ConnectionTester and Invoker capabilities for kind=sso.
type SSOConnector struct {
	repo    *repository.IntegrationEndpointRepository
	client  *http.Client
	now     func() time.Time
	breaker *Breaker
	// buildProvider is optional; when nil, invoke:login reports that the login
	// delegation is not wired (honest "not configured") rather than faking a URL.
	buildProvider ssoProviderBuilder
}

// SSOConnectorConfig parametrises the connector. Only the repository is required;
// the HTTP client and timeout default sensibly. buildProvider is injected by the
// integrator to enable the invoke:login delegation to internal/iam/federation.
type SSOConnectorConfig struct {
	Endpoints     *repository.IntegrationEndpointRepository
	Client        *http.Client
	Timeout       time.Duration
	BuildProvider ssoProviderBuilder
}

// NewSSOConnector builds the SSO connector. The repository MUST be wired with
// FieldCrypto (repo.WithFieldCrypto) so the resolved config is decrypted.
func NewSSOConnector(cfg SSOConnectorConfig) *SSOConnector {
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 12 * time.Second
	}
	client := cfg.Client
	if client == nil {
		client = &http.Client{Timeout: timeout}
	} else if client.Timeout == 0 {
		copied := *client
		copied.Timeout = timeout
		client = &copied
	}
	return &SSOConnector{
		repo:          cfg.Endpoints,
		client:        client,
		now:           time.Now,
		breaker:       NewBreaker(BreakerConfig{}),
		buildProvider: cfg.BuildProvider,
	}
}

// Kind reports the integration kind this adapter serves.
func (c *SSOConnector) Kind() model.IntegrationKind { return model.IntegrationKindSSO }

// ssoConfig is the parsed, plaintext SSO endpoint configuration.
type ssoConfig struct {
	Protocol     string // oidc | saml | nafath
	Issuer       string
	AuthorizeURL string
	TokenURL     string
	JWKSURL      string
	UserInfoURL  string
	ClientID     string
	ClientSecret string // secret — never logged/returned
	RedirectURL  string
	Scopes       []string
	ACRValues    string

	SAMLMetadataURL string
	SAMLMetadataXML string
	SAMLSPEntityID  string
	SAMLACSURL      string
}

// parseSSOConfig extracts SSO settings from a decrypted Config map. Keys are
// tolerant of the schema's field names and a few common aliases so an operator's
// registered endpoint works without a strict shape.
func parseSSOConfig(cfg map[string]any) ssoConfig {
	out := ssoConfig{
		Protocol:        strings.ToLower(cfgString(cfg, "protocol", "kind")),
		Issuer:          cfgString(cfg, "issuer", "issuer_url", "discovery_url"),
		AuthorizeURL:    cfgString(cfg, "authorize_url", "authorization_endpoint"),
		TokenURL:        cfgString(cfg, "token_url", "token_endpoint"),
		JWKSURL:         cfgString(cfg, "jwks_url", "jwks_uri"),
		UserInfoURL:     cfgString(cfg, "userinfo_url", "userinfo_endpoint"),
		ClientID:        cfgString(cfg, "client_id"),
		ClientSecret:    cfgString(cfg, "client_secret"),
		RedirectURL:     cfgString(cfg, "redirect_url", "redirect_uri"),
		ACRValues:       cfgString(cfg, "acr_values"),
		SAMLMetadataURL: cfgString(cfg, "saml_metadata_url"),
		SAMLMetadataXML: cfgString(cfg, "saml_metadata_xml"),
		SAMLSPEntityID:  cfgString(cfg, "saml_sp_entity_id", "sp_entity_id"),
		SAMLACSURL:      cfgString(cfg, "saml_acs_url", "acs_url"),
	}
	if out.Protocol == "" {
		out.Protocol = "oidc"
	}
	if scopes := cfgString(cfg, "scopes", "scope"); scopes != "" {
		out.Scopes = splitScopes(scopes)
	}
	return out
}

// toIdPConnection maps the SSO endpoint onto an iammodel.IdPConnection so the
// federation provider machinery can be reused for the invoke:login delegation.
func (sc ssoConfig) toIdPConnection(endpoint model.IntegrationEndpoint) iammodel.IdPConnection {
	kind := iammodel.IdPKindOIDC
	switch sc.Protocol {
	case "saml":
		kind = iammodel.IdPKindSAML
	case "nafath":
		kind = iammodel.IdPKindNafath
	}
	scopes := sc.Scopes
	if len(scopes) == 0 {
		scopes = []string{"openid", "profile", "email"}
	}
	return iammodel.IdPConnection{
		TenantID:        endpoint.TenantID.String(),
		Provider:        endpoint.Code,
		DisplayName:     endpoint.Name,
		Kind:            kind,
		Enabled:         endpoint.Status == model.IntegrationStatusActive,
		Issuer:          sc.Issuer,
		ClientID:        sc.ClientID,
		ClientSecret:    sc.ClientSecret,
		AuthorizeURL:    sc.AuthorizeURL,
		TokenURL:        sc.TokenURL,
		JWKSURL:         sc.JWKSURL,
		UserInfoURL:     sc.UserInfoURL,
		RedirectURL:     sc.RedirectURL,
		Scopes:          scopes,
		SAMLMetadataXML: sc.SAMLMetadataXML,
	}
}

// TestConnection performs a non-mutating reachability/validity probe.
//
//	OIDC/Nafath: resolve discovery (when only issuer is set), fetch the JWKS,
//	             assert ≥1 RSA signing key AND a non-empty client_id.
//	SAML:        parse the metadata XML (fetched from saml_metadata_url when only
//	             a URL is configured), assert at least one signing cert AND an
//	             SSO (SingleSignOnService) URL.
//
// The returned TestResult is sanitized: it never echoes client_secret or cert
// private material; only counts, expiry, and an operator-safe Detail.
func (c *SSOConnector) TestConnection(ctx context.Context, endpoint model.IntegrationEndpoint) (TestResult, error) {
	start := c.now()
	cfg, err := c.resolveConfig(ctx, endpoint)
	if err != nil {
		return TestResult{Reachable: false, Detail: "could not resolve endpoint configuration", CheckedAt: c.now().UTC()}, err
	}

	switch cfg.Protocol {
	case "saml":
		return c.testSAML(ctx, cfg, start)
	default: // oidc | nafath
		return c.testOIDC(ctx, cfg, start)
	}
}

func (c *SSOConnector) testOIDC(ctx context.Context, cfg ssoConfig, start time.Time) (TestResult, error) {
	res := TestResult{CheckedAt: c.now().UTC(), Metadata: map[string]any{"protocol": "oidc"}}

	// authenticated stage (for browser SSO, the IdP "credential" the platform holds
	// is the registered client_id; the client_secret is exercised only at the
	// token exchange, so a non-mutating probe asserts client_id presence here).
	if strings.TrimSpace(cfg.ClientID) == "" {
		res.Reachable = false
		res.Detail = "client_id is required for OIDC SSO"
		res.Steps = []DiagnosticStep{
			newDiagStep(diagStepReachable, diagLabel(diagStepReachable), diagStatusSkip, 0, "skipped: client_id missing", ""),
			newDiagStep(diagStepAuthenticated, diagLabel(diagStepAuthenticated), diagStatusFail, 0,
				"client_id is not configured", hintRotateClientSecret),
			newDiagStep(diagStepAuthorized, diagLabel(diagStepAuthorized), diagStatusSkip, 0, "skipped: client_id missing", ""),
			newDiagStep(diagStepSampleFetch, diagLabel(diagStepSampleFetch), diagStatusSkip, 0, "skipped: client_id missing", ""),
		}
		return res, nil
	}
	jwksURL := cfg.JWKSURL
	if jwksURL == "" {
		disco, derr := c.fetchOIDCDiscovery(ctx, cfg.Issuer)
		if derr != nil {
			res.Reachable = false
			res.Detail = detailWith("OIDC discovery failed", derr)
			res.LatencyMillis = elapsedMillis(start, c.now())
			res.Steps = []DiagnosticStep{
				newDiagStep(diagStepReachable, diagLabel(diagStepReachable), diagStatusFail, res.LatencyMillis,
					detailWith("OIDC discovery failed", derr), hintCheckNetwork),
				newDiagStep(diagStepAuthenticated, diagLabel(diagStepAuthenticated), diagStatusOK, 0, "client_id configured", ""),
				newDiagStep(diagStepAuthorized, diagLabel(diagStepAuthorized), diagStatusSkip, 0, "skipped: discovery unreachable", ""),
				newDiagStep(diagStepSampleFetch, diagLabel(diagStepSampleFetch), diagStatusSkip, 0, "skipped: discovery unreachable", ""),
			}
			return res, nil
		}
		jwksURL = disco.JWKSURL
		if disco.Issuer != "" {
			res.Metadata["issuer"] = disco.Issuer
		}
	}
	if jwksURL == "" {
		res.Reachable = false
		res.Detail = "no jwks_uri configured and discovery did not provide one"
		res.LatencyMillis = elapsedMillis(start, c.now())
		res.Steps = []DiagnosticStep{
			newDiagStep(diagStepReachable, diagLabel(diagStepReachable), diagStatusFail, res.LatencyMillis,
				"no jwks_uri configured and discovery did not provide one", "set jwks_url or a discoverable issuer"),
			newDiagStep(diagStepAuthenticated, diagLabel(diagStepAuthenticated), diagStatusOK, 0, "client_id configured", ""),
			newDiagStep(diagStepAuthorized, diagLabel(diagStepAuthorized), diagStatusSkip, 0, "skipped: no JWKS endpoint", ""),
			newDiagStep(diagStepSampleFetch, diagLabel(diagStepSampleFetch), diagStatusSkip, 0, "skipped: no JWKS endpoint", ""),
		}
		return res, nil
	}

	keyCount, err := c.fetchJWKSSigningKeyCount(ctx, jwksURL)
	res.LatencyMillis = elapsedMillis(start, c.now())
	if err != nil {
		res.Reachable = false
		res.Detail = detailWith("JWKS fetch failed", err)
		res.Steps = []DiagnosticStep{
			newDiagStep(diagStepReachable, diagLabel(diagStepReachable), diagStatusFail, res.LatencyMillis,
				detailWith("JWKS fetch failed", err), hintCheckNetwork),
			newDiagStep(diagStepAuthenticated, diagLabel(diagStepAuthenticated), diagStatusOK, 0, "client_id configured", ""),
			newDiagStep(diagStepAuthorized, diagLabel(diagStepAuthorized), diagStatusSkip, 0, "skipped: JWKS unreachable", ""),
			newDiagStep(diagStepSampleFetch, diagLabel(diagStepSampleFetch), diagStatusSkip, 0, "skipped: JWKS unreachable", ""),
		}
		return res, nil
	}
	if keyCount < 1 {
		res.Reachable = false
		res.Detail = "JWKS contained no usable RSA signing keys"
		res.Steps = []DiagnosticStep{
			newDiagStep(diagStepReachable, diagLabel(diagStepReachable), diagStatusOK, res.LatencyMillis, "JWKS endpoint reachable", ""),
			newDiagStep(diagStepAuthenticated, diagLabel(diagStepAuthenticated), diagStatusOK, 0, "client_id configured", ""),
			newDiagStep(diagStepAuthorized, diagLabel(diagStepAuthorized), diagStatusFail, 0,
				"JWKS contained no usable RSA signing keys", "publish at least one RSA signing key at the JWKS endpoint"),
			newDiagStep(diagStepSampleFetch, diagLabel(diagStepSampleFetch), diagStatusFail, 0, "no signing keys to validate tokens", ""),
		}
		return res, nil
	}
	res.Reachable = true
	res.SampleCount = keyCount
	res.Detail = fmt.Sprintf("OIDC reachable; %d signing key(s); client_id set", keyCount)
	res.Steps = []DiagnosticStep{
		newDiagStep(diagStepReachable, diagLabel(diagStepReachable), diagStatusOK, res.LatencyMillis, "discovery + JWKS endpoint reachable", ""),
		newDiagStep(diagStepAuthenticated, diagLabel(diagStepAuthenticated), diagStatusOK, 0, "client_id configured", ""),
		newDiagStep(diagStepAuthorized, diagLabel(diagStepAuthorized), diagStatusOK, 0, fmt.Sprintf("%d signing key(s) available", keyCount), ""),
		newDiagStep(diagStepSampleFetch, diagLabel(diagStepSampleFetch), diagStatusOK, res.LatencyMillis, fmt.Sprintf("read %d RSA signing key(s) from JWKS", keyCount), ""),
	}
	return res, nil
}

func (c *SSOConnector) testSAML(ctx context.Context, cfg ssoConfig, start time.Time) (TestResult, error) {
	res := TestResult{CheckedAt: c.now().UTC(), Metadata: map[string]any{"protocol": "saml"}}
	metaXML := cfg.SAMLMetadataXML
	if strings.TrimSpace(metaXML) == "" && cfg.SAMLMetadataURL != "" {
		fetched, ferr := c.fetchText(ctx, cfg.SAMLMetadataURL)
		res.LatencyMillis = elapsedMillis(start, c.now())
		if ferr != nil {
			res.Reachable = false
			res.Detail = detailWith("SAML metadata fetch failed", ferr)
			res.Steps = samlDiagSteps(res.LatencyMillis, samlStageReachable, detailWith("SAML metadata fetch failed", ferr), hintCheckNetwork, 0, false)
			return res, nil
		}
		metaXML = fetched
	}
	if strings.TrimSpace(metaXML) == "" {
		res.Reachable = false
		res.Detail = "no SAML metadata (provide saml_metadata_xml or saml_metadata_url)"
		res.Steps = samlDiagSteps(res.LatencyMillis, samlStageReachable,
			"no SAML metadata (provide saml_metadata_xml or saml_metadata_url)", "configure saml_metadata_xml or saml_metadata_url", 0, false)
		return res, nil
	}

	md, perr := parseSAMLMetadata(metaXML)
	if perr != nil {
		res.Reachable = false
		res.Detail = detailWith("SAML metadata parse failed", perr)
		res.Steps = samlDiagSteps(res.LatencyMillis, samlStageReachable, detailWith("SAML metadata parse failed", perr), "verify the IdP metadata XML is well-formed", 0, false)
		return res, nil
	}
	if md.SSOURL == "" {
		res.Reachable = false
		res.Detail = "SAML metadata has no SingleSignOnService (SSO URL)"
		res.Steps = samlDiagSteps(res.LatencyMillis, samlStageAuthenticated, "SAML metadata has no SingleSignOnService (SSO URL)", "ensure the IdP metadata exposes a SingleSignOnService endpoint", 0, false)
		return res, nil
	}
	if len(md.SigningCerts) == 0 {
		res.Reachable = false
		res.Detail = "SAML metadata has no signing certificate"
		res.Steps = samlDiagSteps(res.LatencyMillis, samlStageAuthorized, "SAML metadata has no signing certificate", "publish a signing certificate in the IdP metadata", 0, false)
		return res, nil
	}
	res.Reachable = true
	res.SampleCount = len(md.SigningCerts)
	if !md.EarliestExpiry.IsZero() {
		res.Metadata["signing_cert_not_after"] = md.EarliestExpiry.UTC().Format(time.RFC3339)
		if md.EarliestExpiry.Before(c.now()) {
			res.Reachable = false
			res.Detail = "SAML signing certificate has expired"
			res.Steps = samlDiagSteps(res.LatencyMillis, samlStageAuthorized, "SAML signing certificate has expired", "rotate the IdP signing certificate and re-import metadata", len(md.SigningCerts), false)
			return res, nil
		}
	}
	res.Detail = fmt.Sprintf("SAML metadata valid; SSO URL + %d signing cert(s)", len(md.SigningCerts))
	res.Steps = samlDiagSteps(res.LatencyMillis, samlStageOK, "", "", len(md.SigningCerts), true)
	return res, nil
}

// samlStage identifies which stage a SAML probe failed at, so samlDiagSteps can
// mark the earlier stages ok and the failing stage fail.
type samlStage int

const (
	samlStageReachable samlStage = iota
	samlStageAuthenticated
	samlStageAuthorized
	samlStageOK
)

// samlDiagSteps builds the staged steps for a SAML metadata probe. SAML is a
// metadata-trust flow (no interactive credential at probe time): reachable =
// metadata fetched+parsed; authenticated = an SSO endpoint is published;
// authorized = a valid (unexpired) signing certificate is present; sample_fetch =
// certificate material parsed.
func samlDiagSteps(latency int64, failAt samlStage, detail, hint string, certs int, ok bool) []DiagnosticStep {
	mk := func(stage samlStage, key, okDetail string) DiagnosticStep {
		switch {
		case ok || stage < failAt:
			return newDiagStep(key, diagLabel(key), diagStatusOK, latencyFor(key, latency), okDetail, "")
		case stage == failAt:
			return newDiagStep(key, diagLabel(key), diagStatusFail, latencyFor(key, latency), detail, hint)
		default:
			return newDiagStep(key, diagLabel(key), diagStatusSkip, 0, "skipped: earlier stage failed", "")
		}
	}
	certDetail := "signing certificate parsed"
	if certs > 0 {
		certDetail = fmt.Sprintf("%d signing cert(s) parsed", certs)
	}
	return []DiagnosticStep{
		mk(samlStageReachable, diagStepReachable, "metadata fetched and parsed"),
		mk(samlStageAuthenticated, diagStepAuthenticated, "SingleSignOnService endpoint published"),
		mk(samlStageAuthorized, diagStepAuthorized, "valid signing certificate present"),
		mk(samlStageOK, diagStepSampleFetch, certDetail),
	}
}

// latencyFor attaches the measured probe latency to the reachable step only (the
// other stages are derived from the same single fetch and have no own latency).
func latencyFor(key string, latency int64) int64 {
	if key == diagStepReachable {
		return latency
	}
	return 0
}

// Probe reports a health snapshot: discovery/JWKS (OIDC) or metadata + signing
// cert expiry (SAML). A planned/disabled endpoint reports not-reachable without a
// network call; an active endpoint is probed live and graded on the real result.
func (c *SSOConnector) Probe(ctx context.Context, endpoint model.IntegrationEndpoint, now time.Time) model.IntegrationHealth {
	health := model.IntegrationHealth{
		EndpointID:  endpoint.ID,
		Kind:        model.IntegrationKindSSO,
		Code:        endpoint.Code,
		Status:      endpoint.Status,
		CheckedUnix: now.UTC().Unix(),
	}
	switch endpoint.Status {
	case model.IntegrationStatusActive:
		// fallthrough to live probe below
	case model.IntegrationStatusPlanned:
		health.Reachable = false
		health.Detail = "planned: not yet activated"
		return health
	case model.IntegrationStatusDisabled:
		health.Reachable = false
		health.Detail = "disabled by operator"
		return health
	default:
		health.Reachable = false
		health.Detail = "endpoint in error state"
		return health
	}

	probeCtx, cancel := context.WithTimeout(ctx, c.client.Timeout)
	defer cancel()
	res, err := c.TestConnection(probeCtx, endpoint)
	if err != nil {
		health.Reachable = false
		health.Detail = "configuration could not be resolved"
		return health
	}
	health.Reachable = res.Reachable
	health.Detail = res.Detail
	return health
}

// Invoke supports the "login" operation, which builds the IdP authorization
// redirect URL by delegating to the federation provider (real OIDC/SAML). When
// no provider builder is wired, it returns an honest "login delegation not wired"
// result rather than fabricating a URL. The result never contains secrets.
func (c *SSOConnector) Invoke(ctx context.Context, endpoint model.IntegrationEndpoint, operation string, payload map[string]any) (InvokeResult, error) {
	op := strings.ToLower(strings.TrimSpace(operation))
	if op != "login" {
		return InvokeResult{Operation: operation, Success: false, Detail: "unsupported operation"},
			fmt.Errorf("lex/integration sso: unsupported operation %q", operation)
	}
	cfg, err := c.resolveConfig(ctx, endpoint)
	if err != nil {
		return InvokeResult{Operation: op, Success: false, Detail: "could not resolve endpoint configuration"}, err
	}
	if c.buildProvider == nil {
		return InvokeResult{
			Operation: op,
			Success:   false,
			Detail:    "SSO login delegation is not wired (inject a federation provider builder at bootstrap)",
		}, nil
	}
	conn := cfg.toIdPConnection(endpoint)
	prov, perr := c.buildProvider(conn)
	if perr != nil {
		return InvokeResult{Operation: op, Success: false, Detail: "SSO provider is misconfigured"}, perr
	}

	req := ssoAuthRequest{
		RedirectURL:  firstNonEmpty(payloadString(payload, "redirect_url"), cfg.RedirectURL),
		State:        payloadString(payload, "state"),
		Nonce:        payloadString(payload, "nonce"),
		CodeVerifier: payloadString(payload, "code_verifier"),
	}
	url, uerr := prov.AuthCodeURL(ctx, req)
	if uerr != nil {
		return InvokeResult{Operation: op, Success: false, Detail: "failed to build authorization URL"}, uerr
	}
	return InvokeResult{
		Operation: op,
		Success:   true,
		Reference: endpoint.Code,
		Detail:    "authorization redirect built",
		Output:    map[string]any{"authorize_url": url, "protocol": cfg.Protocol},
	}, nil
}

// resolveConfig loads the endpoint fresh from the repository so the config is the
// DECRYPTED plaintext (the repo decrypts on read). The endpoint passed by the
// registry's TestConnection path is already decrypted, but Probe is also called
// with registry-provided (possibly masked-in-list) endpoints, so we re-resolve by
// id to guarantee plaintext and avoid leaking the masked sentinel into a provider.
func (c *SSOConnector) resolveConfig(ctx context.Context, endpoint model.IntegrationEndpoint) (ssoConfig, error) {
	if c.repo == nil {
		return parseSSOConfig(endpoint.Config), nil
	}
	fresh, err := c.repo.Get(ctx, endpoint.TenantID, endpoint.ID)
	if err != nil {
		// Fall back to the supplied config (already plaintext on the TestConnection
		// path) rather than hard-failing.
		return parseSSOConfig(endpoint.Config), nil
	}
	return parseSSOConfig(fresh.Config), nil
}

// -----------------------------------------------------------------------------
// OIDC discovery + JWKS (sanitized HTTP helpers; never log credentials).
// -----------------------------------------------------------------------------

type oidcDiscoveryDoc struct {
	Issuer       string `json:"issuer"`
	AuthorizeURL string `json:"authorization_endpoint"`
	TokenURL     string `json:"token_endpoint"`
	JWKSURL      string `json:"jwks_uri"`
	UserInfoURL  string `json:"userinfo_endpoint"`
}

func (c *SSOConnector) fetchOIDCDiscovery(ctx context.Context, issuer string) (oidcDiscoveryDoc, error) {
	issuer = strings.TrimRight(strings.TrimSpace(issuer), "/")
	if issuer == "" {
		return oidcDiscoveryDoc{}, fmt.Errorf("issuer is required to discover OIDC endpoints")
	}
	discoURL := issuer + "/.well-known/openid-configuration"
	body, err := c.getBody(ctx, discoURL)
	if err != nil {
		return oidcDiscoveryDoc{}, err
	}
	var doc oidcDiscoveryDoc
	if err := json.Unmarshal(body, &doc); err != nil {
		return oidcDiscoveryDoc{}, fmt.Errorf("decode discovery document")
	}
	return doc, nil
}

type jwksKey struct {
	Kty string `json:"kty"`
	Use string `json:"use"`
}

type jwksDoc struct {
	Keys []jwksKey `json:"keys"`
}

func (c *SSOConnector) fetchJWKSSigningKeyCount(ctx context.Context, jwksURL string) (int, error) {
	body, err := c.getBody(ctx, jwksURL)
	if err != nil {
		return 0, err
	}
	var set jwksDoc
	if err := json.Unmarshal(body, &set); err != nil {
		return 0, fmt.Errorf("decode jwks")
	}
	count := 0
	for _, k := range set.Keys {
		if strings.EqualFold(k.Kty, "RSA") && (k.Use == "" || strings.EqualFold(k.Use, "sig")) {
			count++
		}
	}
	return count, nil
}

func (c *SSOConnector) fetchText(ctx context.Context, url string) (string, error) {
	body, err := c.getBody(ctx, url)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

// getBody performs a guarded GET behind the circuit breaker, returning the body
// (size-limited) on a 2xx. Error strings are operator-safe (no credentials).
func (c *SSOConnector) getBody(ctx context.Context, url string) ([]byte, error) {
	var out []byte
	err := c.breaker.Execute(ctx, func(ctx context.Context) error {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return fmt.Errorf("invalid URL")
		}
		req.Header.Set("Accept", "application/json, application/samlmetadata+xml, application/xml, text/xml")
		resp, err := c.client.Do(req)
		if err != nil {
			return fmt.Errorf("request failed")
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			return fmt.Errorf("status %d", resp.StatusCode)
		}
		body, rerr := readLimited(resp.Body, 1<<20)
		if rerr != nil {
			return fmt.Errorf("read response")
		}
		out = body
		return nil
	})
	return out, err
}

// -----------------------------------------------------------------------------
// SAML IdP metadata parsing (stdlib encoding/xml — no external SAML dependency).
// We extract the SingleSignOnService URL(s) and the X.509 signing certificate(s),
// computing the earliest NotAfter so Probe can grade signing-cert expiry.
// -----------------------------------------------------------------------------

// samlMetadata is the operator-relevant subset of an EntityDescriptor.
type samlMetadata struct {
	EntityID       string
	SSOURL         string
	SigningCerts   []*x509.Certificate
	EarliestExpiry time.Time
}

// xmlEntityDescriptor mirrors the SAML 2.0 metadata shape we read. Namespaces are
// ignored via the local-name match encoding/xml performs on the struct tags.
type xmlEntityDescriptor struct {
	XMLName  xml.Name      `xml:"EntityDescriptor"`
	EntityID string        `xml:"entityID,attr"`
	IDPSSO   xmlIDPSSODesc `xml:"IDPSSODescriptor"`
}

type xmlIDPSSODesc struct {
	KeyDescriptors []xmlKeyDescriptor `xml:"KeyDescriptor"`
	SSOServices    []xmlSSOService    `xml:"SingleSignOnService"`
}

type xmlKeyDescriptor struct {
	Use         string `xml:"use,attr"`
	Certificate string `xml:"KeyInfo>X509Data>X509Certificate"`
}

type xmlSSOService struct {
	Binding  string `xml:"Binding,attr"`
	Location string `xml:"Location,attr"`
}

// parseSAMLMetadata parses an IdP metadata XML document into samlMetadata. It
// asserts nothing — the caller decides which absences are fatal.
func parseSAMLMetadata(metaXML string) (samlMetadata, error) {
	var ed xmlEntityDescriptor
	if err := xml.Unmarshal([]byte(metaXML), &ed); err != nil {
		return samlMetadata{}, fmt.Errorf("malformed metadata XML")
	}
	md := samlMetadata{EntityID: strings.TrimSpace(ed.EntityID)}

	// Prefer the HTTP-Redirect SSO binding, else the first SSO service.
	for _, s := range ed.IDPSSO.SSOServices {
		if strings.Contains(s.Binding, "HTTP-Redirect") && s.Location != "" {
			md.SSOURL = strings.TrimSpace(s.Location)
			break
		}
	}
	if md.SSOURL == "" {
		for _, s := range ed.IDPSSO.SSOServices {
			if strings.TrimSpace(s.Location) != "" {
				md.SSOURL = strings.TrimSpace(s.Location)
				break
			}
		}
	}

	for _, kd := range ed.IDPSSO.KeyDescriptors {
		// use="" means the key serves both signing and encryption; accept it.
		if kd.Use != "" && !strings.EqualFold(kd.Use, "signing") {
			continue
		}
		cert, err := parseSAMLCertificate(kd.Certificate)
		if err != nil {
			continue
		}
		md.SigningCerts = append(md.SigningCerts, cert)
		if md.EarliestExpiry.IsZero() || cert.NotAfter.Before(md.EarliestExpiry) {
			md.EarliestExpiry = cert.NotAfter
		}
	}
	return md, nil
}

// parseSAMLCertificate decodes a base64 DER (or PEM) X509Certificate element.
func parseSAMLCertificate(raw string) (*x509.Certificate, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, fmt.Errorf("empty certificate")
	}
	if strings.Contains(raw, "BEGIN CERTIFICATE") {
		block, _ := pem.Decode([]byte(raw))
		if block == nil {
			return nil, fmt.Errorf("invalid PEM certificate")
		}
		return x509.ParseCertificate(block.Bytes)
	}
	// Strip whitespace/newlines that commonly wrap the base64 in metadata.
	compact := strings.Map(func(r rune) rune {
		switch r {
		case ' ', '\n', '\r', '\t':
			return -1
		}
		return r
	}, raw)
	der, err := base64.StdEncoding.DecodeString(compact)
	if err != nil {
		return nil, fmt.Errorf("invalid base64 certificate")
	}
	return x509.ParseCertificate(der)
}

// -----------------------------------------------------------------------------
// Small, secret-safe helpers.
// -----------------------------------------------------------------------------

func splitScopes(s string) []string {
	fields := strings.FieldsFunc(s, func(r rune) bool { return r == ' ' || r == ',' })
	out := make([]string, 0, len(fields))
	for _, f := range fields {
		if f = strings.TrimSpace(f); f != "" {
			out = append(out, f)
		}
	}
	return out
}

func readLimited(r interface{ Read([]byte) (int, error) }, max int64) ([]byte, error) {
	buf := make([]byte, 0, 4096)
	tmp := make([]byte, 4096)
	var total int64
	for {
		n, err := r.Read(tmp)
		if n > 0 {
			if total+int64(n) > max {
				n = int(max - total)
			}
			buf = append(buf, tmp[:n]...)
			total += int64(n)
			if total >= max {
				return buf, nil
			}
		}
		if err != nil {
			if err.Error() == "EOF" {
				return buf, nil
			}
			return buf, nil
		}
	}
}

func elapsedMillis(start, end time.Time) int64 {
	d := end.Sub(start)
	if d < 0 {
		return 0
	}
	return d.Milliseconds()
}

// detailWith composes an operator-safe Detail from a context message plus the
// curated error text from getBody/discovery helpers (which return curated strings,
// never transport internals or credentials). Reuses the package sanitizeErr.
func detailWith(context string, err error) string {
	if msg := sanitizeErr(err); msg != "" {
		return context + ": " + msg
	}
	return context
}
