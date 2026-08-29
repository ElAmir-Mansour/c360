package service

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"
)

// fakeImportRoleReader is a canned PersonaRoleReader for the merge tests.
type fakeImportRoleReader struct {
	roles []PersonaImportRole
	err   error
}

func (f fakeImportRoleReader) ImportRoles(_ context.Context, _ uuid.UUID, _ []string) ([]PersonaImportRole, error) {
	return f.roles, f.err
}

func slugsOf(rs []LegalRoleSummary) map[string]LegalRoleSummary {
	out := make(map[string]LegalRoleSummary, len(rs))
	for _, r := range rs {
		out[normalizePersonaSlug(r.Slug)] = r
	}
	return out
}

// fakePersonaStore records the last-selected persona in memory.
type fakePersonaStore struct{ slug string }

func (f *fakePersonaStore) GetActiveRoleSlug(_ context.Context, _, _ uuid.UUID) (string, error) {
	return f.slug, nil
}
func (f *fakePersonaStore) SetActiveRoleSlug(_ context.Context, _, _ uuid.UUID, slug string) error {
	f.slug = slug
	return nil
}

func newPersona(reader PersonaRoleReader) *PersonaService {
	s := NewPersonaService(&fakePersonaStore{}, zerolog.Nop())
	s.SetRoleReader(reader)
	return s
}

func TestResolveAvailable_NoReaderIsBaselineOnly(t *testing.T) {
	s := NewPersonaService(nil, zerolog.Nop())
	got := s.resolveAvailable(context.Background(), uuid.New(), []string{"legal-officer"})
	if len(got) != 1 || normalizePersonaSlug(got[0].Slug) != "legal-officer" {
		t.Fatalf("no reader must resolve from built-in defs only; got %+v", got)
	}
}

func TestResolveAvailable_CustomRoleSurfaced(t *testing.T) {
	reader := fakeImportRoleReader{roles: []PersonaImportRole{
		{Slug: "legal-paralegal", NameEN: "Paralegal", NameAR: "مساعد قانوني", Tier: "Legal", Active: true},
	}}
	s := newPersona(reader)
	// The user holds ONLY the custom role — previously this yielded NO_LEX_ROLE.
	got := s.resolveAvailable(context.Background(), uuid.New(), []string{"legal-paralegal"})
	idx := slugsOf(got)
	custom, ok := idx["legal-paralegal"]
	if !ok {
		t.Fatalf("custom import role must be offered as a persona; got %+v", got)
	}
	if custom.NameEN != "Paralegal" || custom.NameAR != "مساعد قانوني" {
		t.Fatalf("custom persona must carry its imported names; got %+v", custom)
	}
}

func TestResolveAvailable_DeactivatedBaselineHidden(t *testing.T) {
	reader := fakeImportRoleReader{roles: []PersonaImportRole{
		{Slug: "legal-officer", Active: false}, // tombstoned by an import
	}}
	s := newPersona(reader)
	got := s.resolveAvailable(context.Background(), uuid.New(), []string{"legal-officer", "legal-advisor"})
	idx := slugsOf(got)
	if _, ok := idx["legal-officer"]; ok {
		t.Fatalf("a deactivated baseline role must NOT be offered as a persona; got %+v", got)
	}
	if _, ok := idx["legal-advisor"]; !ok {
		t.Fatalf("an unaffected baseline role must remain; got %+v", got)
	}
}

func TestResolveAvailable_ReshapedBaselinePrefersImportMetadata(t *testing.T) {
	reader := fakeImportRoleReader{roles: []PersonaImportRole{
		{Slug: "legal-officer", NameEN: "Senior Legal Officer", Tier: "Ops", Active: true},
	}}
	s := newPersona(reader)
	got := s.resolveAvailable(context.Background(), uuid.New(), []string{"legal-officer"})
	idx := slugsOf(got)
	officer := idx["legal-officer"]
	if officer.NameEN != "Senior Legal Officer" {
		t.Fatalf("a reshaped baseline must show the tenant's imported name; got %+v", officer)
	}
	if len(got) != 1 {
		t.Fatalf("reshaping must not duplicate the role; got %+v", got)
	}
}

func TestResolveAvailable_ReaderErrorDegradesToBaseline(t *testing.T) {
	reader := fakeImportRoleReader{err: context.DeadlineExceeded}
	s := newPersona(reader)
	got := s.resolveAvailable(context.Background(), uuid.New(), []string{"legal-officer"})
	if len(got) != 1 || normalizePersonaSlug(got[0].Slug) != "legal-officer" {
		t.Fatalf("a reader error must degrade to built-in defs (never lock out a baseline user); got %+v", got)
	}
}

func TestResolve_CustomOnlyUserIsReadyNotNoRole(t *testing.T) {
	reader := fakeImportRoleReader{roles: []PersonaImportRole{
		{Slug: "legal-paralegal", NameEN: "Paralegal", Active: true},
	}}
	s := newPersona(reader)
	resp, err := s.Resolve(context.Background(), uuid.New(), uuid.New(), []string{"legal-paralegal"})
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if resp.AccessState != AccessStateReady {
		t.Fatalf("a custom-only user must be READY, not %s", resp.AccessState)
	}
	if resp.ActiveLegalRole == nil || normalizePersonaSlug(resp.ActiveLegalRole.Slug) != "legal-paralegal" {
		t.Fatalf("the custom role must be the active persona; got %+v", resp.ActiveLegalRole)
	}
}

func TestSetPersona_CustomRoleSelectable(t *testing.T) {
	reader := fakeImportRoleReader{roles: []PersonaImportRole{
		{Slug: "legal-paralegal", NameEN: "Paralegal", Active: true},
	}}
	s := newPersona(reader)
	resp, err := s.SetPersona(context.Background(), uuid.New(), uuid.New(), []string{"legal-paralegal", "legal-officer"}, "legal-paralegal")
	if err != nil {
		t.Fatalf("selecting a held custom persona must succeed; got %v", err)
	}
	if normalizePersonaSlug(resp.ActiveLegalRole.Slug) != "legal-paralegal" {
		t.Fatalf("active persona must be the selected custom role; got %+v", resp.ActiveLegalRole)
	}
	// A role the caller does not hold is still rejected.
	if _, err := s.SetPersona(context.Background(), uuid.New(), uuid.New(), []string{"legal-paralegal"}, "legal-director"); err == nil {
		t.Fatal("selecting a persona the caller does not hold must be rejected")
	}
}

func TestLandingForRole_CasesManagerUsesControlDashboard(t *testing.T) {
	if got := landingForRole("legal-cases-manager"); got != "/lex/cases/control" {
		t.Fatalf("cases-manager landing = %q, want /lex/cases/control", got)
	}
	if got := landingForRole("legal_cases_manager"); got != "/lex/cases/control" {
		t.Fatalf("normalized cases-manager landing = %q, want /lex/cases/control", got)
	}
}
