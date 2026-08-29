package repository

import (
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	lexcrypto "github.com/clario360/platform/internal/lex/crypto"
	"github.com/clario360/platform/internal/lex/model"
)

func newCryptoRepo(t *testing.T) *ContractRepository {
	t.Helper()
	provider, err := lexcrypto.NewSoftwareKeyProviderRandom()
	if err != nil {
		t.Fatalf("key provider: %v", err)
	}
	fc, err := lexcrypto.NewFieldCrypto(provider)
	if err != nil {
		t.Fatalf("field crypto: %v", err)
	}
	// nil db is fine: these tests exercise only the in-memory crypto helpers.
	return NewContractRepository(nil, zerolog.Nop()).WithFieldCrypto(fc)
}

func ptr(s string) *string { return &s }

// TestContractFieldEncryption_WriteEncryptsReadDecrypts proves the at-rest
// contract: the values handed to the INSERT/UPDATE statement carry the enc:v1:
// prefix and are NOT plaintext, while a subsequent decrypt-on-read restores the
// original plaintext (WTQ-SEC-04).
func TestContractFieldEncryption_WriteEncryptsReadDecrypts(t *testing.T) {
	repo := newCryptoRepo(t)
	body := "Section 1. The parties agree to the following confidential terms..."
	contract := &model.Contract{
		ID:            uuid.New(),
		TenantID:      uuid.New(),
		DocumentText:  body,
		PartyBEntity:  ptr("ACME Holdings LLC"),
		PartyBContact: ptr("jane@acme.example, +966500000000"),
		PaymentTerms:  ptr("Net 30, SAR 1,250,000 on signature"),
	}

	// WRITE: encryptedContractFields returns the stored-on-disk values without
	// mutating the in-memory struct.
	docText, entity, contact, terms, err := repo.encryptedContractFields(contract)
	if err != nil {
		t.Fatalf("encryptedContractFields() error = %v", err)
	}
	if !lexcrypto.IsEncrypted(docText) {
		t.Fatalf("stored document_text not encrypted: %q", docText)
	}
	if strings.Contains(docText, "confidential terms") {
		t.Fatalf("stored document_text leaks plaintext: %q", docText)
	}
	for name, v := range map[string]*string{"party_b_entity": entity, "party_b_contact": contact, "payment_terms": terms} {
		if v == nil || !lexcrypto.IsEncrypted(*v) {
			t.Fatalf("stored %s not encrypted: %v", name, v)
		}
	}
	// In-memory struct keeps plaintext after write.
	if contract.DocumentText != body || contract.PartyBEntity == nil || *contract.PartyBEntity != "ACME Holdings LLC" {
		t.Fatalf("encryptedContractFields mutated the in-memory contract")
	}

	// READ: simulate loading a row that holds the encrypted values, then decrypt.
	loaded := &model.Contract{
		DocumentText:  docText,
		PartyBEntity:  entity,
		PartyBContact: contact,
		PaymentTerms:  terms,
	}
	if err := repo.decryptContractFields(loaded); err != nil {
		t.Fatalf("decryptContractFields() error = %v", err)
	}
	if loaded.DocumentText != body {
		t.Fatalf("document_text round trip = %q, want %q", loaded.DocumentText, body)
	}
	if loaded.PartyBEntity == nil || *loaded.PartyBEntity != "ACME Holdings LLC" {
		t.Fatalf("party_b_entity round trip = %v", loaded.PartyBEntity)
	}
	if loaded.PartyBContact == nil || *loaded.PartyBContact != "jane@acme.example, +966500000000" {
		t.Fatalf("party_b_contact round trip = %v", loaded.PartyBContact)
	}
	if loaded.PaymentTerms == nil || *loaded.PaymentTerms != "Net 30, SAR 1,250,000 on signature" {
		t.Fatalf("payment_terms round trip = %v", loaded.PaymentTerms)
	}
}

// TestContractFieldEncryption_LegacyPlaintextRead proves backward compatibility:
// a row written before encryption (no enc: prefix) reads back unchanged.
func TestContractFieldEncryption_LegacyPlaintextRead(t *testing.T) {
	repo := newCryptoRepo(t)
	loaded := &model.Contract{
		DocumentText:  "legacy plaintext body",
		PartyBEntity:  ptr("Legacy Entity"),
		PartyBContact: ptr("legacy@example.com"),
		PaymentTerms:  ptr("legacy terms"),
	}
	if err := repo.decryptContractFields(loaded); err != nil {
		t.Fatalf("decryptContractFields(legacy) error = %v", err)
	}
	if loaded.DocumentText != "legacy plaintext body" {
		t.Fatalf("legacy document_text = %q, want unchanged", loaded.DocumentText)
	}
	if loaded.PartyBEntity == nil || *loaded.PartyBEntity != "Legacy Entity" {
		t.Fatalf("legacy party_b_entity = %v, want unchanged", loaded.PartyBEntity)
	}
}

// TestContractFieldEncryption_DisabledIsPassthrough proves a repo without crypto
// configured stores and returns plaintext (no behavior change for existing
// deployments / tests).
func TestContractFieldEncryption_DisabledIsPassthrough(t *testing.T) {
	repo := NewContractRepository(nil, zerolog.Nop()) // no WithFieldCrypto
	contract := &model.Contract{DocumentText: "plain body", PartyBEntity: ptr("Entity")}
	docText, entity, _, _, err := repo.encryptedContractFields(contract)
	if err != nil {
		t.Fatalf("encryptedContractFields() error = %v", err)
	}
	if docText != "plain body" {
		t.Fatalf("disabled crypto encrypted document_text: %q", docText)
	}
	if entity == nil || *entity != "Entity" {
		t.Fatalf("disabled crypto altered party_b_entity: %v", entity)
	}
}
