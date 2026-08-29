package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/auth"
)

// withClaims attaches JWT claims to the request context exactly as ProxyAuth
// would after validating a token.
func withClaims(r *http.Request, claims *auth.Claims) *http.Request {
	return r.WithContext(auth.WithClaims(r.Context(), claims))
}

// TestProxyReadonly_MethodMatrix exercises the full method matrix across the
// three claim states: a read-only session, a writable session, and no claims.
func TestProxyReadonly_MethodMatrix(t *testing.T) {
	safeMethods := []string{http.MethodGet, http.MethodHead, http.MethodOptions}
	mutatingMethods := []string{http.MethodPost, http.MethodPut, http.MethodPatch, http.MethodDelete}

	cases := []struct {
		name    string
		claims  *auth.Claims // nil means no claims in context
		methods []string
		wantOK  bool // true => passes to next; false => 403 READONLY_SESSION
	}{
		{
			name:    "readonly safe methods pass through",
			claims:  &auth.Claims{UserID: "u-1", TenantID: "t-1", Readonly: true},
			methods: safeMethods,
			wantOK:  true,
		},
		{
			name:    "readonly mutating methods rejected",
			claims:  &auth.Claims{UserID: "u-1", TenantID: "t-1", Readonly: true, ImpersonatedBy: "admin-1"},
			methods: mutatingMethods,
			wantOK:  false,
		},
		{
			name:    "writable session mutating methods pass",
			claims:  &auth.Claims{UserID: "u-1", TenantID: "t-1", Readonly: false},
			methods: mutatingMethods,
			wantOK:  true,
		},
		{
			name:    "writable session safe methods pass",
			claims:  &auth.Claims{UserID: "u-1", TenantID: "t-1", Readonly: false},
			methods: safeMethods,
			wantOK:  true,
		},
		{
			name:    "no claims mutating methods pass",
			claims:  nil,
			methods: mutatingMethods,
			wantOK:  true,
		},
		{
			name:    "no claims safe methods pass",
			claims:  nil,
			methods: safeMethods,
			wantOK:  true,
		},
	}

	for _, tc := range cases {
		for _, method := range tc.methods {
			t.Run(tc.name+"/"+method, func(t *testing.T) {
				var reached bool
				h := ProxyReadonly(zerolog.Nop())(nextRecorder(&reached))

				req := httptest.NewRequest(method, "/api/v1/lex/contracts", nil)
				if tc.claims != nil {
					req = withClaims(req, tc.claims)
				}
				rr := httptest.NewRecorder()
				h.ServeHTTP(rr, req)

				if tc.wantOK {
					if !reached {
						t.Fatalf("%s %s: expected request to reach backend", method, tc.name)
					}
					if rr.Code != http.StatusOK {
						t.Fatalf("%s %s: status = %d, want 200", method, tc.name, rr.Code)
					}
					return
				}

				// Expect a hard rejection.
				if reached {
					t.Fatalf("%s %s: read-only mutating request must NOT reach backend", method, tc.name)
				}
				if rr.Code != http.StatusForbidden {
					t.Fatalf("%s %s: status = %d, want 403", method, tc.name, rr.Code)
				}
				assertErrorCode(t, rr.Body.Bytes(), "READONLY_SESSION")
			})
		}
	}
}

// TestIsSafeMethod documents the safe-method classification directly.
func TestIsSafeMethod(t *testing.T) {
	cases := map[string]bool{
		http.MethodGet:     true,
		http.MethodHead:    true,
		http.MethodOptions: true,
		http.MethodPost:    false,
		http.MethodPut:     false,
		http.MethodPatch:   false,
		http.MethodDelete:  false,
		http.MethodConnect: false,
		http.MethodTrace:   false,
	}
	for method, want := range cases {
		if got := isSafeMethod(method); got != want {
			t.Errorf("isSafeMethod(%q) = %v, want %v", method, got, want)
		}
	}
}
