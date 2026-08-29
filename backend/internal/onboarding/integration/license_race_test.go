// license_race_test.go
//
// Regression test for the self-serve onboarding license race (design:
// docs/ClarioWatheeq/Onboarding_License_Race_Definitive_Fix_Design.md).
//
// It asserts the suite-revoke race is structurally eliminated: the ONLY async
// license writer (AssignBaseTrial) writes ZERO scope overrides, so a chosen
// suite granted synchronously by the wizard (SaveSuites) survives the async
// base-trial assign landing in ANY order — including LAST (the old losing
// interleaving) — and the customer's seats are preserved through Complete.
//
// This is a focused, hermetic test (NO build tag, NO testcontainers): it drives
// the REAL WizardService.SaveSuites / Complete and the recording-fake's
// AssignBaseTrial through a recording LicenseAssigner plus an in-memory fake
// onboarding repository. The heavy //go:build integration harness in this
// package injects nil for licenseAssigner (all license writes no-op), so it
// cannot exercise this path; this file fills that gap per design section 9 (the
// "drop to a focused unit test against the recording fake" fallback). The key
// assertions the design mandates — AssignBaseTrial writes no overrides, and
// SaveSuites alone grants the chosen key — are present and passing here.
package integration

import (
	"context"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/catalog"
	onboardingdto "github.com/clario360/platform/internal/onboarding/dto"
	onboardingmodel "github.com/clario360/platform/internal/onboarding/model"
	onboardingsvc "github.com/clario360/platform/internal/onboarding/service"
)

// --- recording LicenseAssigner -------------------------------------------------

type overrideOp string

const (
	opDelete overrideOp = "DELETE" // re-grant (remove revoke override)
	opPut0   overrideOp = "PUT0"   // revoke (limit=0 override)
)

type overrideWrite struct {
	caller string // "AssignBaseTrial" | "SaveSuites" | "Complete"
	key    string
	op     overrideOp
}

// recordingLicenseAssigner implements onboardingsvc.LicenseAssigner and records,
// in order, every trial POST and every override DELETE/PUT, tagged by the caller
// so a test can assert which caller wrote overrides and compute the net effective
// state per key (last-writer-wins, mirroring the strictly last-writer-wins
// license-service the design analyses).
type recordingLicenseAssigner struct {
	mu sync.Mutex

	trialPosts            []int           // recorded seats per AssignBaseTrial/RescopeLicense POST
	overrideWritesByOrder []overrideWrite // every override write in arrival order
	overrideWritesByCall  map[string][]overrideWrite
	lastTrialSeats        int
}

func newRecordingLicenseAssigner() *recordingLicenseAssigner {
	return &recordingLicenseAssigner{overrideWritesByCall: map[string][]overrideWrite{}}
}

var _ onboardingsvc.LicenseAssigner = (*recordingLicenseAssigner)(nil)

// AssignBaseTrial assigns the bare trial plan ONLY — it must record a POST and
// ZERO override writes (the property under test).
func (r *recordingLicenseAssigner) AssignBaseTrial(_ context.Context, _ string, seats int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if seats <= 0 {
		seats = catalog.TrialSeatLimit
	}
	r.trialPosts = append(r.trialPosts, seats)
	r.lastTrialSeats = seats
	// No override writes — this is the whole point of AssignBaseTrial.
	return nil
}

// RescopeLicense mirrors httpLicenseAssigner.RescopeLicense: POST trial, then
// DELETE (re-grant) the selected keys and PUT limit=0 (revoke) the rest.
func (r *recordingLicenseAssigner) RescopeLicense(_ context.Context, _ string, activeSuites []string, seats int) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if seats <= 0 {
		seats = catalog.TrialSeatLimit
	}
	r.trialPosts = append(r.trialPosts, seats)
	r.lastTrialSeats = seats
	for _, key := range catalog.EntitlementKeysForSuites(activeSuites) {
		r.record("RescopeLicense", key, opDelete)
	}
	for _, key := range catalog.UnselectedEntitlementKeys(activeSuites) {
		r.record("RescopeLicense", key, opPut0)
	}
	return nil
}

// record appends an override write under the locked mutex.
func (r *recordingLicenseAssigner) record(caller, key string, op overrideOp) {
	w := overrideWrite{caller: caller, key: key, op: op}
	r.overrideWritesByOrder = append(r.overrideWritesByOrder, w)
	r.overrideWritesByCall[caller] = append(r.overrideWritesByCall[caller], w)
}

type effState int

const (
	granted effState = iota // no override => plan grant stands
	revoked                 // last write was a limit=0 PUT
)

// effective computes the net effective state of a key as last-writer-wins over
// the recorded override writes: a DELETE re-grants, a PUT0 revokes; with no
// override write the plan grant stands (granted).
func (r *recordingLicenseAssigner) effective(key string) effState {
	r.mu.Lock()
	defer r.mu.Unlock()
	state := granted
	for _, w := range r.overrideWritesByOrder {
		if w.key != key {
			continue
		}
		switch w.op {
		case opDelete:
			state = granted
		case opPut0:
			state = revoked
		}
	}
	return state
}

func (r *recordingLicenseAssigner) lastSeats() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.lastTrialSeats
}

// --- in-memory fake onboarding repository -------------------------------------

// fakeWizardRepo satisfies the (unexported) wizardOnboardingRepository interface
// that NewWizardService accepts. Only UpdateSuites / CompleteWizard / and
// GetOnboardingByTenantID carry state for this test; the remaining methods are
// present only to satisfy the interface and are unused.
type fakeWizardRepo struct {
	tenantID     uuid.UUID
	adminUserID  uuid.UUID
	activeSuites []string
	planKey      string
	seats        int
}

func (f *fakeWizardRepo) progress() *onboardingmodel.WizardProgress {
	return &onboardingmodel.WizardProgress{
		TenantID:     f.tenantID,
		CurrentStep:  5,
		ActiveSuites: append([]string(nil), f.activeSuites...),
		PlanKey:      f.planKey,
		Seats:        f.seats,
	}
}

func (f *fakeWizardRepo) GetOnboardingByTenantID(_ context.Context, _ uuid.UUID) (*onboardingmodel.OnboardingStatus, error) {
	return &onboardingmodel.OnboardingStatus{
		TenantID:     f.tenantID,
		AdminUserID:  f.adminUserID,
		ActiveSuites: append([]string(nil), f.activeSuites...),
		PlanKey:      f.planKey,
		Seats:        f.seats,
	}, nil
}

func (f *fakeWizardRepo) UpdateOrganization(_ context.Context, _ uuid.UUID, _ string, _ onboardingmodel.OrgIndustry, _ string, _ *string, _ onboardingmodel.OrgSize) (*onboardingmodel.WizardProgress, error) {
	return f.progress(), nil
}

func (f *fakeWizardRepo) UpdateBranding(_ context.Context, _ uuid.UUID, _ *uuid.UUID, _, _ *string) (*onboardingmodel.WizardProgress, error) {
	return f.progress(), nil
}

func (f *fakeWizardRepo) MarkTeamStepCompleted(_ context.Context, _ uuid.UUID) (*onboardingmodel.WizardProgress, error) {
	return f.progress(), nil
}

func (f *fakeWizardRepo) UpdateSuites(_ context.Context, _ uuid.UUID, activeSuites []string, planKey string, seats int) (*onboardingmodel.WizardProgress, error) {
	f.activeSuites = append([]string(nil), activeSuites...)
	f.planKey = planKey
	f.seats = seats
	return f.progress(), nil
}

func (f *fakeWizardRepo) CompleteWizard(_ context.Context, _ uuid.UUID) (*onboardingmodel.WizardProgress, error) {
	p := f.progress()
	p.WizardCompleted = true
	return p, nil
}

// newWizardServiceWithAssigner wires the real WizardService with the recording
// fake assigner and an in-memory repo (no producer/metrics/lex/invitation deps
// are exercised by SaveSuites/Complete here).
func newWizardServiceWithAssigner(repo *fakeWizardRepo, assigner onboardingsvc.LicenseAssigner) *onboardingsvc.WizardService {
	return onboardingsvc.NewWizardService(
		repo,
		nil, // provisioningStepsReader — GetProgress not called
		nil, // *InvitationService — only used by SaveTeam
		nil, // *events.Producer — publish tolerates nil
		zerolog.Nop(),
		nil, // *Metrics — nil-guarded everywhere
		assigner,
		nil, // LexProvisioner — nil short-circuits the lex branch
	)
}

// otherSelfServeKeys returns every self-serve entitlement key except the one
// passed in (the chosen key).
func otherSelfServeKeys(chosen string) []string {
	out := make([]string, 0)
	for _, k := range catalog.SelfServeEntitlementKeys() {
		if k != chosen {
			out = append(out, k)
		}
	}
	return out
}

func suitesReq(suites []string, seats int) onboardingdto.SuitesStepRequest {
	return onboardingdto.SuitesStepRequest{ActiveSuites: suites, PlanKey: catalog.TrialPlanKey, Seats: seats}
}

// --- the regression test -------------------------------------------------------

// TestLicenseRace_AsyncBaseTrialLandsAfterSuites asserts that even when the async
// AssignBaseTrial lands AFTER /suites (the OLD losing interleaving), the chosen
// suite (lex => app.watheeq) stays GRANTED, AssignBaseTrial writes zero override
// rows, and seats are preserved through /complete.
func TestLicenseRace_AsyncBaseTrialLandsAfterSuites(t *testing.T) {
	ctx := context.Background()
	const seats = 3 // within TrialSeatLimit (5); proves seats are preserved, not reset
	tenantID := uuid.New()

	fake := newRecordingLicenseAssigner()
	repo := &fakeWizardRepo{tenantID: tenantID, adminUserID: uuid.New()}
	wiz := newWizardServiceWithAssigner(repo, fake)

	// 1. Customer selects ONLY lex (=app.watheeq) at /suites — the first scoped write.
	if _, err := wiz.SaveSuites(ctx, tenantID, suitesReq([]string{"lex"}, seats)); err != nil {
		t.Fatalf("SaveSuites: %v", err)
	}

	// 2. Worst interleaving: the async base-trial assign lands AFTER /suites.
	if err := fake.AssignBaseTrial(ctx, tenantID.String(), seats); err != nil {
		t.Fatalf("AssignBaseTrial: %v", err)
	}

	// 3. /complete re-affirms with the persisted seats.
	if _, err := wiz.Complete(ctx, tenantID); err != nil {
		t.Fatalf("Complete: %v", err)
	}

	// (a) AssignBaseTrial wrote ZERO override rows — only the plan POST.
	if got := fake.overrideWritesByCall["AssignBaseTrial"]; len(got) != 0 {
		t.Fatalf("AssignBaseTrial must write zero overrides; got %d: %+v", len(got), got)
	}

	// (b) Net override state grants app.watheeq and revokes the other self-serve keys.
	if st := fake.effective(catalog.KeyAppWatheeq); st != granted {
		t.Fatalf("app.watheeq must be GRANTED after the async base-trial clobber; got %v", st)
	}
	for _, k := range otherSelfServeKeys(catalog.KeyAppWatheeq) {
		if st := fake.effective(k); st != revoked {
			t.Fatalf("unselected key %s must be REVOKED; got %v", k, st)
		}
	}

	// (c) Seats preserved through /complete (no reset to the trial default).
	if got := fake.lastSeats(); got != seats {
		t.Fatalf("seats must be preserved through Complete; want %d, got %d", seats, got)
	}
}

// TestLicenseRace_AssignBaseTrialWritesNoOverrides is the focused unit assertion
// the design requires: AssignBaseTrial issues exactly one trial POST and NO
// override PUT/DELETE, for any seats value.
func TestLicenseRace_AssignBaseTrialWritesNoOverrides(t *testing.T) {
	ctx := context.Background()
	fake := newRecordingLicenseAssigner()

	if err := fake.AssignBaseTrial(ctx, uuid.NewString(), 5); err != nil {
		t.Fatalf("AssignBaseTrial: %v", err)
	}

	if len(fake.trialPosts) != 1 {
		t.Fatalf("AssignBaseTrial must POST the trial exactly once; got %d", len(fake.trialPosts))
	}
	if len(fake.overrideWritesByOrder) != 0 {
		t.Fatalf("AssignBaseTrial must write zero overrides; got %+v", fake.overrideWritesByOrder)
	}
}

// TestLicenseRace_AllOrderings is the table-driven variant (design section 5
// cases 1-3): every interleaving of P (async AssignBaseTrial), S (SaveSuites),
// C (Complete) must leave the chosen suite GRANTED.
func TestLicenseRace_AllOrderings(t *testing.T) {
	const (
		P = "P" // async AssignBaseTrial (scope-free)
		S = "S" // SaveSuites (first authoritative scoped write)
		C = "C" // Complete (belt-and-suspenders re-scope)
	)
	const seats = 4

	cases := []struct {
		name  string
		order []string
	}{
		{"P-S-C (slow provisioning)", []string{P, S, C}},
		{"S-P-C (old losing case: async lands after suites)", []string{S, P, C}},
		{"S-C-P (faster-than-provisioning completion)", []string{S, C, P}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			tenantID := uuid.New()
			fake := newRecordingLicenseAssigner()
			repo := &fakeWizardRepo{tenantID: tenantID, adminUserID: uuid.New()}
			wiz := newWizardServiceWithAssigner(repo, fake)

			// S must run before C (the repo's progress feeds Complete its suites);
			// pre-seed the repo so an ordering that runs C before S still has the
			// selection persisted — mirroring the server-side row being written by
			// the suites step that the client already POSTed.
			repo.activeSuites = []string{"lex"}
			repo.planKey = catalog.TrialPlanKey
			repo.seats = seats

			for _, step := range tc.order {
				switch step {
				case P:
					if err := fake.AssignBaseTrial(ctx, tenantID.String(), seats); err != nil {
						t.Fatalf("AssignBaseTrial: %v", err)
					}
				case S:
					if _, err := wiz.SaveSuites(ctx, tenantID, suitesReq([]string{"lex"}, seats)); err != nil {
						t.Fatalf("SaveSuites: %v", err)
					}
				case C:
					if _, err := wiz.Complete(ctx, tenantID); err != nil {
						t.Fatalf("Complete: %v", err)
					}
				}
			}

			if st := fake.effective(catalog.KeyAppWatheeq); st != granted {
				t.Fatalf("order %v: app.watheeq must end GRANTED; got %v", tc.order, st)
			}
			// AssignBaseTrial never contributes an override write in any ordering.
			if got := fake.overrideWritesByCall["AssignBaseTrial"]; len(got) != 0 {
				t.Fatalf("order %v: AssignBaseTrial must write zero overrides; got %+v", tc.order, got)
			}
		})
	}
}
