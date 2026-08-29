package service

import (
	"context"
	"reflect"
	"testing"

	"github.com/clario360/platform/internal/dr/appverify"
	"github.com/clario360/platform/internal/dr/model"
)

func TestRecoveryTargetAppPlannerSkipsUnconfiguredTargets(t *testing.T) {
	endpoint := "https://recovered.example.com/ready"
	plan, ok, err := NewRecoveryTargetAppPlanner().PlanAppVerification(
		context.Background(),
		&model.FailoverRun{},
		&model.RecoveryTarget{SiteID: "site-1", RecoveryEndpoint: &endpoint},
	)
	if err != nil {
		t.Fatalf("PlanAppVerification: %v", err)
	}
	if ok {
		t.Fatalf("expected unconfigured target to be skipped, got plan %#v", plan)
	}
}

func TestRecoveryTargetAppPlannerBuildsPlanFromRecoveryEndpoint(t *testing.T) {
	pointID := "rp-1"
	endpoint := "https://recovered.example.com/ready?appverify_kind=generic_http&marker_path=/marker&smoke_path=/smoke&appverify_include=http-write-smoke"
	plan, ok, err := NewRecoveryTargetAppPlanner().PlanAppVerification(
		context.Background(),
		&model.FailoverRun{RecoveryPointID: &pointID, RTOObjectiveSeconds: 900},
		&model.RecoveryTarget{SiteID: "site-1", RecoveryEndpoint: &endpoint},
	)
	if err != nil {
		t.Fatalf("PlanAppVerification: %v", err)
	}
	if !ok {
		t.Fatal("expected app verification plan")
	}
	if plan.WorkloadID != "site-1" || plan.ProfileKind != appverify.WorkloadGenericHTTP {
		t.Fatalf("plan identity = %#v", plan)
	}
	if plan.Parameters["endpoint.url"] != "https://recovered.example.com" {
		t.Fatalf("endpoint.url = %q", plan.Parameters["endpoint.url"])
	}
	if plan.Parameters["health_path"] != "/ready" || plan.Parameters["marker_path"] != "/marker" {
		t.Fatalf("parameters = %#v", plan.Parameters)
	}
	want := []string{"http-ready", "http-recovery-marker", "http-write-smoke"}
	if got := plan.CheckIDs(); !reflect.DeepEqual(got, want) {
		t.Fatalf("checks = %v, want %v", got, want)
	}
}
