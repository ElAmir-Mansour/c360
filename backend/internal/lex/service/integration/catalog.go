package integration

import (
	"sort"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/lex/model"
)

// =============================================================================
// Feature 7 — connector catalog.
//
// The catalog is the STATIC, tenant-agnostic onboarding metadata for every
// integration kind: maturity (production vs gov_gated), the bilingual
// prerequisite steps an operator completes before activation, the webhook /
// callback URL TEMPLATES to register with the provider (with {tenantID}/{id}
// placeholders the console fills in), KSA/regulatory tags, and whether the kind
// is self-serve. It carries NO secrets and NO tenant config — it is the same for
// every tenant, so the console renders an "available connectors" gallery /
// onboarding wizard from it without a tenant round-trip.
//
// The schema (schema.go) remains the source of truth for FIELDS; the catalog adds
// the human onboarding/maturity context the schema does not encode.
// =============================================================================

// integrationCatalog is the per-kind catalog registry. It covers exactly the kinds
// that have a registered config schema (KnownKinds) so the console never offers a
// connector it cannot configure.
var integrationCatalog = map[model.IntegrationKind]CatalogEntry{
	model.IntegrationKindNajiz: {
		Kind:     model.IntegrationKindNajiz,
		Maturity: MaturityGovGated,
		PrerequisiteSteps: []forms.LocalizedText{
			catBi("سجّل المنشأة في بوابة تكامل (ناجز) لدى وزارة العدل واحصل على معرّف العميل وسرّه", "Register the entity in the MoJ Najiz (Takamul) portal and obtain client_id + client_secret"),
			catBi("اطلب نطاقات الوصول لمزامنة القضايا وإضافة الممثلين", "Request the API scopes for case sync and add-representative"),
			catBi("ابدأ في البيئة التجريبية (sandbox) قبل التفعيل في الإنتاج", "Start in the sandbox environment before activating production"),
		},
		KsaTags:   []string{"moj", "najiz", "in_kingdom", "gov"},
		SelfServe: false,
	},
	model.IntegrationKindNafathVerify: {
		Kind:     model.IntegrationKindNafathVerify,
		Maturity: MaturityGovGated,
		PrerequisiteSteps: []forms.LocalizedText{
			catBi("تعاقد مع مزوّد خدمة نفاذ معتمد واحصل على معرّف الخدمة وبيانات الاعتماد", "Contract a certified Nafath service provider and obtain the service_id + credentials"),
			catBi("سجّل رابط الاستدعاء (webhook) لاستقبال نتيجة التحقق", "Register the callback (webhook) URL to receive verification results"),
			catBi("نفاذ يؤكد الهوية فقط؛ للتوقيع الملزم اقرنه بمزوّد توقيع معتمد (emdha)", "Nafath confirms identity only; pair with a TSP (emdha) for a binding signature"),
		},
		CallbackTemplates: map[string]string{
			"NafathVerificationCompleted":                 "/webhooks/lex/nafath/verify/{tenantID}",
			"NafathVerificationCompleted (watheeq alias)": "/webhooks/watheeq/nafath/verify/{tenantID}",
		},
		KsaTags:   []string{"nafath", "identity", "in_kingdom", "gov"},
		SelfServe: false,
	},
	model.IntegrationKindEsign: {
		Kind:     model.IntegrationKindEsign,
		Maturity: MaturityGovGated,
		PrerequisiteSteps: []forms.LocalizedText{
			catBi("اختر مزوّد التوقيع (docusign / adobe / native / emdha) وأنشئ تطبيق التكامل", "Choose the provider (docusign / adobe / native / emdha) and create the integration app"),
			catBi("احصل على معرّف الحساب وبيانات الاعتماد وسجّل سرّ التوقيع للـ webhook", "Obtain the account_id + credentials and register the webhook signing secret"),
			catBi("للتوقيع الملزم في السعودية استخدم emdha واشترط تأكيد نفاذ", "For a KSA-binding signature use emdha and require Nafath confirmation"),
		},
		CallbackTemplates: map[string]string{
			"EnvelopeStatusChanged": "/webhooks/lex/esign/{provider}/{tenantID}/{id}",
		},
		KsaTags:   []string{"esign", "emdha", "tsp", "in_kingdom"},
		SelfServe: false,
	},
	model.IntegrationKindSSO: {
		Kind:     model.IntegrationKindSSO,
		Maturity: MaturityProduction,
		PrerequisiteSteps: []forms.LocalizedText{
			catBi("أنشئ تطبيق OIDC أو SAML في مزوّد الهوية (Entra / Okta / Keycloak)", "Create an OIDC or SAML application in the IdP (Entra / Okta / Keycloak)"),
			catBi("انسخ رابط جهة الإصدار أو بيانات SAML الوصفية إلى نموذج الإعداد", "Copy the issuer URL or SAML metadata into the configuration form"),
			catBi("لتزويد المستخدمين تلقائياً فعّل SCIM وأصدر رمزاً مميزاً", "For automatic provisioning enable SCIM and issue a bearer token"),
		},
		CallbackTemplates: map[string]string{
			"OIDC redirect URI": "/auth/sso/{tenantID}/callback",
			"SCIM 2.0 base URL": "/scim/v2",
		},
		KsaTags:   []string{"identity", "federation"},
		SelfServe: true,
	},
	model.IntegrationKindHR: {
		Kind:     model.IntegrationKindHR,
		Maturity: MaturityProduction,
		PrerequisiteSteps: []forms.LocalizedText{
			catBi("اختر وسيلة النقل (SCIM / HRIS API / CSV عبر SFTP / LDAP)", "Choose the transport (SCIM / HRIS API / CSV over SFTP / LDAP)"),
			catBi("وفّر بيانات الاعتماد ونقطة النهاية الخاصة بنظام الموارد البشرية", "Provide the HR system's endpoint and credentials"),
			catBi("للتزويد الوارد عبر SCIM أصدر رمزاً مميزاً من وحدة الإعداد", "For inbound SCIM provisioning issue a bearer token from the console"),
		},
		CallbackTemplates: map[string]string{
			"SCIM 2.0 base URL": "/scim/v2",
		},
		KsaTags:   []string{"hr", "identity"},
		SelfServe: true,
	},
	model.IntegrationKindArchiving: {
		Kind:     model.IntegrationKindArchiving,
		Maturity: MaturityProduction,
		PrerequisiteSteps: []forms.LocalizedText{
			catBi("اختر البروتوكول (Local / CMIS / S3 / SharePoint) ووفّر نقطة النهاية والحاوية", "Choose the protocol (Local / CMIS / S3 / SharePoint) and provide the endpoint + bucket"),
			catBi("لعرض توضيحي قابل للعكس استخدم خلفية local (غير WORM، بلا اعتمادية خارجية)", "For a reversible demo use the local backend (non-WORM, no external dependency)"),
			catBi("وفّر بيانات الوصول مع تفعيل WORM لحفظ السجلات", "Provide access credentials with WORM object-lock enabled for records retention"),
			catBi("للامتثال (PDPL) أبقِ التخزين داخل المملكة", "For PDPL compliance keep storage in-Kingdom"),
		},
		KsaTags:   []string{"records", "worm", "pdpl", "in_kingdom", "local"},
		SelfServe: true,
	},
	model.IntegrationKindEmail: {
		Kind:     model.IntegrationKindEmail,
		Maturity: MaturityProduction,
		PrerequisiteSteps: []forms.LocalizedText{
			catBi("وفّر بيانات SMTP الصادرة وعنوان المرسل", "Provide outbound SMTP settings and the from address"),
			catBi("للبريد الوارد سجّل رابط الاستدعاء وسرّ التحقق", "For inbound intake register the webhook URL and signing secret"),
		},
		CallbackTemplates: map[string]string{
			"Inbound intake webhook": "/webhooks/lex/email/{tenantID}",
		},
		KsaTags:   []string{"email", "intake"},
		SelfServe: true,
	},
	model.IntegrationKindInternal: {
		Kind:     model.IntegrationKindInternal,
		Maturity: MaturityProduction,
		PrerequisiteSteps: []forms.LocalizedText{
			catBi("وفّر الرابط الأساسي للنظام الداخلي ونظام المصادقة", "Provide the internal system base URL and the auth scheme"),
			catBi("للتوقيع باستخدام HMAC شارك السرّ مع النظام المستقبِل", "For HMAC signing share the secret with the receiving system"),
		},
		KsaTags:   []string{"internal", "rest"},
		SelfServe: true,
	},
	// Othaim PRD 14.2 — Yardi property-management / real-estate ERP. Self-serve REST
	// pull connector: no government onboarding gate, but the tenant supplies their own
	// Yardi Voyager/Interface base URL + credentials + DB routing identifiers.
	model.IntegrationKindYardi: {
		Kind:     model.IntegrationKindYardi,
		Maturity: MaturityProduction,
		PrerequisiteSteps: []forms.LocalizedText{
			catBi("احصل من مسؤول ياردي على الرابط الأساسي لواجهة Voyager/Interface مع اعتماد OAuth أو مفتاح API", "Obtain the Yardi Voyager/Interface API base URL plus an OAuth client or API key from the Yardi admin"),
			catBi("امنح نطاقات القراءة لعقود الإيجار والعقارات (واختيارياً الكتابة للملاحظات)", "Grant read scopes for leases + properties (and optionally write scope for notes)"),
			catBi("ابدأ في البيئة التجريبية (sandbox) قبل التفعيل في الإنتاج", "Start in the sandbox environment before activating production"),
		},
		KsaTags:   []string{"property", "real_estate", "erp", "lease"},
		SelfServe: true,
	},
}

// catBi is a terse bilingual-text constructor for catalog copy.
func catBi(ar, en string) forms.LocalizedText { return forms.LocalizedText{AR: ar, EN: en} }

// Catalog returns the connector catalog for every known kind, sorted by kind for
// a stable console gallery order. It is tenant-agnostic and secret-free.
func Catalog() []CatalogEntry {
	out := make([]CatalogEntry, 0, len(integrationCatalog))
	for _, entry := range integrationCatalog {
		out = append(out, entry)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Kind < out[j].Kind })
	return out
}

// CatalogFor returns the catalog entry for a single kind. The bool reports whether
// the kind is catalogued.
func CatalogFor(kind model.IntegrationKind) (CatalogEntry, bool) {
	entry, ok := integrationCatalog[kind]
	return entry, ok
}
