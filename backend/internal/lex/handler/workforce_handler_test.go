package handler

import (
	"net/http/httptest"
	"testing"
)

func TestWorkforceSupportDomainUsesExistingPermissionMasking(t *testing.T) {
	request := httptest.NewRequest("GET", "/api/v1/lex/reports/workforce", nil)

	if forbidden := workforceForbiddenDomains(request, []string{"legal-officer"}); forbidden["support"] {
		t.Fatal("support domain is forbidden for legal-officer, which has lex:support:view")
	}
	if forbidden := workforceForbiddenDomains(request, []string{"legal-requester"}); forbidden["support"] {
		t.Fatal("support domain is forbidden for legal-requester, which has support create/track access")
	}
	if forbidden := workforceForbiddenDomains(request, []string{"legal-dept-manager"}); !forbidden["support"] {
		t.Fatal("support domain is visible without lex:support:view")
	}
}
