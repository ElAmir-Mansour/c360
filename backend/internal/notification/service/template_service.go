package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	htmltemplate "html/template"
	"strings"
	texttemplate "text/template"
	"time"

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/notification/model"
)

// defaultTemplateTenantID mirrors repository.DefaultTemplateTenantID — the
// sentinel tenant under which platform-default templates are stored. Duplicated
// here (not imported) to avoid a service→repository dependency for a constant.
const defaultTemplateTenantID = "00000000-0000-0000-0000-000000000000"

// defaultRecipientLocale is the locale stamped onto a notification at enqueue
// time when neither the producer nor the recipient profile supplies one. Arabic
// is the KSA default: email is dispatched asynchronously (no request context at
// send), so the recipient's locale must be captured when the notification is
// created rather than inferred from the actor's request at send time.
const defaultRecipientLocale = "ar"

// TemplateStore loads DB-backed email templates (#18). Implemented by
// *repository.TemplateRepository; declared as an interface so the DB dependency
// is optional (nil store ⇒ embedded Go-const templates only) and unit-testable
// with a fake.
type TemplateStore interface {
	GetEmailTemplate(ctx context.Context, tenantID, templateID string) (*model.TemplateConfig, bool, error)
}

// TemplateSeeder inserts platform-default templates without clobbering operator
// customizations (ON CONFLICT DO NOTHING). Implemented by
// *repository.TemplateRepository.
type TemplateSeeder interface {
	SeedDefault(ctx context.Context, t *model.TemplateConfig) error
}

// TemplateFuncs provides common functions available in all notification templates.
var TemplateFuncs = texttemplate.FuncMap{
	"title": strings.Title,
	"upper": strings.ToUpper,
	"lower": strings.ToLower,
	"formatDate": func(v interface{}) string {
		switch t := v.(type) {
		case time.Time:
			return t.UTC().Format("Jan 02, 2006 at 15:04 UTC")
		case string:
			if parsed, err := time.Parse(time.RFC3339, t); err == nil {
				return parsed.UTC().Format("Jan 02, 2006 at 15:04 UTC")
			}
			return t
		default:
			return fmt.Sprintf("%v", v)
		}
	},
	"truncate": func(n int, s string) string {
		if len(s) <= n {
			return s
		}
		return s[:n] + "..."
	},
}

// HTMLTemplateFuncs mirrors TemplateFuncs for html/template.
var HTMLTemplateFuncs = htmltemplate.FuncMap{
	"title": strings.Title,
	"upper": strings.ToUpper,
	"lower": strings.ToLower,
	"formatDate": func(v interface{}) string {
		switch t := v.(type) {
		case time.Time:
			return t.UTC().Format("Jan 02, 2006 at 15:04 UTC")
		case string:
			if parsed, err := time.Parse(time.RFC3339, t); err == nil {
				return parsed.UTC().Format("Jan 02, 2006 at 15:04 UTC")
			}
			return t
		default:
			return fmt.Sprintf("%v", v)
		}
	},
	"truncate": func(n int, s string) string {
		if len(s) <= n {
			return s
		}
		return s[:n] + "..."
	},
}

// TemplateService handles rendering of notification templates.
type TemplateService struct {
	baseLayout string
	templates  map[string]string // notifType → body template content
	store      TemplateStore     // optional DB template override store (#18)
	logger     zerolog.Logger
}

type emailTemplateCopy struct {
	Language                  string
	Direction                 string
	TextAlign                 string
	FontStack                 string
	BrandName                 string
	FooterText                string
	SecurityAlertHeading      string
	AlertEscalatedHeading     string
	TaskAssignedHeading       string
	SecurityIncidentHeading   string
	SystemMaintenanceHeading  string
	PipelineFailedHeading     string
	ContractExpiringHeading   string
	DigestHeading             string
	DigestUnreadText          string
	PriorityLabel             string
	ViewAlertLabel            string
	ViewTaskLabel             string
	RespondNowLabel           string
	ViewPipelineLabel         string
	ViewContractLabel         string
	ViewDetailsLabel          string
	ViewAllNotificationsLabel string
}

var emailCopy = map[string]emailTemplateCopy{
	"en": {
		Language:                  "en",
		Direction:                 "ltr",
		TextAlign:                 "left",
		FontStack:                 "Arial, sans-serif",
		BrandName:                 "Clario 360",
		FooterText:                "All rights reserved.",
		SecurityAlertHeading:      "Security Alert",
		AlertEscalatedHeading:     "Alert Escalated",
		TaskAssignedHeading:       "New Task Assigned",
		SecurityIncidentHeading:   "SECURITY INCIDENT",
		SystemMaintenanceHeading:  "Scheduled Maintenance",
		PipelineFailedHeading:     "Pipeline Failed",
		ContractExpiringHeading:   "Contract Expiring",
		DigestHeading:             "Your Notification Summary",
		DigestUnreadText:          "unread notifications",
		PriorityLabel:             "Priority",
		ViewAlertLabel:            "View Alert",
		ViewTaskLabel:             "View Task",
		RespondNowLabel:           "Respond Now",
		ViewPipelineLabel:         "View Pipeline",
		ViewContractLabel:         "View Contract",
		ViewDetailsLabel:          "View Details",
		ViewAllNotificationsLabel: "View All Notifications",
	},
	"ar": {
		Language:  "ar",
		Direction: "rtl",
		TextAlign: "right",
		// Arabic-safe stack: Segoe UI/Tahoma (Windows), Geeza Pro (Apple),
		// Noto Sans/Naskh Arabic (Google/webmail), Arial/sans-serif fallback.
		FontStack:                 "'Segoe UI', Tahoma, 'Geeza Pro', 'Noto Sans Arabic', 'Noto Naskh Arabic', Arial, sans-serif",
		BrandName:                 "Clario 360",
		FooterText:                "جميع الحقوق محفوظة.",
		SecurityAlertHeading:      "تنبيه أمني",
		AlertEscalatedHeading:     "تم تصعيد التنبيه",
		TaskAssignedHeading:       "تم تعيين مهمة جديدة",
		SecurityIncidentHeading:   "حادث أمني",
		SystemMaintenanceHeading:  "صيانة مجدولة",
		PipelineFailedHeading:     "فشل مسار البيانات",
		ContractExpiringHeading:   "عقد يوشك على الانتهاء",
		DigestHeading:             "ملخص إشعاراتك",
		DigestUnreadText:          "إشعارات غير مقروءة",
		PriorityLabel:             "الأولوية",
		ViewAlertLabel:            "عرض التنبيه",
		ViewTaskLabel:             "عرض المهمة",
		RespondNowLabel:           "الاستجابة الآن",
		ViewPipelineLabel:         "عرض المسار",
		ViewContractLabel:         "عرض العقد",
		ViewDetailsLabel:          "عرض التفاصيل",
		ViewAllNotificationsLabel: "عرض كل الإشعارات",
	},
}

// NewTemplateService creates a new TemplateService with embedded templates.
func NewTemplateService(logger zerolog.Logger) *TemplateService {
	svc := &TemplateService{
		templates: make(map[string]string),
		logger:    logger.With().Str("component", "template_service").Logger(),
	}

	svc.baseLayout = baseLayoutTemplate
	svc.templates["alert.created"] = alertNotificationTemplate
	svc.templates["alert.escalated"] = alertEscalatedTemplate
	svc.templates["task.assigned"] = taskAssignedTemplate
	svc.templates["security.incident"] = securityIncidentTemplate
	svc.templates["system.maintenance"] = systemMaintenanceTemplate
	svc.templates["pipeline.failed"] = pipelineFailedTemplate
	svc.templates["contract.expiring"] = contractExpiringTemplate
	svc.templates["generic"] = genericTemplate
	svc.templates["digest"] = digestTemplate

	return svc
}

// SetStore wires an optional DB template store (#18). When set, RenderEmail
// prefers a stored template for (tenant, type) — a tenant-specific override, then
// the seeded platform default — before falling back to the embedded Go const.
// Additive: NewTemplateService leaves the store nil, preserving const-only
// behaviour, so no existing call site changes.
func (s *TemplateService) SetStore(store TemplateStore) { s.store = store }

// SeedDefaultTemplates materializes the embedded Go-const email templates into
// the notification_templates table under the platform-default tenant (#18). It
// uses insert-if-absent semantics via the seeder so an operator's customization
// is never overwritten on restart. Behaviour is unchanged by default because the
// seeded rows are byte-identical to the consts.
func (s *TemplateService) SeedDefaultTemplates(ctx context.Context, seeder TemplateSeeder) error {
	tenant := defaultTemplateTenantID
	for id, body := range s.templates {
		if err := seeder.SeedDefault(ctx, &model.TemplateConfig{
			ID:       id,
			TenantID: &tenant,
			Channel:  model.ChannelEmail,
			BodyTmpl: body,
		}); err != nil {
			return fmt.Errorf("seed default template %s: %w", id, err)
		}
	}
	return nil
}

// dbEmailTemplate resolves a DB-backed email template for the notification,
// preferring a tenant-specific override then the seeded platform default. It
// returns ok=false (so the caller falls back to the embedded const) when no
// store is configured, no row exists, or a lookup error occurs.
func (s *TemplateService) dbEmailTemplate(notif *model.Notification) (subjectTmpl, bodyTmpl string, ok bool) {
	if s.store == nil || notif == nil {
		return "", "", false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	typeID := string(notif.Type)
	seen := map[string]struct{}{}
	for _, tenantID := range []string{notif.TenantID, defaultTemplateTenantID} {
		if tenantID == "" {
			continue
		}
		if _, dup := seen[tenantID]; dup {
			continue
		}
		seen[tenantID] = struct{}{}

		tmpl, found, err := s.store.GetEmailTemplate(ctx, tenantID, typeID)
		if err != nil {
			s.logger.Warn().Err(err).Str("type", typeID).Msg("db template lookup failed; falling back to embedded template")
			return "", "", false
		}
		if found && strings.TrimSpace(tmpl.BodyTmpl) != "" {
			return tmpl.SubjectTmpl, tmpl.BodyTmpl, true
		}
	}
	return "", "", false
}

// RenderEmail renders the subject and HTML body for an email notification.
func (s *TemplateService) RenderEmail(notif *model.Notification) (string, string, error) {
	locale := resolveNotificationLocale(notif)
	copy := localizedEmailCopy(locale)
	rawData := notificationData(notif)
	data := s.buildTemplateData(notif, locale)

	// Prefer a DB-backed template (#18) for (tenant, type); on any miss/error this
	// is a clean fall-through to the embedded Go-const defaults below.
	dbSubjectTmpl, dbBodyTmpl, dbOK := s.dbEmailTemplate(notif)

	// Render subject via text/template (plain text).
	subjectTmpl := notif.Title
	if localizedSubject, ok := localizedNotificationOverride(rawData, "subject", locale); ok {
		subjectTmpl = localizedSubject
	} else if locale != "en" {
		if localizedTitle, ok := localizedNotificationOverride(rawData, "title", locale); ok {
			subjectTmpl = localizedTitle
		}
	}
	// A DB template may carry its own subject line; a localized payload override
	// still wins so per-notification i18n is preserved.
	if dbOK && strings.TrimSpace(dbSubjectTmpl) != "" && subjectTmpl == notif.Title {
		subjectTmpl = dbSubjectTmpl
	}
	subject, err := s.renderText(subjectTmpl, data)
	if err != nil {
		subject = notif.Title
	}

	// Select the body template: DB override first, else the per-type const, else
	// the generic const.
	var bodyTmplStr string
	if dbOK {
		bodyTmplStr = dbBodyTmpl
	} else if t, ok := s.templates[string(notif.Type)]; ok {
		bodyTmplStr = t
	} else {
		bodyTmplStr = s.templates["generic"]
	}

	// Render body via html/template (XSS-safe).
	body, err := s.renderHTML(bodyTmplStr, data)
	if err != nil {
		return subject, notif.Body, nil
	}

	// Wrap in base layout.
	layoutData := map[string]interface{}{
		"Content":      htmltemplate.HTML(body),
		"PrimaryColor": "#005E5E",
		"AccentColor":  "#ABB705",
		"Year":         time.Now().Year(),
		"Language":     copy.Language,
		"Direction":    copy.Direction,
		"TextAlign":    copy.TextAlign,
		// template.CSS marks the font stack as trusted CSS so html/template does
		// not mangle the quoted, comma-separated Arabic family list.
		"FontStack":  htmltemplate.CSS(copy.FontStack),
		"BrandName":  copy.BrandName,
		"FooterText": copy.FooterText,
	}
	wrappedBody, err := s.renderHTML(s.baseLayout, layoutData)
	if err != nil {
		return subject, body, nil
	}

	return subject, wrappedBody, nil
}

// RenderEmailText renders a plain-text alternative for an email notification
// (#8). The text part is what non-HTML clients display and improves
// deliverability; it carries the localized title, body and any action URL.
func (s *TemplateService) RenderEmailText(notif *model.Notification) (string, error) {
	locale := resolveNotificationLocale(notif)
	copy := localizedEmailCopy(locale)
	data := s.buildTemplateData(notif, locale)

	title, _ := data["title"].(string)
	body, _ := data["body"].(string)
	if title == "" {
		title = notif.Title
	}
	if body == "" {
		body = notif.Body
	}

	var b strings.Builder
	b.WriteString(title)
	b.WriteString("\n\n")
	b.WriteString(body)
	if actionURL, ok := stringValue(data["action_url"]); ok {
		b.WriteString("\n\n")
		b.WriteString(copy.ViewDetailsLabel)
		b.WriteString(": ")
		b.WriteString(actionURL)
	}
	b.WriteString("\n\n—\n")
	b.WriteString(copy.BrandName)
	return b.String(), nil
}

// RenderText renders a template string as plain text.
func (s *TemplateService) RenderText(tmplStr string, data map[string]interface{}) (string, error) {
	return s.renderText(tmplStr, data)
}

func (s *TemplateService) renderText(tmplStr string, data interface{}) (string, error) {
	tmpl, err := texttemplate.New("t").Funcs(TemplateFuncs).Parse(tmplStr)
	if err != nil {
		return "", fmt.Errorf("parse text template: %w", err)
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("execute text template: %w", err)
	}
	return buf.String(), nil
}

func (s *TemplateService) renderHTML(tmplStr string, data interface{}) (string, error) {
	tmpl, err := htmltemplate.New("t").Funcs(HTMLTemplateFuncs).Parse(tmplStr)
	if err != nil {
		return "", fmt.Errorf("parse html template: %w", err)
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("execute html template: %w", err)
	}
	return buf.String(), nil
}

func (s *TemplateService) buildTemplateData(notif *model.Notification, locale string) map[string]interface{} {
	copy := localizedEmailCopy(locale)
	data := map[string]interface{}{
		"title":    notif.Title,
		"body":     notif.Body,
		"type":     string(notif.Type),
		"category": notif.Category,
		"priority": notif.Priority,
		"id":       notif.ID,
		"locale":   locale,
		"copy":     copy,
	}

	// Merge notification data into template data.
	if notif.Data != nil {
		var nd map[string]interface{}
		if err := json.Unmarshal(notif.Data, &nd); err == nil {
			for k, v := range nd {
				data[k] = v
			}
			data["title"] = localizedNotificationField(notif, data, "title", locale, notif.Title)
			data["body"] = localizedNotificationField(notif, data, "body", locale, notif.Body)
		}
	}

	return data
}

func localizedEmailCopy(locale string) emailTemplateCopy {
	copy, ok := emailCopy[locale]
	if !ok {
		return emailCopy["en"]
	}
	return copy
}

func resolveNotificationLocale(notif *model.Notification) string {
	data := notificationData(notif)
	for _, key := range []string{"locale", "language", "lang", "preferred_locale"} {
		if value, ok := data[key].(string); ok {
			return normalizeNotificationLocale(value)
		}
	}

	return "en"
}

func notificationData(notif *model.Notification) map[string]interface{} {
	if notif == nil || len(notif.Data) == 0 {
		return nil
	}

	var data map[string]interface{}
	if err := json.Unmarshal(notif.Data, &data); err != nil {
		return nil
	}
	return data
}

func normalizeNotificationLocale(locale string) string {
	locale = strings.TrimSpace(strings.ToLower(locale))
	locale = strings.ReplaceAll(locale, "_", "-")
	switch {
	case strings.HasPrefix(locale, "ar"):
		return "ar"
	default:
		return "en"
	}
}

func localizedNotificationField(notif *model.Notification, data map[string]interface{}, fieldName, locale, fallback string) string {
	if data == nil {
		return fallback
	}

	if value, ok := localizedNotificationOverride(data, fieldName, locale); ok {
		return value
	}

	if value, ok := stringValue(data[fieldName]); ok && value != "" {
		return value
	}

	if notif != nil && fieldName == "body" && fallback == "" {
		return notif.Body
	}
	return fallback
}

func localizedNotificationOverride(data map[string]interface{}, fieldName, locale string) (string, bool) {
	if data == nil {
		return "", false
	}

	if locale != "en" {
		for _, key := range []string{fieldName + "_" + locale, fieldName + "_" + strings.ReplaceAll(locale, "-", "_")} {
			if value, ok := stringValue(data[key]); ok {
				return value, true
			}
		}
	}

	return localizedMapValue(data[fieldName], locale)
}

func localizedMapValue(value interface{}, locale string) (string, bool) {
	switch typed := value.(type) {
	case map[string]interface{}:
		for _, key := range []string{locale, strings.ReplaceAll(locale, "-", "_"), "en"} {
			if value, ok := stringValue(typed[key]); ok {
				return value, true
			}
		}
	case map[string]string:
		for _, key := range []string{locale, strings.ReplaceAll(locale, "-", "_"), "en"} {
			if value := strings.TrimSpace(typed[key]); value != "" {
				return value, true
			}
		}
	}
	return "", false
}

func stringValue(value interface{}) (string, bool) {
	typed, ok := value.(string)
	if !ok {
		return "", false
	}
	typed = strings.TrimSpace(typed)
	return typed, typed != ""
}

// Embedded templates.
const baseLayoutTemplate = `<!DOCTYPE html>
<html lang="{{.Language}}" dir="{{.Direction}}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0; padding:0; font-family:{{.FontStack}}; background-color:#FDFFF6; color:#06352F; text-align:{{.TextAlign}};">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px; margin:0 auto; background:#FDFFF6; border:1px solid #D1D8D5;">
<tr><td style="background-color:{{.PrimaryColor}}; padding:20px; text-align:center;">
<h1 style="color:#ffffff; margin:0; font-size:24px;">{{.BrandName}}</h1>
</td></tr>
<tr><td style="padding:30px;">{{.Content}}</td></tr>
<tr><td style="background-color:#D1D8D5; padding:15px; text-align:center; font-size:12px; color:#6C7874;">
<p>&copy; {{.Year}} {{.BrandName}}. {{.FooterText}}</p>
</td></tr>
</table>
</body>
</html>`

const alertNotificationTemplate = `<h2 style="color:#d32f2f;">{{.copy.SecurityAlertHeading}}</h2>
<p><strong>{{.copy.PriorityLabel}}:</strong> {{.priority}}</p>
<p>{{.body}}</p>
{{if .action_url}}<p><a href="{{.action_url}}" style="background-color:#005E5E; color:#fff; padding:10px 20px; text-decoration:none; border-radius:4px;">{{.copy.ViewAlertLabel}}</a></p>{{end}}`

const alertEscalatedTemplate = `<h2 style="color:#d32f2f;">{{.copy.AlertEscalatedHeading}}</h2>
<p>{{.body}}</p>
{{if .action_url}}<p><a href="{{.action_url}}" style="background-color:#d32f2f; color:#fff; padding:10px 20px; text-decoration:none; border-radius:4px;">{{.copy.ViewAlertLabel}}</a></p>{{end}}`

const taskAssignedTemplate = `<h2 style="color:#06352F;">{{.copy.TaskAssignedHeading}}</h2>
<p>{{.body}}</p>
{{if .action_url}}<p><a href="{{.action_url}}" style="background-color:#005E5E; color:#fff; padding:10px 20px; text-decoration:none; border-radius:4px;">{{.copy.ViewTaskLabel}}</a></p>{{end}}`

const securityIncidentTemplate = `<h2 style="color:#d32f2f;">{{.copy.SecurityIncidentHeading}}</h2>
<p style="background-color:#fce4ec; padding:15px; border-left:4px solid #d32f2f;">{{.body}}</p>
{{if .action_url}}<p><a href="{{.action_url}}" style="background-color:#d32f2f; color:#fff; padding:10px 20px; text-decoration:none; border-radius:4px;">{{.copy.RespondNowLabel}}</a></p>{{end}}`

const systemMaintenanceTemplate = `<h2 style="color:#1565c0;">{{.copy.SystemMaintenanceHeading}}</h2>
<p>{{.body}}</p>`

const pipelineFailedTemplate = `<h2 style="color:#e65100;">{{.copy.PipelineFailedHeading}}</h2>
<p>{{.body}}</p>
{{if .action_url}}<p><a href="{{.action_url}}" style="background-color:#e65100; color:#fff; padding:10px 20px; text-decoration:none; border-radius:4px;">{{.copy.ViewPipelineLabel}}</a></p>{{end}}`

const contractExpiringTemplate = `<h2 style="color:#ABB705;">{{.copy.ContractExpiringHeading}}</h2>
<p>{{.body}}</p>
{{if .action_url}}<p><a href="{{.action_url}}" style="background-color:#005E5E; color:#fff; padding:10px 20px; text-decoration:none; border-radius:4px;">{{.copy.ViewContractLabel}}</a></p>{{end}}`

const genericTemplate = `<h2 style="color:#06352F;">{{.title}}</h2>
<p>{{.body}}</p>
{{if .action_url}}<p><a href="{{.action_url}}" style="background-color:#005E5E; color:#fff; padding:10px 20px; text-decoration:none; border-radius:4px;">{{.copy.ViewDetailsLabel}}</a></p>{{end}}`

const digestTemplate = `<h2 style="color:#06352F;">{{.copy.DigestHeading}}</h2>
<p><strong>{{.count}}</strong> {{.copy.DigestUnreadText}}.</p>
{{range .items}}<div style="border-bottom:1px solid #D1D8D5; padding:10px 0;">
<strong>{{.Title}}</strong><br>
<span style="color:#6C7874;">{{.Body}}</span>
</div>{{end}}
<p><a href="{{.dashboard_url}}" style="background-color:#005E5E; color:#fff; padding:10px 20px; text-decoration:none; border-radius:4px;">{{.copy.ViewAllNotificationsLabel}}</a></p>`
