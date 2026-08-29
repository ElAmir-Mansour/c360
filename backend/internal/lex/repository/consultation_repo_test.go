package repository

import (
	"regexp"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/lex/model"
)

var placeholderRe = regexp.MustCompile(`\$(\d+)`)

// assertPlaceholdersCoverArgs verifies every $N placeholder in the WHERE clause has
// a corresponding positional arg and that no arg index exceeds len(args). This is
// the safety net for the hand-built parameter indexing in consultationFilterClauses.
func assertPlaceholdersCoverArgs(t *testing.T, where string, args []any) {
	t.Helper()
	matches := placeholderRe.FindAllStringSubmatch(where, -1)
	for _, m := range matches {
		idx, err := strconv.Atoi(m[1])
		if err != nil {
			t.Fatalf("bad placeholder %q: %v", m[0], err)
		}
		if idx < 1 || idx > len(args) {
			t.Fatalf("placeholder $%d out of range (have %d args) in WHERE: %s", idx, len(args), where)
		}
	}
}

func TestConsultationFilterClausesBaseline(t *testing.T) {
	tenantID := uuid.New()
	where, args, next := consultationFilterClauses(tenantID, model.ConsultationListFilters{}, time.Now())
	if len(args) != 1 || args[0] != tenantID {
		t.Fatalf("baseline args = %v, want [tenantID]", args)
	}
	if next != 2 {
		t.Fatalf("baseline next arg = %d, want 2", next)
	}
	if where == "" {
		t.Fatal("baseline WHERE should not be empty")
	}
	assertPlaceholdersCoverArgs(t, where, args)
}

func TestConsultationFilterClausesAllFilters(t *testing.T) {
	tenantID := uuid.New()
	requester := uuid.New()
	advisor := uuid.New()
	legalReq := uuid.New()
	status := model.ConsultationStatusRouted
	cType := model.ConsultationTypeLabor
	priority := model.LegalPriorityHigh
	from := time.Now().Add(-48 * time.Hour)
	to := time.Now()

	for _, risk := range []string{"", "breached", "due_soon", "on_track"} {
		t.Run("risk="+risk, func(t *testing.T) {
			filters := model.ConsultationListFilters{
				Search:          "merger",
				Status:          &status,
				Type:            &cType,
				Priority:        &priority,
				RequesterUserID: &requester,
				AdvisorID:       &advisor,
				LegalRequestID:  &legalReq,
				Department:      "legal",
				Tag:             "urgent",
				CreatedFrom:     &from,
				CreatedTo:       &to,
				RespondedFrom:   &from,
				RespondedTo:     &to,
				SLARisk:         risk,
			}
			where, args, next := consultationFilterClauses(tenantID, filters, time.Now())
			assertPlaceholdersCoverArgs(t, where, args)
			if next != len(args)+1 {
				t.Fatalf("next arg = %d, want len(args)+1 = %d", next, len(args)+1)
			}
		})
	}
}

func TestValidConsultationSLARisk(t *testing.T) {
	valid := []string{"breached", "due_soon", "on_track"}
	for _, v := range valid {
		if !model.ValidConsultationSLARisk(v) {
			t.Fatalf("ValidConsultationSLARisk(%q) = false, want true", v)
		}
	}
	for _, v := range []string{"", "BREACHED", "soon", "overdue"} {
		if model.ValidConsultationSLARisk(v) {
			t.Fatalf("ValidConsultationSLARisk(%q) = true, want false", v)
		}
	}
}
