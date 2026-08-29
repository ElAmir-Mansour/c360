package service

import "testing"

func TestIsAcceptableScanStatusFailsClosed(t *testing.T) {
	tests := []struct {
		status string
		want   bool
	}{
		{status: "clean", want: true},
		{status: " CLEAN ", want: true},
		{status: "skipped", want: false},
		{status: "pending", want: false},
		{status: "error", want: false},
		{status: "infected", want: false},
		{status: "", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.status, func(t *testing.T) {
			if got := isAcceptableScanStatus(tt.status); got != tt.want {
				t.Fatalf("isAcceptableScanStatus(%q) = %v, want %v", tt.status, got, tt.want)
			}
		})
	}
}
