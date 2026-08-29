package integration

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

// recordingEgressAudit captures EmitEgressBlocked calls so a test can assert the
// deny was audited with field NAMES + region only (never values).
type recordingEgressAudit struct {
	calls []egressAuditCall
}

type egressAuditCall struct {
	tenantID uuid.UUID
	region   string
	fields   []string
	reason   string
}

func (r *recordingEgressAudit) EmitEgressBlocked(_ context.Context, tenantID uuid.UUID, _ model.IntegrationEndpoint, region string, fields []string, reason string) {
	r.calls = append(r.calls, egressAuditCall{tenantID: tenantID, region: region, fields: fields, reason: reason})
}

func endpointWithEgress(regions, fields []string) model.IntegrationEndpoint {
	cfg := map[string]any{}
	if regions != nil {
		cfg[AllowedRegionsKey] = toAnySlice(regions)
	}
	if fields != nil {
		cfg[AllowedEgressFieldsKey] = toAnySlice(fields)
	}
	return model.IntegrationEndpoint{ID: uuid.New(), TenantID: uuid.New(), Kind: model.IntegrationKindHR, Config: cfg}
}

func toAnySlice(s []string) []any {
	out := make([]any, len(s))
	for i, v := range s {
		out[i] = v
	}
	return out
}

// TestEgressUnconstrainedAllows: an endpoint with no policy never denies.
func TestEgressUnconstrainedAllows(t *testing.T) {
	enf := NewEgressEnforcer(nil)
	ep := endpointWithEgress(nil, nil)
	if err := enf.Check(context.Background(), ep, []string{"national_id", "anything"}, "us"); err != nil {
		t.Fatalf("unconstrained policy denied egress: %v", err)
	}
}

// TestEgressRegionDenied: a foreign region is DENIED + AUDITED when allowed_regions
// constrains to in-Kingdom only. This is the PDPL data-residency fail-closed path.
func TestEgressRegionDenied(t *testing.T) {
	audit := &recordingEgressAudit{}
	enf := NewEgressEnforcer(audit)
	ep := endpointWithEgress([]string{"sa"}, nil)

	err := enf.Check(context.Background(), ep, nil, "us")
	if err == nil {
		t.Fatal("egress to a non-allowed region should be denied")
	}
	var de *EgressDeniedError
	if !errors.As(err, &de) {
		t.Fatalf("error = %T, want *EgressDeniedError", err)
	}
	if de.Region != "us" {
		t.Fatalf("denied region = %q, want us", de.Region)
	}
	if len(audit.calls) != 1 {
		t.Fatalf("audit calls = %d, want 1 (deny must be audited)", len(audit.calls))
	}
	if audit.calls[0].tenantID != ep.TenantID {
		t.Fatalf("audit tenant = %s, want %s", audit.calls[0].tenantID, ep.TenantID)
	}

	// In-Kingdom region (case-insensitive) passes the same policy.
	if err := enf.Check(context.Background(), ep, nil, "SA"); err != nil {
		t.Fatalf("in-Kingdom region SA denied: %v", err)
	}
}

// TestEgressFieldDenied: a field outside the allow-list is DENIED + AUDITED, and the
// audit carries only the offending field NAME (data-minimisation, no value).
func TestEgressFieldDenied(t *testing.T) {
	audit := &recordingEgressAudit{}
	enf := NewEgressEnforcer(audit)
	ep := endpointWithEgress(nil, []string{"case_number", "national_id"})

	err := enf.Check(context.Background(), ep, []string{"case_number", "salary", "diagnosis"}, "")
	if err == nil {
		t.Fatal("egress of a non-allow-listed field should be denied")
	}
	var de *EgressDeniedError
	if !errors.As(err, &de) {
		t.Fatalf("error = %T, want *EgressDeniedError", err)
	}
	// DisallowedFields sorts; the two bad fields are diagnosis + salary.
	if len(de.Fields) != 2 || de.Fields[0] != "diagnosis" || de.Fields[1] != "salary" {
		t.Fatalf("denied fields = %v, want [diagnosis salary]", de.Fields)
	}
	if len(audit.calls) != 1 || len(audit.calls[0].fields) != 2 {
		t.Fatalf("audit must record the 2 blocked field names, got %+v", audit.calls)
	}
	// Allow-listed fields only ⇒ allowed.
	if err := enf.Check(context.Background(), ep, []string{"case_number"}, ""); err != nil {
		t.Fatalf("allow-listed field denied: %v", err)
	}
}

// TestEgressNilAuditStillDenies: a nil audit emitter must not prevent the deny
// (the policy fails closed even when audit is unwired).
func TestEgressNilAuditStillDenies(t *testing.T) {
	enf := NewEgressEnforcer(nil)
	ep := endpointWithEgress([]string{"sa"}, nil)
	if err := enf.Check(context.Background(), ep, nil, "eu"); err == nil {
		t.Fatal("deny must still occur with a nil audit emitter")
	}
}

// TestEgressPolicyFromConfigParsesEncodings: the policy tolerates []any / []string /
// comma-string config encodings and lower-cases + trims values.
func TestEgressPolicyFromConfigParsesEncodings(t *testing.T) {
	ep := model.IntegrationEndpoint{Config: map[string]any{
		AllowedRegionsKey:      "SA, EU ",
		AllowedEgressFieldsKey: []string{" National_ID ", "case_number"},
	}}
	p := EgressPolicyFromConfig(ep)
	if len(p.AllowedRegions) != 2 || p.AllowedRegions[0] != "sa" || p.AllowedRegions[1] != "eu" {
		t.Fatalf("regions = %v, want [sa eu]", p.AllowedRegions)
	}
	if len(p.AllowedEgressFields) != 2 || p.AllowedEgressFields[0] != "national_id" {
		t.Fatalf("fields = %v, want lower-cased trimmed", p.AllowedEgressFields)
	}
	if !p.RegionAllowed("eu") || p.RegionAllowed("us") {
		t.Fatalf("RegionAllowed misbehaving: eu=%v us=%v", p.RegionAllowed("eu"), p.RegionAllowed("us"))
	}
}
