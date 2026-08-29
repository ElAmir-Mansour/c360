package service

import (
	"strings"

	"github.com/clario360/platform/internal/lex/model"
)

// CAP-010 — Urgent priority requires a documented, structured justification, and
// the justification may NOT rest solely on requester-side delay or poor planning
// ("I left it to the last minute"). The platform refuses to let avoidable
// internal tardiness be laundered into an urgent classification that jumps the
// SLA queue. This file is the single, documented home of that rule so the
// create path and the reclassify path enforce it identically.

// minUrgencyJustificationLength is the floor for a "structured" justification.
// A handful of characters cannot describe a genuine business/legal urgency.
const minUrgencyJustificationLength = 20

// requesterDelayPhrases are normalised substrings that, when they constitute the
// whole substance of a justification, indicate the urgency is driven by the
// requester's own delay or poor planning rather than an external/legal deadline.
// Matching is case-insensitive on the lower-cased justification. Both English
// and Arabic forms are listed because the suite is Arabic-first (CAP-172).
var requesterDelayPhrases = []string{
	// English
	"forgot",
	"forgot to",
	"last minute",
	"last-minute",
	"poor planning",
	"didn't plan",
	"did not plan",
	"i was late",
	"we were late",
	"my delay",
	"our delay",
	"ran out of time",
	"slipped my mind",
	"overlooked",
	"my fault",
	"my bad",
	"asap",
	// Arabic
	"نسيت",
	"تأخرت",
	"في اللحظة الأخيرة",
	"سوء التخطيط",
	"خطئي",
	"بأسرع وقت",
}

// validateUrgencyJustification enforces CAP-010 for a priority that is being set
// to (or kept at) "urgent". It returns a validation error when the justification
// is missing, too thin to be "structured", or its substance is only about
// requester delay/poor planning. For non-urgent priorities it is a no-op.
//
// field is the JSON field name the error should be attributed to so the create
// and reclassify handlers surface it on the right input.
func validateUrgencyJustification(priority model.RequestPriority, justification *string, field string) error {
	if priority != model.RequestPriorityUrgent {
		return nil
	}
	text := ""
	if justification != nil {
		text = strings.TrimSpace(*justification)
	}
	if text == "" {
		return validationError(
			"urgent priority requires a structured justification (CAP-010)",
			map[string]string{field: "required_for_urgent"},
		)
	}
	if len([]rune(text)) < minUrgencyJustificationLength {
		return validationError(
			"urgency justification is too brief to be a structured justification (CAP-010)",
			map[string]string{field: "too_brief"},
		)
	}
	if justificationIsRequesterDelay(text) {
		return validationError(
			"urgency justification cannot rest solely on requester delay or poor planning (CAP-010)",
			map[string]string{field: "requester_delay_not_allowed"},
		)
	}
	return nil
}

// justificationIsRequesterDelay reports whether the justification's substance,
// once the delay phrase(s) are removed, contains no remaining material reason —
// i.e. the urgency is driven only by requester-side delay/poor planning.
func justificationIsRequesterDelay(text string) bool {
	lowered := strings.ToLower(text)
	matched := false
	residue := lowered
	for _, phrase := range requesterDelayPhrases {
		if strings.Contains(residue, phrase) {
			matched = true
			residue = strings.ReplaceAll(residue, phrase, " ")
		}
	}
	if !matched {
		return false
	}
	// If, after stripping the delay phrases, fewer than two substantive words
	// remain, the justification was only about requester delay/poor planning.
	return substantiveWordCount(residue) < 2
}

// substantiveWordCount counts whitespace-delimited tokens of length >= 3,
// approximating the number of meaningful words remaining in a residue string.
func substantiveWordCount(text string) int {
	count := 0
	for _, token := range strings.Fields(text) {
		token = strings.Trim(token, ".,;:!?-—()[]\"'")
		if len([]rune(token)) >= 3 {
			count++
		}
	}
	return count
}
