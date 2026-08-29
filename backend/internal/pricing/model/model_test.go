package model

import (
	"encoding/json"
	"reflect"
	"testing"
)

// seedPayloadV1 is the EXACT JSONB string seeded by migration
// 000010_seed_pricing_config.up.sql. This test guards against silent drift
// between the compiled-in DefaultConfig() (which the golden-vector engine tests
// assert against) and the value a fresh database actually gets seeded with.
const seedPayloadV1 = `{"fx_usd_to_sar":3.75,"vat_rate":0.15,"markup_multiplier":1.3,"sales_discount_default":0,"annual_commit_discount":0.1,"annual_commit_min_months":12,"min_margin_floor":0.1,"tier_resource_factor":{"standard":1,"growth":1.15,"professional":1.35,"customized":1.6},"ai_cost_per_1m_tokens":3,"ai_allowance_millions":{"standard":2,"growth":5,"professional":10},"ai_dedicated_cost":500,"storage_hot_usd_per_gb":5,"storage_cold_usd_per_gb":1,"storage_volume_factor_saas":0.8,"storage_volume_factor_local":0.5,"deployment_setup_flat":500,"airgap_high_security_multiplier":1.4,"per_user":{"compute":4,"licensing":3,"support":2.5,"security":1.5,"overhead":2},"per_core":{"compute":20,"licensing":8,"support":6,"security":4,"overhead":2,"cost_per_vm":100},"volume_breakpoints":[{"min_units":0,"discount":0},{"min_units":25,"discount":0.05},{"min_units":100,"discount":0.1},{"min_units":250,"discount":0.15}]}`

func TestSeedPayloadMatchesDefaultConfig(t *testing.T) {
	var got PricingRates
	if err := json.Unmarshal([]byte(seedPayloadV1), &got); err != nil {
		t.Fatalf("seed payload must unmarshal into PricingRates: %v", err)
	}
	if !reflect.DeepEqual(got, DefaultConfig()) {
		t.Errorf("seed payload drifted from DefaultConfig()\n got: %+v\nwant: %+v", got, DefaultConfig())
	}
}

// TestDefaultConfigMarshalStable proves DefaultConfig() serializes to the exact
// bytes the migration embeds, so regenerating the seed is deterministic.
func TestDefaultConfigMarshalStable(t *testing.T) {
	b, err := json.Marshal(DefaultConfig())
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if string(b) != seedPayloadV1 {
		t.Errorf("DefaultConfig() marshal drifted from seed payload\n got: %s\nwant: %s", b, seedPayloadV1)
	}
}

func TestBaseCost(t *testing.T) {
	r := DefaultConfig()
	if got := r.PerUser.BaseCost(); got != 13 {
		t.Errorf("per_user base cost: got %v, want 13", got)
	}
	if got := r.PerCore.BaseCost(); got != 40 {
		t.Errorf("per_core base cost: got %v, want 40", got)
	}
}

func TestClientTierHasNoInternalField(t *testing.T) {
	// Structural masking assertion: the ClientTier type must not expose any
	// margin/cost field. If someone adds one, this fails loudly.
	forbidden := map[string]bool{
		"InternalCost": true, "GrossProfit": true, "RealizedMargin": true,
		"Guardrail": true, "Internal": true,
	}
	tt := reflect.TypeOf(ClientTier{})
	for i := 0; i < tt.NumField(); i++ {
		if forbidden[tt.Field(i).Name] {
			t.Errorf("ClientTier must not carry internal field %q", tt.Field(i).Name)
		}
	}
}
