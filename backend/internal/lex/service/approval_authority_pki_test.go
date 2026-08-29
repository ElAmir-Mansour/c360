package service

import (
	"context"
	"errors"
	"testing"

	lexcrypto "github.com/clario360/platform/internal/lex/crypto"
	"github.com/clario360/platform/internal/lex/dto"
)

// stubAuthorityValidator is an in-memory AuthorityEvidenceValidator used to drive
// validateAuthorityEvidencePKI without any real crypto. It records the last input
// and returns the configured result/err.
type stubAuthorityValidator struct {
	result *lexcrypto.VerifiedAuthority
	err    error
	calls  int
	lastIn lexcrypto.AuthorityEvidenceInput
}

func (s *stubAuthorityValidator) Validate(_ context.Context, in lexcrypto.AuthorityEvidenceInput) (*lexcrypto.VerifiedAuthority, error) {
	s.calls++
	s.lastIn = in
	return s.result, s.err
}

func fpv(v float64) *float64 { return &v }

func cryptoEvidence() *dto.ApprovalAuthorityEvidence {
	return &dto.ApprovalAuthorityEvidence{
		Role:            "cfo",
		AuthorityAmount: 1000,
		Currency:        "SAR",
		EvidenceID:      "ev-1",
		CertificatePEM:  "-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----",
		SignatureB64:    "c2ln",
		SignatureAlg:    lexcrypto.AlgECDSASHA256,
	}
}

func requiringPolicy() *watheeqApprovalPolicy {
	return &watheeqApprovalPolicy{
		PolicyID:                 "p-1",
		RequireAuthorityEvidence: true,
	}
}

func TestValidateAuthorityEvidencePKI_SkippedWhenNotApprove(t *testing.T) {
	stub := &stubAuthorityValidator{}
	s := &WorkflowService{authorityValidator: stub, authorityRootsConfigured: true}
	req := dto.WorkflowDecisionRequest{Decision: "reject", AuthorityEvidence: cryptoEvidence()}
	if err := s.validateAuthorityEvidencePKI(context.Background(), req, workflowDecisionTarget{}, requiringPolicy()); err != nil {
		t.Fatalf("expected nil for non-approve decision, got %v", err)
	}
	if stub.calls != 0 {
		t.Fatalf("validator must not run for a non-approve decision, calls=%d", stub.calls)
	}
}

func TestValidateAuthorityEvidencePKI_FallbackWhenNoRoots(t *testing.T) {
	// No validator and no roots configured => plain-text fallback, no error even
	// though cryptographic material was supplied.
	s := &WorkflowService{authorityValidator: nil, authorityRootsConfigured: false}
	req := dto.WorkflowDecisionRequest{Decision: "approve", AuthorityEvidence: cryptoEvidence()}
	if err := s.validateAuthorityEvidencePKI(context.Background(), req, workflowDecisionTarget{}, requiringPolicy()); err != nil {
		t.Fatalf("expected nil fallback, got %v", err)
	}
}

func TestValidateAuthorityEvidencePKI_StrictRequiresCryptoMaterial(t *testing.T) {
	stub := &stubAuthorityValidator{}
	s := &WorkflowService{authorityValidator: stub, authorityRootsConfigured: true}
	// Strict mode but evidence carries no cert/signature => rejected before calling
	// the validator.
	req := dto.WorkflowDecisionRequest{Decision: "approve", AuthorityEvidence: &dto.ApprovalAuthorityEvidence{
		Role: "cfo", AuthorityAmount: 10, Currency: "SAR", EvidenceID: "ev",
	}}
	err := s.validateAuthorityEvidencePKI(context.Background(), req, workflowDecisionTarget{}, requiringPolicy())
	if err == nil {
		t.Fatal("expected validation error for missing cryptographic material")
	}
	if stub.calls != 0 {
		t.Fatalf("validator must not run when material is absent, calls=%d", stub.calls)
	}
}

func TestValidateAuthorityEvidencePKI_MapsCryptoErrors(t *testing.T) {
	cases := []struct {
		name string
		err  error
	}{
		{"expired", lexcrypto.ErrExpired},
		{"chain", lexcrypto.ErrChainInvalid},
		{"signature", lexcrypto.ErrSignatureInvalid},
		{"alg", lexcrypto.ErrUnsupportedAlg},
		{"revoked", lexcrypto.ErrRevoked},
		{"malformed", lexcrypto.ErrInvalidEvidence},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			stub := &stubAuthorityValidator{err: tc.err}
			s := &WorkflowService{authorityValidator: stub, authorityRootsConfigured: true}
			req := dto.WorkflowDecisionRequest{Decision: "approve", AuthorityEvidence: cryptoEvidence()}
			err := s.validateAuthorityEvidencePKI(context.Background(), req, workflowDecisionTarget{}, requiringPolicy())
			if err == nil {
				t.Fatalf("expected error for %s", tc.name)
			}
			if stub.calls != 1 {
				t.Fatalf("validator should run exactly once, calls=%d", stub.calls)
			}
		})
	}
}

func TestValidateAuthorityEvidencePKI_BoundAmountBelowRequirement(t *testing.T) {
	stub := &stubAuthorityValidator{result: &lexcrypto.VerifiedAuthority{
		AuthorityAmount: fpv(500),
	}}
	s := &WorkflowService{authorityValidator: stub, authorityRootsConfigured: true}
	policy := requiringPolicy()
	policy.RequiredAuthorityAmount = fpv(1000)
	req := dto.WorkflowDecisionRequest{Decision: "approve", AuthorityEvidence: cryptoEvidence()}
	err := s.validateAuthorityEvidencePKI(context.Background(), req, workflowDecisionTarget{}, policy)
	if err == nil {
		t.Fatal("expected error when bound amount is below required authority")
	}
}

func TestValidateAuthorityEvidencePKI_BoundAmountBelowContractValue(t *testing.T) {
	stub := &stubAuthorityValidator{result: &lexcrypto.VerifiedAuthority{AuthorityAmount: fpv(800)}}
	s := &WorkflowService{authorityValidator: stub, authorityRootsConfigured: true}
	target := workflowDecisionTarget{contractValue: fpv(1200)}
	req := dto.WorkflowDecisionRequest{Decision: "approve", AuthorityEvidence: cryptoEvidence()}
	err := s.validateAuthorityEvidencePKI(context.Background(), req, target, requiringPolicy())
	if err == nil {
		t.Fatal("expected error when bound amount is below contract value")
	}
}

func TestValidateAuthorityEvidencePKI_HappyPath(t *testing.T) {
	stub := &stubAuthorityValidator{result: &lexcrypto.VerifiedAuthority{
		AuthorityAmount:   fpv(5000),
		ChainVerified:     true,
		SignatureVerified: true,
	}}
	s := &WorkflowService{authorityValidator: stub, authorityRootsConfigured: true}
	policy := requiringPolicy()
	policy.RequiredAuthorityAmount = fpv(1000)
	target := workflowDecisionTarget{contractValue: fpv(1500)}
	ev := cryptoEvidence()
	ev.SignedPayloadB64 = "eyJhdXRob3JpdHlfYW1vdW50Ijo1MDAwfQ==" // {"authority_amount":5000}
	req := dto.WorkflowDecisionRequest{Decision: "approve", AuthorityEvidence: ev}
	if err := s.validateAuthorityEvidencePKI(context.Background(), req, target, policy); err != nil {
		t.Fatalf("expected happy-path success, got %v", err)
	}
	if stub.calls != 1 {
		t.Fatalf("validator should run once, calls=%d", stub.calls)
	}
	if len(stub.lastIn.Payload) == 0 {
		t.Fatal("expected decoded signed payload to be forwarded to the validator")
	}
}

func TestValidateAuthorityEvidencePKI_InvalidBase64Payload(t *testing.T) {
	stub := &stubAuthorityValidator{}
	s := &WorkflowService{authorityValidator: stub, authorityRootsConfigured: true}
	ev := cryptoEvidence()
	ev.SignedPayloadB64 = "not valid base64 @@@"
	req := dto.WorkflowDecisionRequest{Decision: "approve", AuthorityEvidence: ev}
	err := s.validateAuthorityEvidencePKI(context.Background(), req, workflowDecisionTarget{}, requiringPolicy())
	if err == nil {
		t.Fatal("expected validation error for malformed base64 payload")
	}
	if stub.calls != 0 {
		t.Fatalf("validator must not run when payload base64 is invalid, calls=%d", stub.calls)
	}
}

func TestValidateAuthorityEvidencePKI_PolicyNotRequiring(t *testing.T) {
	stub := &stubAuthorityValidator{}
	s := &WorkflowService{authorityValidator: stub, authorityRootsConfigured: true}
	policy := &watheeqApprovalPolicy{RequireAuthorityEvidence: false}
	req := dto.WorkflowDecisionRequest{Decision: "approve", AuthorityEvidence: cryptoEvidence()}
	if err := s.validateAuthorityEvidencePKI(context.Background(), req, workflowDecisionTarget{}, policy); err != nil {
		t.Fatalf("expected nil when policy does not require evidence, got %v", err)
	}
	if stub.calls != 0 {
		t.Fatalf("validator must not run when policy does not require evidence, calls=%d", stub.calls)
	}
}

func TestHasCryptographicEvidence(t *testing.T) {
	if (&dto.ApprovalAuthorityEvidence{}).HasCryptographicEvidence() {
		t.Fatal("empty evidence must not be cryptographic")
	}
	if !cryptoEvidence().HasCryptographicEvidence() {
		t.Fatal("full crypto evidence must report true")
	}
	partial := cryptoEvidence()
	partial.SignatureB64 = ""
	if partial.HasCryptographicEvidence() {
		t.Fatal("evidence missing signature must report false")
	}
}

func TestValidateAuthorityEvidencePKI_NonSentinelErrorIsInternal(t *testing.T) {
	stub := &stubAuthorityValidator{err: errors.New("boom")}
	s := &WorkflowService{authorityValidator: stub, authorityRootsConfigured: true}
	req := dto.WorkflowDecisionRequest{Decision: "approve", AuthorityEvidence: cryptoEvidence()}
	if err := s.validateAuthorityEvidencePKI(context.Background(), req, workflowDecisionTarget{}, requiringPolicy()); err == nil {
		t.Fatal("expected an error for a non-sentinel validator failure")
	}
}
