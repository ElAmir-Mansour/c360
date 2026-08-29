package integration

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/model"
)

// RedactedSentinel is the placeholder value the registry returns for a SECRET
// field in masked config, and the value the console echoes back unchanged on
// Update to signal "keep the stored ciphertext" (merge-on-update). Any other
// incoming value for a secret field is treated as a new secret and re-encrypted.
const RedactedSentinel = "__redacted__"

// SyncIntervalMinutesKey is the per-endpoint config key (a non-secret number
// field on Syncer-capable kinds) that holds the scheduled-pull cadence in
// minutes. The IntegrationSyncMonitor reads it to decide when an active endpoint
// is "due" for a scheduled delta sync. An unset/blank/non-positive value means
// "do not schedule" — the endpoint is then only ever synced on-demand.
const SyncIntervalMinutesKey = "sync_interval_minutes"

// SyncInterval extracts the scheduled-pull cadence from an endpoint config map.
// It reads SyncIntervalMinutesKey, tolerating int / float / string encodings (the
// config map round-trips through JSON and the masked-config echo). It returns
// (0, false) when the field is absent, blank, unparseable, or non-positive — the
// caller treats that as "scheduling disabled" for this endpoint.
func SyncInterval(config map[string]any) (time.Duration, bool) {
	if config == nil {
		return 0, false
	}
	raw, present := config[SyncIntervalMinutesKey]
	if !present || raw == nil {
		return 0, false
	}
	minutes := 0.0
	switch v := raw.(type) {
	case int:
		minutes = float64(v)
	case int64:
		minutes = float64(v)
	case float64:
		minutes = v
	case float32:
		minutes = float64(v)
	case string:
		s := strings.TrimSpace(v)
		if s == "" {
			return 0, false
		}
		parsed, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return 0, false
		}
		minutes = parsed
	default:
		return 0, false
	}
	if minutes <= 0 {
		return 0, false
	}
	return time.Duration(minutes * float64(time.Minute)), true
}

// FieldType is the input affordance the dynamic console form renders for a field.
type FieldType string

const (
	FieldTypeString FieldType = "string"
	FieldTypeText   FieldType = "text"
	FieldTypeURL    FieldType = "url"
	FieldTypeNumber FieldType = "number"
	FieldTypeBool   FieldType = "bool"
	FieldTypeEnum   FieldType = "enum"
	FieldTypeSecret FieldType = "secret"
)

// FieldSpec describes one configuration field for an integration kind. The
// per-kind ConfigSchema (a []FieldSpec) is the SINGLE SOURCE OF TRUTH for:
//   - validation (Validate),
//   - dynamic console form rendering (label/type/enum/required/help),
//   - schema-aware redaction (MaskConfig: secret -> sentinel, non-secret echoes
//     its value so the console can prefill),
//   - merge-on-update (MergeSecrets: a returning sentinel keeps stored ciphertext).
type FieldSpec struct {
	// Key is the config map key (snake_case, stable).
	Key string `json:"key"`
	// Label is the bilingual operator-facing field label.
	Label forms.LocalizedText `json:"label"`
	// Type is the rendered input affordance. Secret implies redaction.
	Type FieldType `json:"type"`
	// Secret marks a field whose value is sensitive (credentials, tokens). Secret
	// fields are masked to the sentinel on read and merged on update. A field is
	// treated as secret when Secret is true OR Type == FieldTypeSecret.
	Secret bool `json:"secret"`
	// Required marks a field that must be present + non-empty for an ACTIVE
	// endpoint (validated on configure).
	Required bool `json:"required"`
	// Enum, when non-empty, constrains an enum/string field to these values.
	Enum []string `json:"enum,omitempty"`
	// Default is the value the console pre-populates when the field is unset.
	Default string `json:"default,omitempty"`
	// Help is bilingual inline guidance for the field.
	Help forms.LocalizedText `json:"help,omitempty"`
}

// IsSecret reports whether this field carries sensitive material.
func (f FieldSpec) IsSecret() bool {
	return f.Secret || f.Type == FieldTypeSecret
}

// ConfigSchema is the ordered field list for an integration kind.
type ConfigSchema []FieldSpec

// configSchemas is the per-kind schema registry. It covers ALL kinds the console
// can render — including kinds (nafath_verify, sso, esign) added by the framework
// migration. Field lists follow the Integration Platform design doc.
var configSchemas = map[model.IntegrationKind]ConfigSchema{
	model.IntegrationKindNajiz: {
		{Key: "base_url", Type: FieldTypeURL, Required: true, Label: bi("رابط بوابة ناجز (تكامل)", "Najiz (Takamul) base URL"), Help: bi("نقطة نهاية واجهة برمجة التطبيقات لبوابة ناجز", "Najiz Takamul API endpoint")},
		{Key: "token_url", Type: FieldTypeURL, Label: bi("رابط إصدار الرمز المميز", "OAuth token URL"), Help: bi("اتركه فارغاً إذا كانت المصادقة بمفتاح API", "Leave blank when authenticating with an API key")},
		{Key: "client_id", Type: FieldTypeString, Label: bi("معرّف العميل", "Client ID")},
		{Key: "client_secret", Type: FieldTypeSecret, Secret: true, Label: bi("سرّ العميل", "Client secret")},
		{Key: "api_key", Type: FieldTypeSecret, Secret: true, Label: bi("مفتاح API", "API key"), Help: bi("بديل عن OAuth", "Alternative to OAuth")},
		{Key: "org_id", Type: FieldTypeString, Label: bi("معرّف المنشأة", "Organization / entity ID")},
		{Key: "case_sync_path", Type: FieldTypeString, Default: "/cases", Label: bi("مسار مزامنة القضايا", "Case sync path")},
		{Key: "add_representative_path", Type: FieldTypeString, Default: "/representatives", Label: bi("مسار إضافة الممثل", "Add-representative path")},
		{Key: "environment", Type: FieldTypeEnum, Enum: []string{"sandbox", "production"}, Default: "sandbox", Label: bi("البيئة", "Environment")},
		{Key: SyncIntervalMinutesKey, Type: FieldTypeNumber, Default: "60", Label: bi("فاصل المزامنة (دقائق)", "Sync interval (minutes)"), Help: bi("كم دقيقة بين عمليات السحب المجدولة؛ اتركه فارغاً لتعطيل الجدولة", "Minutes between scheduled pulls; leave blank to disable scheduling")},
	},
	model.IntegrationKindNafathVerify: {
		{Key: "base_url", Type: FieldTypeURL, Required: true, Label: bi("رابط نفاذ", "Nafath base URL")},
		{Key: "token_url", Type: FieldTypeURL, Label: bi("رابط إصدار الرمز المميز", "OAuth token URL")},
		{Key: "client_id", Type: FieldTypeString, Required: true, Label: bi("معرّف العميل", "Client ID")},
		{Key: "client_secret", Type: FieldTypeSecret, Secret: true, Required: true, Label: bi("سرّ العميل", "Client secret")},
		{Key: "service_id", Type: FieldTypeString, Label: bi("معرّف الخدمة", "Service ID")},
		{Key: "request_path", Type: FieldTypeString, Default: "/mfa/request", Label: bi("مسار طلب التحقق", "Verify request path")},
		{Key: "status_path", Type: FieldTypeString, Default: "/mfa/status", Label: bi("مسار حالة التحقق", "Verify status path")},
		{Key: "min_acr", Type: FieldTypeEnum, Enum: []string{"app-push-number-match", "biometric"}, Default: "app-push-number-match", Label: bi("الحد الأدنى لمستوى التوثيق", "Minimum LoA / ACR")},
		{Key: "environment", Type: FieldTypeEnum, Enum: []string{"uat", "production"}, Default: "uat", Label: bi("البيئة", "Environment")},
	},
	model.IntegrationKindSSO: {
		{Key: "protocol", Type: FieldTypeEnum, Enum: []string{"oidc", "saml"}, Required: true, Default: "oidc", Label: bi("البروتوكول", "Protocol")},
		{Key: "issuer", Type: FieldTypeURL, Label: bi("جهة الإصدار (OIDC)", "OIDC issuer / discovery URL")},
		{Key: "client_id", Type: FieldTypeString, Label: bi("معرّف العميل", "Client ID")},
		{Key: "client_secret", Type: FieldTypeSecret, Secret: true, Label: bi("سرّ العميل", "Client secret")},
		{Key: "saml_metadata_url", Type: FieldTypeURL, Label: bi("رابط بيانات SAML الوصفية", "SAML IdP metadata URL")},
		{Key: "saml_metadata_xml", Type: FieldTypeText, Label: bi("بيانات SAML الوصفية (XML)", "SAML IdP metadata (XML)")},
		{Key: "scim_enabled", Type: FieldTypeBool, Default: "false", Label: bi("تفعيل SCIM", "Enable inbound SCIM")},
		{Key: "scim_token", Type: FieldTypeSecret, Secret: true, Label: bi("رمز SCIM المميز", "SCIM bearer token")},
		{Key: "default_role", Type: FieldTypeString, Label: bi("الدور الافتراضي", "Default provisioned role")},
	},
	model.IntegrationKindHR: {
		{Key: "transport", Type: FieldTypeEnum, Enum: []string{"scim", "hris_api", "csv_sftp", "ldap"}, Required: true, Default: "scim", Label: bi("وسيلة النقل", "Transport")},
		{Key: "base_url", Type: FieldTypeURL, Label: bi("الرابط الأساسي", "Base URL (SCIM/HRIS)")},
		{Key: "bearer_token", Type: FieldTypeSecret, Secret: true, Label: bi("رمز المصادقة المميز", "Bearer token")},
		{Key: "sftp_host", Type: FieldTypeString, Label: bi("مضيف SFTP", "SFTP host")},
		{Key: "sftp_username", Type: FieldTypeString, Label: bi("اسم مستخدم SFTP", "SFTP username")},
		{Key: "sftp_password", Type: FieldTypeSecret, Secret: true, Label: bi("كلمة مرور SFTP", "SFTP password")},
		{Key: "ldap_url", Type: FieldTypeURL, Label: bi("رابط LDAP", "LDAP URL")},
		{Key: "ldap_bind_dn", Type: FieldTypeString, Label: bi("DN للربط", "LDAP bind DN")},
		{Key: "ldap_bind_password", Type: FieldTypeSecret, Secret: true, Label: bi("كلمة مرور الربط", "LDAP bind password")},
		{Key: "sync_mode", Type: FieldTypeEnum, Enum: []string{"full", "delta"}, Default: "delta", Label: bi("نمط المزامنة", "Default sync mode")},
		{Key: SyncIntervalMinutesKey, Type: FieldTypeNumber, Default: "60", Label: bi("فاصل المزامنة (دقائق)", "Sync interval (minutes)"), Help: bi("كم دقيقة بين عمليات السحب المجدولة؛ اتركه فارغاً لتعطيل الجدولة", "Minutes between scheduled pulls; leave blank to disable scheduling")},
	},
	model.IntegrationKindArchiving: {
		{Key: "protocol", Type: FieldTypeEnum, Enum: []string{"local", "cmis", "s3", "sharepoint"}, Required: true, Default: "s3", Label: bi("البروتوكول", "Protocol")},
		{Key: "base_url", Type: FieldTypeURL, Label: bi("نقطة النهاية", "Endpoint / base URL")},
		{Key: "base_dir", Type: FieldTypeString, Label: bi("مسار الأرشيف المحلي", "Local archive directory"), Help: bi("لخلفية local القابلة للعكس (غير WORM): المجلد الأساسي على الخادم؛ اتركه فارغاً للمسار الافتراضي", "For the reversible local (non-WORM) backend: base directory on the host; leave blank for the default path")},
		{Key: "bucket", Type: FieldTypeString, Label: bi("الحاوية / المخزن", "Bucket / repository")},
		{Key: "access_key_id", Type: FieldTypeString, Label: bi("معرّف مفتاح الوصول", "Access key ID")},
		{Key: "secret_access_key", Type: FieldTypeSecret, Secret: true, Label: bi("مفتاح الوصول السري", "Secret access key")},
		{Key: "username", Type: FieldTypeString, Label: bi("اسم المستخدم (CMIS/SharePoint)", "Username (CMIS/SharePoint)")},
		{Key: "password", Type: FieldTypeSecret, Secret: true, Label: bi("كلمة المرور", "Password")},
		{Key: "worm_enabled", Type: FieldTypeBool, Default: "true", Label: bi("تفعيل WORM", "Enable WORM object-lock")},
		{Key: "in_kingdom_only", Type: FieldTypeBool, Default: "true", Label: bi("داخل المملكة فقط", "In-Kingdom only (PDPL)")},
		{Key: SyncIntervalMinutesKey, Type: FieldTypeNumber, Label: bi("فاصل المزامنة (دقائق)", "Sync interval (minutes)"), Help: bi("كم دقيقة بين عمليات المطابقة المجدولة؛ اتركه فارغاً لتعطيل الجدولة", "Minutes between scheduled reconcile runs; leave blank to disable scheduling")},
	},
	model.IntegrationKindEsign: {
		{Key: "provider", Type: FieldTypeEnum, Enum: []string{"docusign", "adobe", "native", "emdha"}, Required: true, Default: "docusign", Label: bi("مزوّد التوقيع", "Provider")},
		{Key: "base_url", Type: FieldTypeURL, Label: bi("الرابط الأساسي", "Base URL")},
		{Key: "account_id", Type: FieldTypeString, Label: bi("معرّف الحساب", "Account ID")},
		{Key: "client_id", Type: FieldTypeString, Label: bi("معرّف العميل / المُدمج", "Client / integrator ID")},
		{Key: "client_secret", Type: FieldTypeSecret, Secret: true, Label: bi("سرّ العميل", "Client secret")},
		{Key: "private_key", Type: FieldTypeSecret, Secret: true, Label: bi("المفتاح الخاص (JWT)", "Private key (JWT grant)")},
		{Key: "webhook_secret", Type: FieldTypeSecret, Secret: true, Label: bi("سرّ Webhook", "Webhook signing secret")},
		{Key: "require_nafath", Type: FieldTypeBool, Default: "false", Label: bi("اشتراط تأكيد نفاذ", "Require Nafath identity confirmation")},
	},
	model.IntegrationKindEmail: {
		{Key: "direction", Type: FieldTypeEnum, Enum: []string{"outbound", "inbound", "both"}, Default: "outbound", Required: true, Label: bi("الاتجاه", "Direction")},
		{Key: "smtp_host", Type: FieldTypeString, Label: bi("مضيف SMTP", "SMTP host")},
		{Key: "smtp_port", Type: FieldTypeNumber, Default: "587", Label: bi("منفذ SMTP", "SMTP port")},
		{Key: "smtp_username", Type: FieldTypeString, Label: bi("اسم مستخدم SMTP", "SMTP username")},
		{Key: "smtp_password", Type: FieldTypeSecret, Secret: true, Label: bi("كلمة مرور SMTP", "SMTP password")},
		{Key: "from_address", Type: FieldTypeString, Label: bi("عنوان المرسل", "From address")},
		{Key: "intake_webhook_secret", Type: FieldTypeSecret, Secret: true, Label: bi("سرّ webhook الوارد", "Inbound intake webhook secret")},
	},
	model.IntegrationKindInternal: {
		{Key: "base_url", Type: FieldTypeURL, Required: true, Label: bi("الرابط الأساسي", "Base URL")},
		{Key: "auth_scheme", Type: FieldTypeEnum, Enum: []string{"none", "bearer", "hmac", "basic"}, Default: "hmac", Label: bi("نظام المصادقة", "Auth scheme")},
		{Key: "bearer_token", Type: FieldTypeSecret, Secret: true, Label: bi("رمز المصادقة المميز", "Bearer token")},
		{Key: "hmac_secret", Type: FieldTypeSecret, Secret: true, Label: bi("سرّ HMAC", "HMAC signing secret")},
		{Key: "basic_username", Type: FieldTypeString, Label: bi("اسم المستخدم", "Basic auth username")},
		{Key: "basic_password", Type: FieldTypeSecret, Secret: true, Label: bi("كلمة المرور", "Basic auth password")},
	},
	// Extensibility #18 — no-code generic "custom" connector. The CustomConnector
	// executes this declarative REST spec; the secret auth fields are encrypted at
	// rest + masked on read like every other kind. The console renders these flat
	// fields (or posts a nested custom_spec object, also accepted by the parser).
	model.IntegrationKindCustom: {
		{Key: "base_url", Type: FieldTypeURL, Required: true, Label: bi("الرابط الأساسي", "Base URL"), Help: bi("نقطة نهاية واجهة برمجة التطبيقات الخارجية", "External API base endpoint")},
		{Key: "auth_type", Type: FieldTypeEnum, Enum: []string{"none", "basic", "bearer", "oauth2_cc", "hmac"}, Default: "none", Label: bi("نوع المصادقة", "Auth type")},
		{Key: "auth_username", Type: FieldTypeString, Label: bi("اسم المستخدم", "Auth username (basic)")},
		{Key: "auth_password", Type: FieldTypeSecret, Secret: true, Label: bi("كلمة المرور", "Auth password (basic)")},
		{Key: "auth_token", Type: FieldTypeSecret, Secret: true, Label: bi("الرمز المميز", "Bearer token")},
		{Key: "auth_token_url", Type: FieldTypeURL, Label: bi("رابط إصدار الرمز (OAuth2)", "OAuth2 token URL")},
		{Key: "auth_client_id", Type: FieldTypeString, Label: bi("معرّف العميل (OAuth2)", "OAuth2 client ID")},
		{Key: "auth_client_secret", Type: FieldTypeSecret, Secret: true, Label: bi("سرّ العميل (OAuth2)", "OAuth2 client secret")},
		{Key: "auth_scope", Type: FieldTypeString, Label: bi("النطاق (OAuth2)", "OAuth2 scope")},
		{Key: "auth_hmac_secret", Type: FieldTypeSecret, Secret: true, Label: bi("سرّ HMAC", "HMAC signing secret")},
		{Key: "request_method", Type: FieldTypeEnum, Enum: []string{"GET", "POST", "PUT", "PATCH", "DELETE"}, Default: "GET", Label: bi("طريقة الطلب", "Request method")},
		{Key: "request_path", Type: FieldTypeString, Label: bi("مسار الطلب", "Request path"), Help: bi("يُلحق بالرابط الأساسي", "Appended to base_url")},
		{Key: "request_headers", Type: FieldTypeText, Label: bi("ترويسات الطلب (JSON)", "Request headers (JSON object)")},
		{Key: "request_body_template", Type: FieldTypeText, Label: bi("قالب جسم الطلب", "Request body template (JSON)")},
		{Key: "response_records_path", Type: FieldTypeString, Label: bi("مسار السجلات في الاستجابة", "Response records path (dot path)"), Help: bi("مثل data.items؛ اتركه فارغاً إذا كانت الاستجابة مصفوفة", "e.g. data.items; blank when the response is a top-level array")},
		{Key: "response_field_map", Type: FieldTypeText, Label: bi("خريطة الحقول (JSON)", "Response field map (JSON: lex_field→source_field)")},
		{Key: "pagination_type", Type: FieldTypeEnum, Enum: []string{"none", "page", "cursor"}, Default: "none", Label: bi("نوع ترقيم الصفحات", "Pagination type")},
		{Key: "pagination_param", Type: FieldTypeString, Label: bi("معامل ترقيم الصفحات", "Pagination query parameter")},
		{Key: SyncIntervalMinutesKey, Type: FieldTypeNumber, Label: bi("فاصل المزامنة (دقائق)", "Sync interval (minutes)"), Help: bi("كم دقيقة بين عمليات السحب المجدولة؛ اتركه فارغاً لتعطيل الجدولة", "Minutes between scheduled pulls; leave blank to disable scheduling")},
	},
	// Othaim PRD 14.2 — Yardi Voyager / Interface property-management & real-estate
	// ERP connector. Self-serve REST pull (leases/properties) + a small write surface.
	// Authenticates via OAuth2 client-credentials, an API key, or Yardi's classic
	// HTTP-basic Interface auth; the database/server_name/entity_id fields carry
	// Yardi's multi-DB routing identifiers. All secrets are Secret:true so they are
	// encrypted at rest and masked on read.
	model.IntegrationKindYardi: {
		{Key: "base_url", Type: FieldTypeURL, Required: true, Label: bi("رابط واجهة ياردي (Voyager)", "Yardi Voyager / Interface base URL"), Help: bi("نقطة نهاية واجهة برمجة تطبيقات ياردي، مثل https://{host}/Voyager/api", "Yardi Voyager/Interface API base, e.g. https://{host}/Voyager/api")},
		{Key: "auth_type", Type: FieldTypeEnum, Enum: []string{"oauth2_cc", "api_key", "basic"}, Default: "oauth2_cc", Label: bi("نوع المصادقة", "Auth type"), Help: bi("اعتمادات OAuth2 أو مفتاح API أو مصادقة أساسية لواجهة ياردي الكلاسيكية", "OAuth2 client-credentials, an API key, or classic Yardi Interface HTTP-basic")},
		{Key: "token_url", Type: FieldTypeURL, Label: bi("رابط إصدار الرمز المميز (OAuth2)", "OAuth2 token URL"), Help: bi("مطلوب عند اختيار مصادقة OAuth2", "Required when auth type is OAuth2")},
		{Key: "client_id", Type: FieldTypeString, Label: bi("معرّف العميل (OAuth2)", "Client ID (OAuth2)")},
		{Key: "client_secret", Type: FieldTypeSecret, Secret: true, Label: bi("سرّ العميل (OAuth2)", "Client secret (OAuth2)")},
		{Key: "scope", Type: FieldTypeString, Label: bi("النطاق (OAuth2)", "OAuth2 scope")},
		{Key: "api_key", Type: FieldTypeSecret, Secret: true, Label: bi("مفتاح API", "API key"), Help: bi("بديل عن OAuth2", "Alternative to OAuth2")},
		{Key: "basic_username", Type: FieldTypeString, Label: bi("اسم مستخدم المصادقة الأساسية", "Basic auth username")},
		{Key: "basic_password", Type: FieldTypeSecret, Secret: true, Label: bi("كلمة مرور المصادقة الأساسية", "Basic auth password")},
		{Key: "database", Type: FieldTypeString, Label: bi("قاعدة بيانات ياردي", "Yardi database"), Help: bi("معرّف قاعدة بيانات المستأجر لتوجيه ياردي متعدد القواعد", "Yardi tenant DB identifier for multi-DB routing")},
		{Key: "server_name", Type: FieldTypeString, Label: bi("اسم خادم ياردي", "Yardi server name")},
		{Key: "entity_id", Type: FieldTypeString, Label: bi("معرّف الكيان", "Entity ID")},
		{Key: "platform", Type: FieldTypeString, Label: bi("معرّف المنصة / الترخيص", "Platform / interface license ID")},
		{Key: "lease_sync_path", Type: FieldTypeString, Default: "/leases", Label: bi("مسار مزامنة عقود الإيجار", "Lease sync path")},
		{Key: "property_sync_path", Type: FieldTypeString, Default: "/properties", Label: bi("مسار مزامنة العقارات", "Property sync path")},
		{Key: "note_path", Type: FieldTypeString, Default: "/notes", Label: bi("مسار كتابة الملاحظات", "Note write-back path")},
		{Key: "record_scope", Type: FieldTypeEnum, Enum: []string{"leases", "properties", "both"}, Default: "leases", Label: bi("نطاق السجلات", "Record scope"), Help: bi("ما الذي تسحبه المزامنة", "What a sync pulls")},
		{Key: "environment", Type: FieldTypeEnum, Enum: []string{"sandbox", "production"}, Default: "sandbox", Label: bi("البيئة", "Environment")},
		{Key: SyncIntervalMinutesKey, Type: FieldTypeNumber, Default: "360", Label: bi("فاصل المزامنة (دقائق)", "Sync interval (minutes)"), Help: bi("كم دقيقة بين عمليات السحب المجدولة؛ اتركه فارغاً لتعطيل الجدولة", "Minutes between scheduled pulls; leave blank to disable scheduling")},
	},
}

// reliabilityFields are the NON-SECRET resilience tuning fields (reliability
// features #11 DLQ + #12 circuit breaker) appended to EVERY connector kind's
// schema: how many consecutive failures trip the breaker, how long it stays open
// before half-opening, how many times a dead-letter row is replayed, and the
// replay backoff. They are plain numbers with defaults that match the runtime
// (DefaultFailureThreshold / DefaultBreakerCooldownSecond / DefaultDLQMaxAttempts /
// DefaultDLQBackoffSeconds), gated manage like the rest of config. None is secret,
// so they echo their value on read (the console can prefill them).
func reliabilityFields() ConfigSchema {
	return ConfigSchema{
		{Key: FailureThresholdKey, Type: FieldTypeNumber, Default: strconv.Itoa(DefaultFailureThreshold), Label: bi("حد فشل قاطع الدائرة", "Circuit-breaker failure threshold"), Help: bi("عدد حالات الفشل المتتالية قبل فتح القاطع وإيقاف الاستدعاءات", "Consecutive failures before the breaker opens and fails fast")},
		{Key: BreakerCooldownSecondsKey, Type: FieldTypeNumber, Default: strconv.Itoa(DefaultBreakerCooldownSecond), Label: bi("مدة تهدئة القاطع (ثوانٍ)", "Breaker cooldown (seconds)"), Help: bi("كم ثانية يبقى القاطع مفتوحاً قبل محاولة التعافي", "Seconds the breaker stays open before probing recovery")},
		{Key: DLQMaxAttemptsKey, Type: FieldTypeNumber, Default: strconv.Itoa(DefaultDLQMaxAttempts), Label: bi("حد محاولات إعادة قائمة الرسائل الميتة", "Dead-letter max replay attempts"), Help: bi("أقصى عدد لمحاولات إعادة تشغيل العملية الفاشلة", "Maximum times a failed operation is replayed")},
		{Key: DLQBackoffSecondsKey, Type: FieldTypeNumber, Default: strconv.Itoa(DefaultDLQBackoffSeconds), Label: bi("فترة تراجع إعادة المحاولة (ثوانٍ)", "Dead-letter replay backoff (seconds)"), Help: bi("الفاصل الزمني بين محاولات إعادة التشغيل", "Delay between replay attempts")},
	}
}

// governanceFields are the NON-SECRET integration-governance tuning fields appended
// to EVERY connector kind's schema (governance #14 rotation + #15 data residency/field
// egress). They drive the dynamic console form's rotation-policy + egress controls and
// the external secret-reference toggle:
//   - rotate_every_days     (#14): rotation cadence in days; 0/blank = no policy.
//   - secret_ref_provider   (#14): which external secret backend resolves this
//     endpoint's kms://, vault:// references (none|kms|vault).
//   - allowed_regions       (#15): destination regions egress is permitted to
//     (comma-separated; blank = unconstrained). Data residency.
//   - allowed_egress_fields (#15): the field allow-list permitted to leave the
//     boundary (comma-separated; blank = unconstrained). Data minimisation.
//
// None is secret, so they echo their value on read (the console can prefill them).
func governanceFields() ConfigSchema {
	return ConfigSchema{
		{Key: RotateEveryDaysKey, Type: FieldTypeNumber, Default: "0", Label: bi("تدوير السرّ كل (أيام)", "Rotate secrets every (days)"), Help: bi("عدد الأيام بين عمليات تدوير السرّ؛ صفر لتعطيل سياسة التدوير", "Days between secret rotations; 0 disables the rotation policy")},
		{Key: SecretRefProviderKey, Type: FieldTypeEnum, Enum: []string{SecretRefProviderNone, SecretRefProviderKMS, SecretRefProviderVault}, Default: SecretRefProviderNone, Label: bi("مزوّد مرجع السرّ الخارجي", "External secret-reference provider"), Help: bi("الخزنة التي تحلّ مراجع kms:// أو vault:// لهذه النقطة", "The store that resolves this endpoint's kms:// or vault:// references")},
		{Key: AllowedRegionsKey, Type: FieldTypeString, Label: bi("المناطق المسموح بها (إقامة البيانات)", "Allowed regions (data residency)"), Help: bi("قائمة مناطق الوجهة المسموح بها مفصولة بفواصل؛ اتركها فارغة لعدم التقييد", "Comma-separated destination regions egress may reach; leave blank for unconstrained")},
		{Key: AllowedEgressFieldsKey, Type: FieldTypeString, Label: bi("الحقول المسموح بتصديرها", "Allowed egress fields"), Help: bi("قائمة أسماء الحقول المسموح بخروجها مفصولة بفواصل؛ اتركها فارغة لعدم التقييد", "Comma-separated field names permitted to leave the boundary; leave blank for unconstrained")},
	}
}

// observabilityFields are the NON-SECRET observability tuning fields appended to
// EVERY connector kind's schema (observability #16 per-connector SLOs):
//   - slo_target_pct (#16): the success-rate SLO target as a percentage (default
//     99). The connector is SLO-breached when its windowed error_rate exceeds
//     (100 - slo_target_pct). Not secret, so it echoes its value on read (the
//     console can prefill it).
func observabilityFields() ConfigSchema {
	return ConfigSchema{
		{Key: SLOTargetPctKey, Type: FieldTypeNumber, Default: strconv.FormatFloat(DefaultSLOTargetPct, 'f', -1, 64), Label: bi("هدف اتفاقية مستوى الخدمة (٪ نجاح)", "SLO target (% success)"), Help: bi("نسبة النجاح المستهدفة؛ يُعد الموصل مخالفاً عند تجاوز معدل الخطأ (١٠٠ ناقص الهدف)", "Target success rate; the connector is breached when error rate exceeds (100 − target)")},
	}
}

// extensibilityFields are the NON-SECRET extensibility tuning fields appended to
// EVERY connector kind's schema (extensibility #19 rules + #20 mass-change guard):
//   - sync_rules (#19): the transform/filter RuleSpec[] applied to records during a
//     sync (and shown in the dry-run preview). Edited as a JSON array in the form; the
//     connector parses it via ParseSyncRules. Not secret.
//   - mass_change_threshold_pct (#20): the deactivation guard threshold as a percent
//     of mapped org entities (default 20). A sync deactivating more than this fraction
//     is blocked with a 409 unless forced. Not secret.
func extensibilityFields() ConfigSchema {
	return ConfigSchema{
		{Key: SyncRulesKey, Type: FieldTypeText, Label: bi("قواعد المزامنة (تحويل/تصفية)", "Sync rules (transform/filter)"), Help: bi("مصفوفة JSON من القواعد تُطبَّق على السجلات أثناء المزامنة وفي المعاينة", "A JSON array of transform/filter rules applied to records during sync and in the dry-run preview")},
		{Key: MassChangeThresholdKey, Type: FieldTypeNumber, Default: strconv.FormatFloat(DefaultMassChangeThresholdPct, 'f', -1, 64), Label: bi("حد التغيير الجماعي (٪)", "Mass-change guard threshold (%)"), Help: bi("تُحظر المزامنة التي تُلغي تفعيل أكثر من هذه النسبة من الكيانات المربوطة ما لم تُفرَض", "A sync deactivating more than this percent of mapped entities is blocked unless forced")},
	}
}

// init appends the shared reliability tuning fields (features #11/#12), the
// integration-governance fields (#14/#15), the observability SLO field (#16), and the
// extensibility fields (#19/#20) to every registered connector kind's schema, so the
// dynamic console form renders the breaker/DLQ + rotation/egress + SLO + rules/guard
// controls for all connectors without duplicating them per kind. Run once at package
// load, before any SchemaFor lookup.
func init() {
	extra := append(reliabilityFields(), governanceFields()...)
	extra = append(extra, observabilityFields()...)
	extra = append(extra, extensibilityFields()...)
	for kind, schema := range configSchemas {
		// Idempotent: only append a field the kind does not already carry
		// (forward-compatible if a kind ever declares one explicitly).
		for _, f := range extra {
			if _, exists := schema.fieldByKey(f.Key); !exists {
				schema = append(schema, f)
			}
		}
		configSchemas[kind] = schema
	}
}

// bi is a terse bilingual-label constructor.
func bi(ar, en string) forms.LocalizedText { return forms.LocalizedText{AR: ar, EN: en} }

// SchemaFor returns the config schema for a kind. The second return reports
// whether a schema is registered for the kind.
func SchemaFor(kind model.IntegrationKind) (ConfigSchema, bool) {
	s, ok := configSchemas[kind]
	return s, ok
}

// KnownKinds returns the sorted set of kinds that have a registered schema.
func KnownKinds() []model.IntegrationKind {
	out := make([]model.IntegrationKind, 0, len(configSchemas))
	for k := range configSchemas {
		out = append(out, k)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out
}

// fieldByKey indexes a schema by key.
func (s ConfigSchema) fieldByKey(key string) (FieldSpec, bool) {
	for _, f := range s {
		if f.Key == key {
			return f, true
		}
	}
	return FieldSpec{}, false
}

// FieldByKey is the exported lookup the registry uses to validate a rotate-secret
// request (feature 5): it confirms the target field exists for the kind and lets
// the caller assert it is a secret field before re-encrypting it.
func (s ConfigSchema) FieldByKey(key string) (FieldSpec, bool) { return s.fieldByKey(key) }

// Validate checks a config map against the schema. It is permissive about EXTRA
// keys (forward compatibility / connector-private settings) but enforces enum
// membership for known fields, and enforces required fields ONLY when the
// endpoint is being activated (active == true) — a planned/draft endpoint may be
// saved incomplete. Returns a field->reason map (nil when valid).
func (s ConfigSchema) Validate(config map[string]any, active bool) map[string]string {
	if config == nil {
		config = map[string]any{}
	}
	errs := map[string]string{}
	for _, f := range s {
		raw, present := config[f.Key]
		value := ""
		if present {
			value = strings.TrimSpace(fmt.Sprint(raw))
		}
		if active && f.Required && value == "" && !f.IsSecret() {
			errs[f.Key] = "required"
			continue
		}
		// Secret required fields are validated against the sentinel too: an
		// active endpoint whose secret returns the sentinel is acceptable
		// (ciphertext already on file); a blank secret is not.
		if active && f.Required && f.IsSecret() && value == "" {
			errs[f.Key] = "required"
			continue
		}
		if len(f.Enum) > 0 && value != "" {
			ok := false
			for _, e := range f.Enum {
				if value == e {
					ok = true
					break
				}
			}
			if !ok {
				errs[f.Key] = "invalid_enum"
			}
		}
	}
	if len(errs) == 0 {
		return nil
	}
	return errs
}

// MaskConfig produces the schema-aware redacted view returned to API callers.
//   - A field marked SECRET in the schema collapses to RedactedSentinel when a
//     non-empty value is stored (so the console shows "set"); an empty secret is
//     omitted so the console shows "unset".
//   - A NON-SECRET schema field echoes its stored VALUE so the console form can
//     prefill it.
//   - Keys present in config but absent from the schema are echoed verbatim
//     (treated as non-secret operator annotations); the schema is the source of
//     truth for what counts as secret.
func (s ConfigSchema) MaskConfig(config map[string]any) map[string]any {
	out := map[string]any{}
	seen := map[string]bool{}
	for _, f := range s {
		seen[f.Key] = true
		raw, present := config[f.Key]
		if f.IsSecret() {
			if present && strings.TrimSpace(fmt.Sprint(raw)) != "" {
				out[f.Key] = RedactedSentinel
			}
			continue
		}
		if present {
			out[f.Key] = raw
		}
	}
	for k, v := range config {
		if seen[k] {
			continue
		}
		out[k] = v
	}
	return out
}

// MergeSecrets reconciles an INCOMING config (from an Update request) against the
// EXISTING stored plaintext config, producing the config to persist.
//   - For a SECRET schema field whose incoming value equals RedactedSentinel, the
//     EXISTING stored value is kept (the operator did not change the secret);
//     this is what lets the repo re-encrypt the same plaintext rather than wiping
//     it. An empty/missing incoming secret with an existing value is ALSO kept,
//     so a console that omits unchanged secrets does not blank them.
//   - For a SECRET field with any other incoming value, the new value is used
//     (it will be re-encrypted by the repository on write).
//   - For NON-SECRET fields, the incoming value wins when present; otherwise the
//     existing value is preserved.
//   - Extra (non-schema) incoming keys win; extra existing keys are preserved.
func (s ConfigSchema) MergeSecrets(existing, incoming map[string]any) map[string]any {
	if existing == nil {
		existing = map[string]any{}
	}
	if incoming == nil {
		incoming = map[string]any{}
	}
	out := map[string]any{}
	// Seed with existing so non-schema existing keys survive.
	for k, v := range existing {
		out[k] = v
	}
	schemaKeys := map[string]bool{}
	for _, f := range s {
		schemaKeys[f.Key] = true
		inRaw, present := incoming[f.Key]
		if f.IsSecret() {
			inVal := strings.TrimSpace(fmt.Sprint(inRaw))
			if !present || inVal == "" || inVal == RedactedSentinel {
				// Keep stored secret as-is (already seeded from existing).
				continue
			}
			out[f.Key] = inRaw
			continue
		}
		// Non-secret: incoming wins when present, else keep existing.
		if present {
			out[f.Key] = inRaw
		}
	}
	// Extra incoming keys (not in schema) win.
	for k, v := range incoming {
		if schemaKeys[k] {
			continue
		}
		out[k] = v
	}
	return out
}
