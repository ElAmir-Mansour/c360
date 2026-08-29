package handler

import "testing"

func TestProtectedFileListPrivileged(t *testing.T) {
	for _, tc := range []struct {
		name  string
		roles []string
		want  bool
	}{
		{name: "lex service proxy", roles: []string{"service"}, want: true},
		{name: "case insensitive service", roles: []string{" Service "}, want: true},
		{name: "tenant admin remains owner scoped", roles: []string{"tenant-admin"}, want: false},
		{name: "platform admin remains owner scoped", roles: []string{"super-admin"}, want: false},
		{name: "legal director uses lex proxy", roles: []string{"legal-director"}, want: false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := protectedFileListPrivileged(tc.roles); got != tc.want {
				t.Fatalf("protectedFileListPrivileged() = %v, want %v", got, tc.want)
			}
		})
	}
}
