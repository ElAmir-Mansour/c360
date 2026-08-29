package repository

import (
	"strings"
	"testing"
)

func TestMatterWorkforceAttributionProjectsClosedAt(t *testing.T) {
	query := workforceAttributionSQL["matters"]
	if !strings.Contains(query, "THEN closed_at END AS closed_at") {
		t.Fatal("matters workforce attribution must name its terminal timestamp closed_at")
	}
}
