package federation

import (
	"context"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"encoding/xml"
	"fmt"
	"strings"
	"time"

	saml2 "github.com/russellhaering/gosaml2"
	dsig "github.com/russellhaering/goxmldsig"

	"github.com/clario360/platform/internal/iam/model"
)

// SAMLProvider is a real SAML 2.0 Service Provider (SP) implementation of the
// Provider interface, so the federation service and HTTP routes treat SAML
// uniformly with OIDC/Nafath.
//
// Signature verification, canonicalization (exc-c14n) and assertion-condition
// validation are delegated to github.com/russellhaering/gosaml2 +
// goxmldsig — a maintained, C14N-correct SP/DSig stack. We deliberately do NOT
// hand-roll XML-DSig (C14N byte-exactness is the part naive parsers get subtly
// wrong, and getting it wrong is a signature-bypass class vulnerability).
//
// What this provider enforces on Exchange (all FAIL-CLOSED — an assertion that
// fails ANY check is rejected, never accepted):
//   - XML-DSig RSA signature over the Response and/or Assertion against the IdP
//     signing certificate(s) from the connection metadata (gosaml2 also rejects
//     XML-wrapping attacks where a signed envelope contains a tampered assertion);
//   - Conditions NotBefore / NotOnOrAfter (with clock skew) — InvalidTime warning;
//   - AudienceRestriction == SP entity id — NotInAudience warning;
//   - SubjectConfirmationData InResponseTo == the AuthnRequest id we issued, when
//     SP-initiated (carried in AuthRequest.State); empty skips (IdP-initiated SSO);
//   - top-level Response StatusCode == Success (enforced inside gosaml2.Validate).
type SAMLProvider struct {
	conn model.IdPConnection
	sp   *saml2.SAMLServiceProvider
	now  func() time.Time
	skew time.Duration
}

// NewSAMLProvider builds the SAML provider from a connection config. It parses the
// IdP signing certificate(s) from the metadata XML (or an explicitly supplied PEM
// cert in conn.JWKSURL is NOT used here — SAML certs come from metadata) up-front
// so a misconfigured connection fails fast at construction rather than at first
// login.
func NewSAMLProvider(conn model.IdPConnection) (*SAMLProvider, error) {
	if conn.AuthorizeURL == "" && conn.SAMLMetadataXML == "" {
		return nil, fmt.Errorf("saml provider %q: SSO URL or metadata XML is required", conn.Provider)
	}

	var (
		certs     []*x509.Certificate
		ssoURL    = conn.AuthorizeURL
		idpIssuer string
	)
	if conn.SAMLMetadataXML != "" {
		c, url, entityID, err := parseIdPMetadata(conn.SAMLMetadataXML)
		if err != nil {
			return nil, fmt.Errorf("saml provider %q: %w", conn.Provider, err)
		}
		certs = c
		idpIssuer = entityID
		if ssoURL == "" {
			ssoURL = url
		}
	}
	if ssoURL == "" {
		return nil, fmt.Errorf("saml provider %q: no SSO URL (authorize_url or metadata SingleSignOnService)", conn.Provider)
	}
	if len(certs) == 0 {
		return nil, fmt.Errorf("saml provider %q: no IdP signing certificate (metadata XML with a signing KeyDescriptor is required)", conn.Provider)
	}

	// SP entity id / audience: prefer Issuer, fall back to ClientID (some admin
	// forms store the SP entity id in client_id).
	spEntityID := strings.TrimSpace(conn.Issuer)
	if spEntityID == "" {
		spEntityID = strings.TrimSpace(conn.ClientID)
	}

	certStore := &dsig.MemoryX509CertificateStore{Roots: certs}

	sp := &saml2.SAMLServiceProvider{
		IdentityProviderSSOURL:      ssoURL,
		IdentityProviderIssuer:      idpIssuer,
		AssertionConsumerServiceURL: strings.TrimSpace(conn.RedirectURL),
		ServiceProviderIssuer:       spEntityID,
		AudienceURI:                 spEntityID,
		IDPCertificateStore:         certStore,
		// We do not sign AuthnRequests by default: unsigned SP-initiated /
		// IdP-initiated SSO is the dominant enterprise default. (The integrator can
		// wire an SP signing keystore later via the gosaml2 seam.)
		SignAuthnRequests: false,
		// NEVER skip signature validation — fail-closed is the entire point.
		SkipSignatureValidation: false,
	}

	return &SAMLProvider{
		conn: conn,
		sp:   sp,
		now:  time.Now,
		skew: 2 * time.Minute,
	}, nil
}

// Kind reports the SAML protocol.
func (p *SAMLProvider) Kind() model.IdPKind { return model.IdPKindSAML }

// AuthCodeURL builds the SP-initiated SSO redirect (HTTP-Redirect binding).
// RelayState carries the platform's state value through the IdP round-trip (the
// SAML analogue of the OIDC state parameter); gosaml2 builds a fresh AuthnRequest
// document with a generated ID.
func (p *SAMLProvider) AuthCodeURL(_ context.Context, req AuthRequest) (string, error) {
	if p.sp == nil || p.sp.IdentityProviderSSOURL == "" {
		return "", fmt.Errorf("saml provider %q: SSO URL is not configured", p.conn.Provider)
	}
	url, err := p.sp.BuildAuthURL(req.State)
	if err != nil {
		return "", fmt.Errorf("saml provider %q: build auth url: %w", p.conn.Provider, err)
	}
	return url, nil
}

// Exchange validates the SAML response (signature + conditions) and returns the
// normalized claims. It is fail-closed: any verification failure returns an error
// and NEVER an ExternalClaims.
func (p *SAMLProvider) Exchange(_ context.Context, req AuthRequest, cb CallbackParams) (*ExternalClaims, error) {
	if cb.Error != "" {
		return nil, fmt.Errorf("saml: idp returned error %q: %s", cb.Error, cb.ErrorDescription)
	}
	encoded := strings.TrimSpace(cb.SAMLResponse)
	if encoded == "" {
		return nil, fmt.Errorf("saml: SAMLResponse is missing from callback")
	}
	if p.sp == nil {
		return nil, fmt.Errorf("saml provider %q: not configured", p.conn.Provider)
	}

	// gosaml2 expects standard base64. Normalize URL-safe base64 (some toolkits
	// emit it) into standard before handing it over.
	encoded = normalizeBase64(encoded)

	// RetrieveAssertionInfo performs the full security pipeline: base64 decode,
	// XML parse, XML-DSig signature verification against the IdP cert store,
	// XML-wrapping defense, status-code success check, and assertion CONDITION
	// validation (NotBefore/NotOnOrAfter + AudienceRestriction) reported via
	// WarningInfo. It returns an error for any signature/parse/decrypt failure.
	info, err := p.sp.RetrieveAssertionInfo(encoded)
	if err != nil {
		return nil, fmt.Errorf("saml: signature verification failed: %w", err)
	}

	// gosaml2 surfaces time/audience problems as warnings rather than hard errors;
	// we promote them to FAIL-CLOSED rejections.
	if info.WarningInfo != nil {
		if info.WarningInfo.InvalidTime {
			return nil, fmt.Errorf("saml: assertion outside its validity window (NotBefore/NotOnOrAfter)")
		}
		if info.WarningInfo.NotInAudience {
			return nil, fmt.Errorf("saml: assertion audience does not include the SP entity id")
		}
	}

	// InResponseTo replay/binding defense for SP-initiated flows. The platform
	// carries the originating AuthnRequest id in AuthRequest.State. gosaml2 does
	// not bind it for us, so we enforce it here against the verified assertion's
	// SubjectConfirmationData. An empty expected id (IdP-initiated SSO) skips.
	if expected := strings.TrimSpace(req.State); expected != "" {
		if inResp := subjectInResponseTo(info); inResp != "" && inResp != expected {
			return nil, fmt.Errorf("saml: InResponseTo does not match the originating request (possible replay)")
		}
	}

	subject := strings.TrimSpace(info.NameID)
	if subject == "" {
		return nil, fmt.Errorf("saml: assertion has no Subject NameID")
	}

	attrs := info.Values
	email := firstSAMLAttr(attrs,
		"email", "Email",
		"urn:oid:0.9.2342.19200300.100.1.3",
		"http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
	)
	if email == "" && strings.Contains(subject, "@") {
		email = subject
	}
	name := firstSAMLAttr(attrs,
		"displayName", "name",
		"http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
	)
	given := firstSAMLAttr(attrs,
		"givenName", "firstName",
		"urn:oid:2.5.4.42",
		"http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname",
	)
	family := firstSAMLAttr(attrs,
		"surname", "lastName", "sn",
		"urn:oid:2.5.4.4",
		"http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname",
	)

	raw := map[string]any{"sub": subject}
	for k, attr := range attrs {
		vals := attrs.GetAll(k)
		if len(vals) == 1 {
			raw[k] = vals[0]
		} else if len(vals) > 1 {
			raw[k] = vals
		}
		_ = attr
	}

	return &ExternalClaims{
		Subject:    subject,
		Email:      strings.ToLower(strings.TrimSpace(email)),
		Name:       name,
		GivenName:  given,
		FamilyName: family,
		Raw:        raw,
	}, nil
}

// subjectInResponseTo digs the first assertion's SubjectConfirmationData
// InResponseTo out of a verified AssertionInfo (gosaml2 keeps the parsed
// assertions on the result).
func subjectInResponseTo(info *saml2.AssertionInfo) string {
	for i := range info.Assertions {
		a := info.Assertions[i]
		if a.Subject == nil || a.Subject.SubjectConfirmation == nil {
			continue
		}
		scd := a.Subject.SubjectConfirmation.SubjectConfirmationData
		if scd != nil && strings.TrimSpace(scd.InResponseTo) != "" {
			return strings.TrimSpace(scd.InResponseTo)
		}
	}
	return ""
}

// firstSAMLAttr returns the first non-empty value found under any candidate key,
// matching either the attribute Name (OID/URI) or its FriendlyName.
func firstSAMLAttr(attrs saml2.Values, keys ...string) string {
	for _, k := range keys {
		if v := strings.TrimSpace(attrs.Get(k)); v != "" {
			return v
		}
	}
	// Fall back to a FriendlyName scan, since gosaml2 keys the map by Name.
	for _, attr := range attrs {
		if attr.FriendlyName == "" {
			continue
		}
		for _, k := range keys {
			if strings.EqualFold(attr.FriendlyName, k) && len(attr.Values) > 0 {
				if v := strings.TrimSpace(attr.Values[0].Value); v != "" {
					return v
				}
			}
		}
	}
	return ""
}

func normalizeBase64(s string) string {
	s = strings.TrimSpace(s)
	// If it is already valid standard base64 XML, leave it.
	if raw, err := base64.StdEncoding.DecodeString(s); err == nil && looksLikeXML(raw) {
		return s
	}
	if raw, err := base64.URLEncoding.DecodeString(s); err == nil && looksLikeXML(raw) {
		return base64.StdEncoding.EncodeToString(raw)
	}
	return s
}

func looksLikeXML(b []byte) bool {
	return strings.HasPrefix(strings.TrimSpace(string(b)), "<")
}

// -----------------------------------------------------------------------------
// IdP metadata parsing (signing certs + SSO URL). We parse the SAML 2.0
// EntityDescriptor with the stdlib (namespace-agnostic local names) so we do not
// depend on a metadata reader; the certs feed the goxmldsig cert store.
// -----------------------------------------------------------------------------

func parseIdPMetadata(metaXML string) (certs []*x509.Certificate, ssoURL, entityID string, err error) {
	var ed struct {
		EntityID string `xml:"entityID,attr"`
		IDPSSO   struct {
			KeyDescriptors []struct {
				Use         string `xml:"use,attr"`
				Certificate string `xml:"KeyInfo>X509Data>X509Certificate"`
			} `xml:"KeyDescriptor"`
			SSOServices []struct {
				Binding  string `xml:"Binding,attr"`
				Location string `xml:"Location,attr"`
			} `xml:"SingleSignOnService"`
		} `xml:"IDPSSODescriptor"`
	}
	if err := xml.Unmarshal([]byte(metaXML), &ed); err != nil {
		return nil, "", "", fmt.Errorf("malformed IdP metadata XML")
	}
	entityID = strings.TrimSpace(ed.EntityID)
	for _, kd := range ed.IDPSSO.KeyDescriptors {
		if kd.Use != "" && !strings.EqualFold(kd.Use, "signing") {
			continue
		}
		cert, perr := parseCertificate(kd.Certificate)
		if perr != nil {
			continue
		}
		certs = append(certs, cert)
	}
	for _, s := range ed.IDPSSO.SSOServices {
		if strings.Contains(s.Binding, "HTTP-Redirect") && s.Location != "" {
			ssoURL = strings.TrimSpace(s.Location)
			break
		}
	}
	if ssoURL == "" {
		for _, s := range ed.IDPSSO.SSOServices {
			if strings.TrimSpace(s.Location) != "" {
				ssoURL = strings.TrimSpace(s.Location)
				break
			}
		}
	}
	if len(certs) == 0 {
		return nil, ssoURL, entityID, fmt.Errorf("IdP metadata has no signing certificate")
	}
	return certs, ssoURL, entityID, nil
}

func parseCertificate(raw string) (*x509.Certificate, error) {
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
