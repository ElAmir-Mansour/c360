package drsource

import (
	"fmt"
	"strings"
)

// severityEmoji mirrors the legacy slack message_builder palette so DR messages
// look consistent with the rest of the platform's Slack output.
func (s Severity) Emoji() string {
	switch s {
	case SeverityCritical:
		return "🔴"
	case SeverityHigh:
		return "🟠"
	case SeverityMedium:
		return "🟡"
	case SeverityInfo:
		return "🔵"
	default:
		return "⚪"
	}
}

// title-cases the severity for headlines ("critical" -> "Critical").
func (s Severity) Display() string {
	str := string(s)
	if str == "" {
		return "Info"
	}
	return strings.ToUpper(str[:1]) + str[1:]
}

// ToSlackBlocks renders the Notification as a Slack Block Kit "blocks" array
// (the exact []map[string]any shape the existing slack client posts). It builds:
//
//   - a header block: "<emoji> <Severity> DR Alert: <Title>"
//   - a section block of mrkdwn field pairs (two columns via Slack "fields")
//   - a section block with the summary
//   - a context block with the event type and time
//   - an optional actions block with a deep link when appURL is non-empty
//
// The structure matches slack.headerBlock / slack.sectionBlock so the message
// validates against Block Kit and renders identically to native platform alerts.
func (n Notification) ToSlackBlocks(appURL string) []map[string]any {
	header := fmt.Sprintf("%s %s DR Alert: %s", n.Severity.Emoji(), n.Severity.Display(), n.Title)
	blocks := []map[string]any{
		slackHeaderBlock(header),
	}

	if len(n.Fields) > 0 {
		// Slack section "fields" render as a responsive two-column grid; cap at
		// 10 (Block Kit's per-section limit) and spill the rest into a second
		// section so no field is silently dropped.
		const maxPerSection = 10
		for start := 0; start < len(n.Fields); start += maxPerSection {
			end := start + maxPerSection
			if end > len(n.Fields) {
				end = len(n.Fields)
			}
			fields := make([]map[string]any, 0, end-start)
			for _, f := range n.Fields[start:end] {
				fields = append(fields, map[string]any{
					"type": "mrkdwn",
					"text": fmt.Sprintf("*%s:*\n%s", f.Label, f.Value),
				})
			}
			blocks = append(blocks, map[string]any{"type": "section", "fields": fields})
		}
	}

	if n.Summary != "" {
		blocks = append(blocks, slackSectionBlock("*Summary:* "+truncate(n.Summary, 2000)))
	}

	ctx := fmt.Sprintf("`%s` • %s", n.EventType, n.OccurredAt.UTC().Format("2006-01-02 15:04:05 UTC"))
	blocks = append(blocks, slackContextBlock(ctx))

	if url := drDeepLink(appURL, n.Subject); url != "" {
		blocks = append(blocks, map[string]any{
			"type": "actions",
			"elements": []map[string]any{
				{
					"type": "button",
					"text": map[string]any{"type": "plain_text", "text": "View in Clario 360"},
					"url":  url,
				},
			},
		})
	}
	return blocks
}

// ToTeamsCard renders the Notification as a Microsoft Teams Adaptive Card
// (version 1.5), the exact map[string]any shape the existing teams client posts.
// It uses a coloured title TextBlock, a subtle severity subtitle, a FactSet of
// the fields, a wrapped summary, and an Action.OpenUrl deep link.
func (n Notification) ToTeamsCard(appURL string) map[string]any {
	body := []map[string]any{
		{
			"type":   "TextBlock",
			"size":   "Large",
			"weight": "Bolder",
			"text":   n.Title,
			"wrap":   true,
			"color":  teamsColor(n.Severity),
		},
		{
			"type":     "TextBlock",
			"text":     fmt.Sprintf("%s severity • %s", n.Severity.Display(), n.EventType),
			"isSubtle": true,
			"wrap":     true,
			"spacing":  "None",
		},
	}

	if len(n.Fields) > 0 {
		facts := make([]map[string]any, 0, len(n.Fields))
		for _, f := range n.Fields {
			facts = append(facts, map[string]any{"title": f.Label, "value": f.Value})
		}
		body = append(body, map[string]any{"type": "FactSet", "facts": facts})
	}

	if n.Summary != "" {
		body = append(body, map[string]any{
			"type":    "TextBlock",
			"text":    n.Summary,
			"wrap":    true,
			"spacing": "Medium",
		})
	}

	body = append(body, map[string]any{
		"type":     "TextBlock",
		"text":     n.OccurredAt.UTC().Format("2006-01-02 15:04:05 UTC"),
		"isSubtle": true,
		"wrap":     true,
		"spacing":  "Small",
	})

	card := map[string]any{
		"type":    "AdaptiveCard",
		"version": "1.5",
		"body":    body,
		"$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
	}
	if url := drDeepLink(appURL, n.Subject); url != "" {
		card["actions"] = []map[string]any{
			{"type": "Action.OpenUrl", "title": "View in Clario 360", "url": url},
		}
	}
	return card
}

// GenericPayload is the connector-neutral rendering consumed by the email,
// PagerDuty and generic REST/webhook connectors. It carries the headline, a
// machine severity, the summary, an ordered field map AND the field slice (so a
// connector can choose ordered or keyed access), plus an optional deep link.
type GenericPayload struct {
	EventType  string            `json:"event_type"`
	Title      string            `json:"title"`
	Severity   string            `json:"severity"`
	Summary    string            `json:"summary"`
	Subject    string            `json:"subject,omitempty"`
	TenantID   string            `json:"tenant_id,omitempty"`
	OccurredAt string            `json:"occurred_at"`
	URL        string            `json:"url,omitempty"`
	Fields     []Field           `json:"fields"`
	FieldMap   map[string]string `json:"field_map"`
}

// ToGenericMap renders the Notification as a GenericPayload (title + fields)
// consumed by the email / PagerDuty / REST connectors. The FieldMap preserves
// the label->value pairs for templated bodies; the Fields slice preserves order.
// PagerDuty's severity vocabulary (critical/error/warning/info) is mapped from
// the canonical ladder via PagerDutySeverity.
func (n Notification) ToGenericMap(appURL string) GenericPayload {
	fm := make(map[string]string, len(n.Fields))
	for _, f := range n.Fields {
		fm[f.Label] = f.Value
	}
	return GenericPayload{
		EventType:  n.EventType,
		Title:      n.Title,
		Severity:   string(n.Severity),
		Summary:    n.Summary,
		Subject:    n.Subject,
		TenantID:   n.TenantID,
		OccurredAt: n.OccurredAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		URL:        drDeepLink(appURL, n.Subject),
		Fields:     n.Fields,
		FieldMap:   fm,
	}
}

// PagerDutySeverity maps the canonical ladder onto PagerDuty Events API v2's
// severity vocabulary (critical / error / warning / info).
func (n Notification) PagerDutySeverity() string {
	switch n.Severity {
	case SeverityCritical:
		return "critical"
	case SeverityHigh:
		return "error"
	case SeverityMedium:
		return "warning"
	default:
		return "info"
	}
}

// PlainText renders the Notification as a plain-text block (subject line +
// fields), suitable for an email body fallback or an SMS-style connector. The
// first line is the title; subsequent lines are "Label: Value".
func (n Notification) PlainText() string {
	var b strings.Builder
	b.WriteString(fmt.Sprintf("[%s] %s\n", n.Severity.Display(), n.Title))
	if n.Summary != "" {
		b.WriteString(n.Summary)
		b.WriteString("\n")
	}
	for _, f := range n.Fields {
		b.WriteString(fmt.Sprintf("%s: %s\n", f.Label, f.Value))
	}
	b.WriteString(fmt.Sprintf("Event: %s\nTime: %s\n", n.EventType, n.OccurredAt.UTC().Format("2006-01-02 15:04:05 UTC")))
	return b.String()
}

// EmailSubject renders a concise email subject line for the notification.
func (n Notification) EmailSubject() string {
	return fmt.Sprintf("[Clario DR][%s] %s", n.Severity.Display(), n.Title)
}

// --- Slack/Teams block helpers (mirror the legacy builders) --------------

func slackHeaderBlock(text string) map[string]any {
	return map[string]any{
		"type": "header",
		"text": map[string]any{"type": "plain_text", "text": truncate(text, 150)},
	}
}

func slackSectionBlock(text string) map[string]any {
	return map[string]any{
		"type": "section",
		"text": map[string]any{"type": "mrkdwn", "text": text},
	}
}

func slackContextBlock(text string) map[string]any {
	return map[string]any{
		"type":     "context",
		"elements": []map[string]any{{"type": "mrkdwn", "text": text}},
	}
}

// teamsColor maps severity to an Adaptive Card text colour token.
func teamsColor(s Severity) string {
	switch s {
	case SeverityCritical, SeverityHigh:
		return "Attention"
	case SeverityMedium:
		return "Warning"
	default:
		return "Default"
	}
}

// drDeepLink builds a deep link into the DR console for the subject, or "" when
// no app URL is configured.
func drDeepLink(appURL, subject string) string {
	base := strings.TrimRight(strings.TrimSpace(appURL), "/")
	if base == "" {
		return ""
	}
	if subject == "" {
		return base + "/dr"
	}
	return base + "/dr/streams/" + subject
}

// truncate caps a string to max runes-ish (byte length), appending an ellipsis.
func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	if max <= 1 {
		return s[:max]
	}
	return s[:max-1] + "…"
}
