package main

import (
	"slices"
	"testing"
)

func TestWatheeqContractsManagerAccountIsLeastPrivileged(t *testing.T) {
	const email = "contractmanager@alothaim.com"

	index := slices.IndexFunc(watheeqDemoAccounts, func(account watheeqDemoAccount) bool {
		return account.Email == email
	})
	if index < 0 {
		t.Fatalf("Watheeq demo account %q is not seeded", email)
	}

	account := watheeqDemoAccounts[index]
	if got, want := account.ID, alothaimContractsManagerUserID; got != want {
		t.Fatalf("account id = %s, want %s", got, want)
	}
	if !slices.Equal(account.RoleSlugs, []string{"legal-contracts-manager"}) {
		t.Fatalf("account roles = %v, want only legal-contracts-manager", account.RoleSlugs)
	}
}

func TestWatheeqWalkthroughAccountsMatchPublishedCredentialsAndRoles(t *testing.T) {
	want := map[string]struct {
		id   string
		role string
	}{
		"business@alothaim.com":          {id: alothaimBusinessUserID.String(), role: "legal-requester"},
		"director@alothaim.com":          {id: alothaimDirectorUserID.String(), role: "legal-director"},
		"casesmanager@alothaim.com":      {id: alothaimCasesManagerUserID.String(), role: "legal-cases-manager"},
		"contractssmanager@alothaim.com": {id: alothaimDemoContractsUserID.String(), role: "legal-contracts-manager"},
	}

	for email, expected := range want {
		index := slices.IndexFunc(watheeqDemoAccounts, func(account watheeqDemoAccount) bool {
			return account.Email == email
		})
		if index < 0 {
			t.Fatalf("walkthrough account %q is not seeded", email)
		}
		account := watheeqDemoAccounts[index]
		if account.ID.String() != expected.id {
			t.Errorf("%s id = %s, want %s", email, account.ID, expected.id)
		}
		if account.Password != watheeqDemoPassword {
			t.Errorf("%s password contract does not match the walkthrough", email)
		}
		if !slices.Equal(account.RoleSlugs, []string{expected.role}) {
			t.Errorf("%s roles = %v, want only %s", email, account.RoleSlugs, expected.role)
		}
	}
}

func TestWatheeqDemoAccountsHaveLexOrgAssignments(t *testing.T) {
	want := map[string]struct {
		entity string
		role   string
	}{
		"director@almashura.demo":        {entity: "LEGAL", role: "legal_director"},
		"contractmanager@alothaim.com":   {entity: "CONTRACTS", role: "contracts_manager"},
		"director@alothaim.com":          {entity: "LEGAL", role: "legal_director"},
		"casesmanager@alothaim.com":      {entity: "CASES", role: "department_manager"},
		"contractssmanager@alothaim.com": {entity: "CONTRACTS", role: "contracts_manager"},
	}

	for email, expected := range want {
		index := slices.IndexFunc(watheeqLexOrgAssignments, func(assignment watheeqLexOrgAssignment) bool {
			return assignment.Email == email
		})
		if index < 0 {
			t.Fatalf("Watheeq Lex org assignment %q is not seeded", email)
		}
		assignment := watheeqLexOrgAssignments[index]
		if assignment.EntityCode != expected.entity || assignment.RoleKey != expected.role {
			t.Fatalf("assignment %q = %s/%s, want %s/%s", email,
				assignment.EntityCode, assignment.RoleKey, expected.entity, expected.role)
		}
	}
}
