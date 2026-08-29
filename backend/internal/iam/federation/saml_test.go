package federation

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/pem"
	"fmt"
	"math/big"
	"strings"
	"testing"
	"time"

	"github.com/beevik/etree"
	saml2 "github.com/russellhaering/gosaml2"
	dsig "github.com/russellhaering/goxmldsig"

	"github.com/clario360/platform/internal/iam/model"
)

// --- test fixtures -----------------------------------------------------------

// samlTestKeyStore is a goxmldsig X509KeyStore backed by an in-test RSA key and a
// self-signed certificate, used BOTH to sign the fixture assertion and (via its
// cert, embedded in the IdP metadata) to verify it.
type samlTestKeyStore struct {
	key  *rsa.PrivateKey
	cert []byte // DER
}

func (k *samlTestKeyStore) GetKeyPair() (*rsa.PrivateKey, []byte, error) {
	return k.key, k.cert, nil
}

func newSAMLTestKeyStore(t *testing.T) *samlTestKeyStore {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("gen key: %v", err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "test-idp"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(100 * 365 * 24 * time.Hour),
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("create cert: %v", err)
	}
	return &samlTestKeyStore{key: key, cert: der}
}

// metadataXML returns an IdP EntityDescriptor embedding the signing cert and an
// HTTP-Redirect SSO endpoint — exactly the input NewSAMLProvider consumes.
func (k *samlTestKeyStore) metadataXML(ssoURL string) string {
	b64 := base64.StdEncoding.EncodeToString(k.cert)
	return `<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="https://idp.example.com">
  <IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <KeyDescriptor use="signing">
      <KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>` + b64 + `</X509Certificate></X509Data></KeyInfo>
    </KeyDescriptor>
    <SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="` + ssoURL + `"/>
  </IDPSSODescriptor>
</EntityDescriptor>`
}

// signingSP builds a gosaml2 SP wired with the test key so we can produce a
// properly-enveloped XML-DSig signature over a Response template.
func (k *samlTestKeyStore) signingSP(t *testing.T) *saml2.SAMLServiceProvider {
	t.Helper()
	cert, err := x509.ParseCertificate(k.cert)
	if err != nil {
		t.Fatalf("parse cert: %v", err)
	}
	sp := &saml2.SAMLServiceProvider{
		IDPCertificateStore: &dsig.MemoryX509CertificateStore{Roots: []*x509.Certificate{cert}},
	}
	if err := sp.SetSPSigningKeyStore(&saml2.KeyStore{Signer: k.key, Cert: k.cert}); err != nil {
		t.Fatalf("set signing keystore: %v", err)
	}
	return sp
}

// signResponse enveloped-signs the Assertion within a Response template and
// returns the base64 (std) encoding the SP callback would carry.
func signResponse(t *testing.T, sp *saml2.SAMLServiceProvider, responseXML string) string {
	t.Helper()
	doc := etree.NewDocument()
	if err := doc.ReadFromString(responseXML); err != nil {
		t.Fatalf("parse response template: %v", err)
	}
	el := doc.Root()
	for _, sig := range el.FindElements("//Signature") {
		sig.Parent().RemoveChild(sig)
	}
	signed, err := sp.SigningContext().SignEnveloped(el)
	if err != nil {
		t.Fatalf("sign enveloped: %v", err)
	}
	out := etree.NewDocument()
	out.SetRoot(signed)
	str, err := out.WriteToString()
	if err != nil {
		t.Fatalf("serialize signed: %v", err)
	}
	return base64.StdEncoding.EncodeToString([]byte(str))
}

const (
	testSPEntityID = "https://sp.clario360.sa/metadata"
	testNameID     = "federated.user@corp.example.com"
)

// responseTemplate builds a SAML Response with the given audience, time window
// and InResponseTo. The Assertion carries an ID for the enveloped reference.
func responseTemplate(audience string, notBefore, notOnOrAfter time.Time, inResponseTo string) string {
	return fmt.Sprintf(`<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_resp1" Version="2.0" IssueInstant="%s">
  <saml:Issuer>https://idp.example.com</saml:Issuer>
  <samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
  <saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_assertion1" Version="2.0" IssueInstant="%s">
    <saml:Issuer>https://idp.example.com</saml:Issuer>
    <saml:Subject>
      <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">%s</saml:NameID>
      <saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer">
        <saml:SubjectConfirmationData NotOnOrAfter="%s" Recipient="https://sp.clario360.sa/acs" InResponseTo="%s"/>
      </saml:SubjectConfirmation>
    </saml:Subject>
    <saml:Conditions NotBefore="%s" NotOnOrAfter="%s">
      <saml:AudienceRestriction><saml:Audience>%s</saml:Audience></saml:AudienceRestriction>
    </saml:Conditions>
    <saml:AuthnStatement AuthnInstant="%s" SessionIndex="_sess1">
      <saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext>
    </saml:AuthnStatement>
    <saml:AttributeStatement>
      <saml:Attribute Name="email" FriendlyName="email"><saml:AttributeValue>%s</saml:AttributeValue></saml:Attribute>
      <saml:Attribute Name="displayName"><saml:AttributeValue>Federated User</saml:AttributeValue></saml:Attribute>
      <saml:Attribute Name="givenName"><saml:AttributeValue>Federated</saml:AttributeValue></saml:Attribute>
      <saml:Attribute Name="surname"><saml:AttributeValue>User</saml:AttributeValue></saml:Attribute>
    </saml:AttributeStatement>
  </saml:Assertion>
</samlp:Response>`,
		notBefore.UTC().Format(time.RFC3339),
		notBefore.UTC().Format(time.RFC3339),
		testNameID,
		notOnOrAfter.UTC().Format(time.RFC3339), inResponseTo,
		notBefore.UTC().Format(time.RFC3339), notOnOrAfter.UTC().Format(time.RFC3339),
		audience,
		notBefore.UTC().Format(time.RFC3339),
		testNameID,
	)
}

func newTestSAMLProvider(t *testing.T, ks *samlTestKeyStore) *SAMLProvider {
	t.Helper()
	conn := model.IdPConnection{
		Provider:        "corp-saml",
		Kind:            model.IdPKindSAML,
		Enabled:         true,
		Issuer:          testSPEntityID, // SP entity id / audience
		RedirectURL:     "https://sp.clario360.sa/acs",
		SAMLMetadataXML: ks.metadataXML("https://idp.example.com/sso"),
	}
	prov, err := NewSAMLProvider(conn)
	if err != nil {
		t.Fatalf("NewSAMLProvider: %v", err)
	}
	return prov
}

// --- tests -------------------------------------------------------------------

// TestSAMLProvider_Kind confirms the protocol and that construction parses the
// signing cert and SSO URL out of metadata.
func TestSAMLProvider_Kind(t *testing.T) {
	ks := newSAMLTestKeyStore(t)
	prov := newTestSAMLProvider(t, ks)
	if prov.Kind() != model.IdPKindSAML {
		t.Fatalf("expected saml kind, got %q", prov.Kind())
	}
	url, err := prov.AuthCodeURL(context.Background(), AuthRequest{State: "relay-1"})
	if err != nil {
		t.Fatalf("AuthCodeURL: %v", err)
	}
	if !strings.Contains(url, "idp.example.com/sso") {
		t.Fatalf("auth url missing SSO endpoint: %s", url)
	}
	if !strings.Contains(url, "RelayState=relay-1") {
		t.Fatalf("auth url missing RelayState: %s", url)
	}
}

// TestSAMLProvider_NoSigningCert rejects a connection lacking a signing cert
// (fail-fast at construction — we never run signature-less).
func TestSAMLProvider_NoSigningCert(t *testing.T) {
	conn := model.IdPConnection{
		Provider: "corp-saml", Kind: model.IdPKindSAML, Enabled: true,
		AuthorizeURL: "https://idp.example.com/sso",
	}
	if _, err := NewSAMLProvider(conn); err == nil {
		t.Fatalf("expected error: SAML without a signing cert must not construct")
	}
}

// TestSAMLProvider_ValidAssertionAccepted is the happy path: a correctly signed,
// in-window, correct-audience assertion verifies and yields normalized claims.
func TestSAMLProvider_ValidAssertionAccepted(t *testing.T) {
	ks := newSAMLTestKeyStore(t)
	prov := newTestSAMLProvider(t, ks)
	signingSP := ks.signingSP(t)

	now := time.Now()
	xmlResp := responseTemplate(testSPEntityID, now.Add(-time.Minute), now.Add(time.Hour), "req-123")
	encoded := signResponse(t, signingSP, xmlResp)

	claims, err := prov.Exchange(context.Background(), AuthRequest{State: "req-123"}, CallbackParams{SAMLResponse: encoded})
	if err != nil {
		t.Fatalf("Exchange (valid): %v", err)
	}
	if claims.Subject != testNameID {
		t.Fatalf("expected subject %q, got %q", testNameID, claims.Subject)
	}
	if claims.Email != testNameID {
		t.Fatalf("expected email %q, got %q", testNameID, claims.Email)
	}
	if claims.GivenName != "Federated" || claims.FamilyName != "User" {
		t.Fatalf("expected given/family extraction, got %q / %q", claims.GivenName, claims.FamilyName)
	}
}

// TestSAMLProvider_TamperedAssertionRejected mutates a byte of the signed XML so
// the reference digest / signature no longer validates — MUST be rejected.
func TestSAMLProvider_TamperedAssertionRejected(t *testing.T) {
	ks := newSAMLTestKeyStore(t)
	prov := newTestSAMLProvider(t, ks)
	signingSP := ks.signingSP(t)

	now := time.Now()
	xmlResp := responseTemplate(testSPEntityID, now.Add(-time.Minute), now.Add(time.Hour), "req-1")
	encoded := signResponse(t, signingSP, xmlResp)

	// Decode, tamper the NameID, re-encode — signature now covers stale content.
	raw, _ := base64.StdEncoding.DecodeString(encoded)
	tampered := strings.Replace(string(raw), testNameID, "attacker@evil.example.com", 1)
	encodedTampered := base64.StdEncoding.EncodeToString([]byte(tampered))

	if _, err := prov.Exchange(context.Background(), AuthRequest{State: "req-1"}, CallbackParams{SAMLResponse: encodedTampered}); err == nil {
		t.Fatalf("expected tampered assertion to be REJECTED")
	}
}

// TestSAMLProvider_UnsignedRejected: an assertion with no signature at all must
// never be accepted (fail-closed).
func TestSAMLProvider_UnsignedRejected(t *testing.T) {
	ks := newSAMLTestKeyStore(t)
	prov := newTestSAMLProvider(t, ks)

	now := time.Now()
	xmlResp := responseTemplate(testSPEntityID, now.Add(-time.Minute), now.Add(time.Hour), "req-1")
	encoded := base64.StdEncoding.EncodeToString([]byte(xmlResp)) // unsigned

	if _, err := prov.Exchange(context.Background(), AuthRequest{State: "req-1"}, CallbackParams{SAMLResponse: encoded}); err == nil {
		t.Fatalf("expected unsigned assertion to be REJECTED")
	}
}

// TestSAMLProvider_WrongSignerRejected: signed by a DIFFERENT key than the IdP
// metadata cert — signature does not chain to a trusted cert, MUST be rejected.
func TestSAMLProvider_WrongSignerRejected(t *testing.T) {
	trusted := newSAMLTestKeyStore(t)
	prov := newTestSAMLProvider(t, trusted)

	attacker := newSAMLTestKeyStore(t) // different key, not in metadata
	attackerSP := attacker.signingSP(t)

	now := time.Now()
	xmlResp := responseTemplate(testSPEntityID, now.Add(-time.Minute), now.Add(time.Hour), "req-1")
	encoded := signResponse(t, attackerSP, xmlResp)

	if _, err := prov.Exchange(context.Background(), AuthRequest{State: "req-1"}, CallbackParams{SAMLResponse: encoded}); err == nil {
		t.Fatalf("expected assertion signed by an untrusted key to be REJECTED")
	}
}

// TestSAMLProvider_ExpiredRejected: a correctly-signed but expired assertion is
// rejected on the time window.
func TestSAMLProvider_ExpiredRejected(t *testing.T) {
	ks := newSAMLTestKeyStore(t)
	prov := newTestSAMLProvider(t, ks)
	signingSP := ks.signingSP(t)

	past := time.Now().Add(-2 * time.Hour)
	xmlResp := responseTemplate(testSPEntityID, past, past.Add(time.Minute), "req-1") // long expired
	encoded := signResponse(t, signingSP, xmlResp)

	if _, err := prov.Exchange(context.Background(), AuthRequest{State: "req-1"}, CallbackParams{SAMLResponse: encoded}); err == nil {
		t.Fatalf("expected expired assertion to be REJECTED")
	}
}

// TestSAMLProvider_WrongAudienceRejected: audience does not include the SP entity
// id — rejected.
func TestSAMLProvider_WrongAudienceRejected(t *testing.T) {
	ks := newSAMLTestKeyStore(t)
	prov := newTestSAMLProvider(t, ks)
	signingSP := ks.signingSP(t)

	now := time.Now()
	xmlResp := responseTemplate("https://some-other-sp.example.com", now.Add(-time.Minute), now.Add(time.Hour), "req-1")
	encoded := signResponse(t, signingSP, xmlResp)

	if _, err := prov.Exchange(context.Background(), AuthRequest{State: "req-1"}, CallbackParams{SAMLResponse: encoded}); err == nil {
		t.Fatalf("expected wrong-audience assertion to be REJECTED")
	}
}

// TestSAMLProvider_InResponseToMismatchRejected: the assertion's InResponseTo does
// not match the AuthnRequest id we issued (replay) — rejected.
func TestSAMLProvider_InResponseToMismatchRejected(t *testing.T) {
	ks := newSAMLTestKeyStore(t)
	prov := newTestSAMLProvider(t, ks)
	signingSP := ks.signingSP(t)

	now := time.Now()
	xmlResp := responseTemplate(testSPEntityID, now.Add(-time.Minute), now.Add(time.Hour), "DIFFERENT-req")
	encoded := signResponse(t, signingSP, xmlResp)

	if _, err := prov.Exchange(context.Background(), AuthRequest{State: "expected-req"}, CallbackParams{SAMLResponse: encoded}); err == nil {
		t.Fatalf("expected InResponseTo mismatch to be REJECTED")
	}
}

// TestSAMLProvider_IdPInitiatedNoInResponseTo: IdP-initiated SSO (no expected
// request id) is accepted when everything else verifies.
func TestSAMLProvider_IdPInitiatedNoInResponseTo(t *testing.T) {
	ks := newSAMLTestKeyStore(t)
	prov := newTestSAMLProvider(t, ks)
	signingSP := ks.signingSP(t)

	now := time.Now()
	xmlResp := responseTemplate(testSPEntityID, now.Add(-time.Minute), now.Add(time.Hour), "")
	encoded := signResponse(t, signingSP, xmlResp)

	claims, err := prov.Exchange(context.Background(), AuthRequest{State: ""}, CallbackParams{SAMLResponse: encoded})
	if err != nil {
		t.Fatalf("Exchange (idp-initiated): %v", err)
	}
	if claims.Subject != testNameID {
		t.Fatalf("expected subject from idp-initiated flow")
	}
}

// TestSAMLProvider_MissingResponseRejected: an empty SAMLResponse is rejected.
func TestSAMLProvider_MissingResponseRejected(t *testing.T) {
	ks := newSAMLTestKeyStore(t)
	prov := newTestSAMLProvider(t, ks)
	if _, err := prov.Exchange(context.Background(), AuthRequest{}, CallbackParams{SAMLResponse: "  "}); err == nil {
		t.Fatalf("expected missing SAMLResponse to be rejected")
	}
	if _, err := prov.Exchange(context.Background(), AuthRequest{}, CallbackParams{Error: "access_denied", ErrorDescription: "user cancelled"}); err == nil {
		t.Fatalf("expected idp error to be surfaced")
	}
}

// TestParseCertificate covers PEM and bare-base64 cert inputs.
func TestParseCertificate(t *testing.T) {
	ks := newSAMLTestKeyStore(t)
	pemBytes := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: ks.cert})
	if _, err := parseCertificate(string(pemBytes)); err != nil {
		t.Fatalf("parse PEM cert: %v", err)
	}
	if _, err := parseCertificate(base64.StdEncoding.EncodeToString(ks.cert)); err != nil {
		t.Fatalf("parse bare base64 cert: %v", err)
	}
	if _, err := parseCertificate("not-a-cert"); err == nil {
		t.Fatalf("expected error for garbage cert")
	}
}
