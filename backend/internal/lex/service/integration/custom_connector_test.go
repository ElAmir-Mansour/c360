package integration

import (
	"net"
	"testing"
)

func TestAssertCustomURLAllowed_BlocksInternalAndMetadata(t *testing.T) {
	blocked := []string{
		"http://169.254.169.254/latest/meta-data/",         // AWS metadata
		"http://metadata.google.internal/computeMetadata/", // GCP metadata alias
		"http://127.0.0.1:8080/",                           // loopback
		"http://localhost/",                                // loopback name -> passes preflight (DNS), but...
		"http://10.0.0.5/",                                 // RFC1918
		"http://192.168.1.1/",                              // RFC1918
		"http://[::1]/",                                    // IPv6 loopback
		"ftp://example.com/",                               // bad scheme
		"http://100.64.0.1/",                               // CGNAT
	}
	for _, u := range blocked {
		err := assertCustomURLAllowed(u)
		// localhost resolves via DNS in the dialer guard, not the preflight; the
		// preflight only blocks literal IPs + metadata aliases + bad schemes. So
		// "http://localhost/" passes the preflight here (the DialContext guard catches
		// it at dial time). Assert everything EXCEPT the localhost name is blocked.
		if u == "http://localhost/" {
			continue
		}
		if err == nil {
			t.Errorf("expected %q to be blocked, got nil", u)
		}
	}
}

func TestAssertCustomURLAllowed_AllowsPublic(t *testing.T) {
	for _, u := range []string{"https://api.example.com/v1/users", "http://93.184.216.34/"} {
		if err := assertCustomURLAllowed(u); err != nil {
			t.Errorf("expected %q to be allowed, got %v", u, err)
		}
	}
}

func TestIsBlockedIP(t *testing.T) {
	cases := map[string]bool{
		"169.254.169.254": true,
		"127.0.0.1":       true,
		"10.1.2.3":        true,
		"172.16.0.1":      true,
		"192.168.0.1":     true,
		"100.64.1.1":      true,
		"::1":             true,
		"8.8.8.8":         false,
		"93.184.216.34":   false,
	}
	for ipStr, want := range cases {
		ip := net.ParseIP(ipStr)
		if got := isBlockedIP(ip); got != want {
			t.Errorf("isBlockedIP(%s) = %v, want %v", ipStr, got, want)
		}
	}
}

func TestParseCustomSpec_RequiresBaseURL(t *testing.T) {
	if _, err := parseCustomSpec(map[string]any{}); err == nil {
		t.Fatal("expected error for missing base_url")
	}
	if _, err := parseCustomSpec(map[string]any{"base_url": "http://10.0.0.1/"}); err == nil {
		t.Fatal("expected SSRF block for internal base_url")
	}
	spec, err := parseCustomSpec(map[string]any{
		"base_url":              "https://api.example.com",
		"auth_type":             "bearer",
		"request_path":          "/users",
		"response_records_path": "data.items",
	})
	if err != nil {
		t.Fatalf("valid spec rejected: %v", err)
	}
	if spec.Auth.Type != "bearer" || spec.Request.Path != "/users" || spec.Mapping.RecordsPath != "data.items" {
		t.Fatalf("spec parsed wrong: %+v", spec)
	}
}

func TestCustomSpec_MapResponse(t *testing.T) {
	spec := customSpec{
		Mapping: customMapping{
			RecordsPath: "data.items",
			FieldMap:    map[string]string{"external_id": "id", "display_name": "name"},
		},
	}
	body := []byte(`{"data":{"items":[{"id":"1","name":"Alice"},{"id":"2","name":"Bob"}]}}`)
	records, _ := spec.mapResponse(body)
	if len(records) != 2 {
		t.Fatalf("expected 2 mapped records, got %d", len(records))
	}
	if records[0]["external_id"] != "1" || records[0]["display_name"] != "Alice" {
		t.Fatalf("field map mismatch: %v", records[0])
	}
}

func TestCustomSpec_MapResponse_TopLevelArray(t *testing.T) {
	spec := customSpec{Mapping: customMapping{RecordsPath: ""}}
	body := []byte(`[{"id":"1"},{"id":"2"}]`)
	records, _ := spec.mapResponse(body)
	if len(records) != 2 {
		t.Fatalf("expected 2 records from top-level array, got %d", len(records))
	}
}

func TestMassChangeThresholdPct(t *testing.T) {
	if got := MassChangeThresholdPct(nil); got != DefaultMassChangeThresholdPct {
		t.Fatalf("nil config: want default %v got %v", DefaultMassChangeThresholdPct, got)
	}
	if got := MassChangeThresholdPct(map[string]any{MassChangeThresholdKey: float64(30)}); got != 30 {
		t.Fatalf("explicit 30: got %v", got)
	}
	if got := MassChangeThresholdPct(map[string]any{MassChangeThresholdKey: "15"}); got != 15 {
		t.Fatalf("string 15: got %v", got)
	}
	// Explicit 0 disables the guard (huge threshold).
	if got := MassChangeThresholdPct(map[string]any{MassChangeThresholdKey: float64(0)}); got < 1000 {
		t.Fatalf("explicit 0 should disable guard (huge threshold), got %v", got)
	}
}

func TestReportDeactivations(t *testing.T) {
	if reportDeactivations(SyncReport{}) != 0 {
		t.Fatal("empty report should report 0 deactivations")
	}
	r := SyncReport{Metadata: map[string]any{SyncReportDeactivatedKey: 7}}
	if reportDeactivations(r) != 7 {
		t.Fatalf("want 7 deactivations, got %d", reportDeactivations(r))
	}
	rf := SyncReport{Metadata: map[string]any{SyncReportDeactivatedKey: float64(5)}}
	if reportDeactivations(rf) != 5 {
		t.Fatalf("want 5 (float) deactivations, got %d", reportDeactivations(rf))
	}
}

func TestSplitConflictDetail(t *testing.T) {
	field, src, lex := splitConflictDetail(ReconItem{Detail: "field=email source=a@b.c lex=x@y.z"})
	if field != "email" || src != "a@b.c" || lex != "x@y.z" {
		t.Fatalf("structured split mismatch: field=%q source=%q lex=%q", field, src, lex)
	}
	// Unstructured detail becomes the field-less note.
	field2, _, _ := splitConflictDetail(ReconItem{Detail: "some freeform divergence"})
	if field2 != "some freeform divergence" {
		t.Fatalf("freeform split mismatch: %q", field2)
	}
}
