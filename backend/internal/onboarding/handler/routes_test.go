package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	onboardingdto "github.com/clario360/platform/internal/onboarding/dto"
)

func TestGetPlansReturnsSelfServeCatalog(t *testing.T) {
	rr := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/onboarding/plans", nil)

	(&Handler{}).GetPlans(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rr.Code)
	}

	var resp onboardingdto.OnboardingPlanCatalogResponse
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.DefaultPlanKey != "trial" {
		t.Fatalf("default_plan_key = %q, want trial", resp.DefaultPlanKey)
	}
	if resp.DefaultSeats != 5 {
		t.Fatalf("default_seats = %d, want 5", resp.DefaultSeats)
	}
	if len(resp.Plans) != 1 || resp.Plans[0].Key != "trial" {
		t.Fatalf("expected one trial plan, got %#v", resp.Plans)
	}
	if !hasProduct(resp.Products, "siem") || !hasProduct(resp.Products, "datastream") {
		t.Fatalf("expected siem and datastream products, got %#v", resp.Products)
	}
}

func hasProduct(products []onboardingdto.OnboardingProduct, id string) bool {
	for _, product := range products {
		if product.ID == id {
			return true
		}
	}
	return false
}
