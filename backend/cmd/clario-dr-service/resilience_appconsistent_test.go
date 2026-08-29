package main

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/dr/appconsistent"
)

func TestSourceMarkerAtOrAfter_PostgresLSNNumericCompare(t *testing.T) {
	tests := []struct {
		current string
		target  string
		want    bool
	}{
		{current: "0/10", target: "0/F", want: true},
		{current: "0/F", target: "0/10", want: false},
		{current: "1/0", target: "0/FFFFFFFF", want: true},
		{current: "marker-b", target: "marker-a", want: true},
		{current: "", target: "0/1", want: false},
	}
	for _, tc := range tests {
		t.Run(tc.current+">="+tc.target, func(t *testing.T) {
			if got := sourceMarkerAtOrAfter(tc.current, tc.target); got != tc.want {
				t.Fatalf("sourceMarkerAtOrAfter(%q,%q) = %v, want %v", tc.current, tc.target, got, tc.want)
			}
		})
	}
}

func TestDRGroupMarkerFencerRequiresQuiesceMarker(t *testing.T) {
	_, err := (drGroupMarkerFencer{}).Fence(context.Background(), uuid.New(), uuid.New(), appconsistent.QuiesceResult{})
	if err == nil || !strings.Contains(err.Error(), "marker_lsn") {
		t.Fatalf("err = %v, want missing marker_lsn error", err)
	}
}
