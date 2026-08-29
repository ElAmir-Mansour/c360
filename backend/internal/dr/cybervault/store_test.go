package cybervault

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/pashagolub/pgxmock/v4"
)

const (
	storeTenant = "aaaaaaaa-0000-0000-0000-000000000001"
	storeGroup  = "bbbbbbbb-0000-0000-0000-000000000001"
	storeVault  = "cccccccc-0000-0000-0000-000000000001"
)

func newStoreMock(t *testing.T) pgxmock.PgxPoolIface {
	t.Helper()
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	t.Cleanup(mock.Close)
	return mock
}

func testVaultPosture() VaultPosture {
	p := strongPosture()
	p.ID = storeVault
	p.Name = "prod-vault"
	return p
}

func TestStore_UpsertAndListVaults_JSONRoundTrip(t *testing.T) {
	t.Parallel()
	mock := newStoreMock(t)
	store := NewStore()
	now := time.Date(2026, 6, 13, 12, 0, 0, 0, time.UTC)
	posture := testVaultPosture()
	postureJSON, err := json.Marshal(posture)
	if err != nil {
		t.Fatalf("marshal posture: %v", err)
	}

	mock.ExpectQuery(`INSERT INTO dr_cybervault_vault`).
		WithArgs(storeTenant, storeGroup, VaultProviderAWSBackup, "prod-vault", "aws:backup:vault/prod", postureJSON).
		WillReturnRows(vaultRows().
			AddRow(storeVault, storeTenant, storeGroup, VaultProviderAWSBackup, "prod-vault", "aws:backup:vault/prod", postureJSON, now, now))

	v := &RegisteredVault{
		TenantID:   storeTenant,
		GroupID:    storeGroup,
		Provider:   VaultProviderAWSBackup,
		Name:       "prod-vault",
		ExternalID: "aws:backup:vault/prod",
		Posture:    posture,
	}
	if err := store.UpsertVault(context.Background(), mock, v); err != nil {
		t.Fatalf("UpsertVault: %v", err)
	}
	if v.ID != storeVault || !reflect.DeepEqual(v.Posture, posture) {
		t.Fatalf("unexpected upserted vault: %+v", v)
	}

	mock.ExpectQuery(`SELECT\s+id, tenant_id, group_id, provider`).
		WithArgs(storeTenant, storeGroup).
		WillReturnRows(vaultRows().
			AddRow(storeVault, storeTenant, storeGroup, VaultProviderAWSBackup, "prod-vault", "aws:backup:vault/prod", postureJSON, now, now))

	got, err := store.ListVaults(context.Background(), mock, storeTenant, storeGroup)
	if err != nil {
		t.Fatalf("ListVaults: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d vaults, want 1", len(got))
	}
	if !reflect.DeepEqual(got[0].Posture, posture) {
		t.Fatalf("posture roundtrip mismatch:\n got: %#v\nwant: %#v", got[0].Posture, posture)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStore_GetVault_NotFound(t *testing.T) {
	t.Parallel()
	mock := newStoreMock(t)
	store := NewStore()

	mock.ExpectQuery(`SELECT\s+id, tenant_id, group_id, provider`).
		WithArgs(storeTenant, storeVault).
		WillReturnError(pgx.ErrNoRows)

	_, err := store.GetVault(context.Background(), mock, storeTenant, storeVault)
	if !errors.Is(err, ErrNotFound) {
		t.Fatalf("got %v, want ErrNotFound", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStore_SaveListAndLatestAssessment_JSONRoundTrip(t *testing.T) {
	t.Parallel()
	mock := newStoreMock(t)
	store := NewStore()
	evaluatedAt := time.Date(2026, 6, 13, 13, 0, 0, 0, time.UTC)
	createdAt := evaluatedAt.Add(time.Second)
	posture := testVaultPosture()
	assessment := Evaluate(posture, evaluatedAt)
	postureJSON, err := json.Marshal(posture)
	if err != nil {
		t.Fatalf("marshal posture: %v", err)
	}
	assessmentJSON, err := json.Marshal(assessment)
	if err != nil {
		t.Fatalf("marshal assessment: %v", err)
	}

	mock.ExpectQuery(`INSERT INTO dr_cybervault_assessment`).
		WithArgs(
			storeTenant, storeGroup, storeVault, VaultProviderAWSBackup,
			postureJSON, assessmentJSON, assessment.Score, assessment.Verdict, evaluatedAt,
		).
		WillReturnRows(assessmentRows().
			AddRow("assess-1", storeTenant, storeGroup, storeVault, VaultProviderAWSBackup,
				postureJSON, assessmentJSON, assessment.Score, assessment.Verdict, evaluatedAt, createdAt))

	saved, err := store.SaveAssessment(context.Background(), mock, storeTenant, storeGroup, posture, assessment)
	if err != nil {
		t.Fatalf("SaveAssessment: %v", err)
	}
	assertAssessmentRoundTrip(t, saved, posture, assessment)

	mock.ExpectQuery(`SELECT\s+id, tenant_id, group_id, vault_id`).
		WithArgs(storeTenant, storeVault, 100).
		WillReturnRows(assessmentRows().
			AddRow("assess-1", storeTenant, storeGroup, storeVault, VaultProviderAWSBackup,
				postureJSON, assessmentJSON, assessment.Score, assessment.Verdict, evaluatedAt, createdAt))

	listed, err := store.ListAssessments(context.Background(), mock, storeTenant, storeVault, 0)
	if err != nil {
		t.Fatalf("ListAssessments: %v", err)
	}
	if len(listed) != 1 {
		t.Fatalf("got %d assessments, want 1", len(listed))
	}
	assertAssessmentRoundTrip(t, &listed[0], posture, assessment)

	mock.ExpectQuery(`WITH latest AS`).
		WithArgs(storeTenant, storeGroup).
		WillReturnRows(assessmentRows().
			AddRow("assess-1", storeTenant, storeGroup, storeVault, VaultProviderAWSBackup,
				postureJSON, assessmentJSON, assessment.Score, assessment.Verdict, evaluatedAt, createdAt))

	latestByVault, err := store.ListLatestAssessments(context.Background(), mock, storeTenant, storeGroup)
	if err != nil {
		t.Fatalf("ListLatestAssessments: %v", err)
	}
	if len(latestByVault) != 1 {
		t.Fatalf("got %d latest assessments, want 1", len(latestByVault))
	}
	assertAssessmentRoundTrip(t, &latestByVault[0], posture, assessment)

	mock.ExpectQuery(`SELECT\s+id, tenant_id, group_id, vault_id`).
		WithArgs(storeTenant, storeVault).
		WillReturnRows(assessmentRows().
			AddRow("assess-1", storeTenant, storeGroup, storeVault, VaultProviderAWSBackup,
				postureJSON, assessmentJSON, assessment.Score, assessment.Verdict, evaluatedAt, createdAt))

	latest, err := store.GetLatestAssessment(context.Background(), mock, storeTenant, storeVault)
	if err != nil {
		t.Fatalf("GetLatestAssessment: %v", err)
	}
	assertAssessmentRoundTrip(t, latest, posture, assessment)

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStaticPostureSource_FiltersAndNormalises(t *testing.T) {
	t.Parallel()
	src := NewStaticPostureSource([]RegisteredVault{
		{TenantID: storeTenant, GroupID: storeGroup, Provider: VaultProviderAzureBackup, Name: "az-vault", ExternalID: "vault/ext"},
		{TenantID: "other", GroupID: storeGroup, Provider: VaultProviderAWSBackup, Name: "other"},
	})

	got, err := src.ListRegisteredVaults(context.Background(), storeTenant, storeGroup)
	if err != nil {
		t.Fatalf("ListRegisteredVaults: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("got %d vaults, want 1", len(got))
	}
	if got[0].Posture.ID != "vault/ext" || got[0].Posture.Name != "az-vault" || got[0].Posture.Provider != VaultProviderAzureBackup {
		t.Fatalf("vault not normalised from inventory metadata: %+v", got[0])
	}
}

func assertAssessmentRoundTrip(t *testing.T, got *StoredPostureAssessment, posture VaultPosture, assessment PostureAssessment) {
	t.Helper()
	if got.ID != "assess-1" || got.VaultID != storeVault || got.Score != assessment.Score || got.Verdict != assessment.Verdict {
		t.Fatalf("unexpected stored assessment header: %+v", got)
	}
	if !reflect.DeepEqual(got.Posture, posture) {
		t.Fatalf("posture roundtrip mismatch:\n got: %#v\nwant: %#v", got.Posture, posture)
	}
	if !reflect.DeepEqual(got.Assessment, assessment) {
		t.Fatalf("assessment roundtrip mismatch:\n got: %#v\nwant: %#v", got.Assessment, assessment)
	}
}

func vaultRows() *pgxmock.Rows {
	return pgxmock.NewRows([]string{
		"id", "tenant_id", "group_id", "provider", "name", "external_id", "posture", "created_at", "updated_at",
	})
}

func assessmentRows() *pgxmock.Rows {
	return pgxmock.NewRows([]string{
		"id", "tenant_id", "group_id", "vault_id", "provider", "posture", "assessment",
		"score", "verdict", "evaluated_at", "created_at",
	})
}
