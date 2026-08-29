package errors

// localizedMessages maps a stable, machine-readable AppError Code to its
// bilingual (English / Saudi MSA Arabic) user-facing message. The Code — not
// the baked-in English Message — is the durable API contract, so this catalog
// is the single source of truth where a code resolves to display copy per
// locale (see internal/suiteapi.WriteError, which localizes at the response
// edge).
//
// The Arabic copy is authoritative Saudi Modern Standard Arabic (فصحى, نظامي
// register) and follows the Clario360 legal/technical termbase:
//   - permission            → صلاحية
//   - tenant                → المستأجر
//   - separation of duties  → الفصل بين المهام
//   - authentication        → المصادقة
//   - MFA / SSO             → kept verbatim with an Arabic gloss
//
// Codes here were harvested from AppError constructors and suiteapi.WriteError
// callsites that actually surface across internal/*. Any code NOT listed here
// degrades gracefully to the request's baked-in English Message (never blank),
// so the catalog can be filled in incrementally without breaking callers.
var localizedMessages = map[string]struct{ En, Ar string }{
	// -- Validation / bad input ------------------------------------------
	"VALIDATION_ERROR":  {En: "The request failed validation.", Ar: "فشل التحقق من صحة الطلب."},
	"INVALID_BODY":      {En: "The request body is invalid.", Ar: "محتوى الطلب غير صالح."},
	"INVALID_ID":        {En: "The provided identifier is invalid.", Ar: "المعرّف المُدخَل غير صالح."},
	"INVALID_TENANT_ID": {En: "Tenant id must be a valid UUID.", Ar: "يجب أن يكون معرّف المستأجر بصيغة UUID صالحة."},

	// -- Not found -------------------------------------------------------
	"NOT_FOUND":        {En: "The requested resource was not found.", Ar: "المورد المطلوب غير موجود."},
	"TENANT_NOT_FOUND": {En: "The tenant was not found.", Ar: "المستأجر غير موجود."},

	// -- Authentication / authorization ----------------------------------
	"UNAUTHENTICATED":      {En: "Authentication is required.", Ar: "المصادقة مطلوبة."},
	"UNAUTHORIZED":         {En: "Authentication is required.", Ar: "المصادقة مطلوبة."},
	"FORBIDDEN":            {En: "You do not have access to this resource.", Ar: "لا تملك صلاحية الوصول إلى هذا المورد."},
	"PERMISSION_DENIED":    {En: "You do not have permission to perform this action.", Ar: "لا تملك الصلاحية لتنفيذ هذا الإجراء."},
	"ENTITLEMENT_REQUIRED": {En: "A license entitlement is required to access this feature.", Ar: "يلزم استحقاق ترخيص للوصول إلى هذه الميزة."},
	"TOKEN_EXPIRED":        {En: "The session token has expired.", Ar: "انتهت صلاحية رمز الجلسة."},
	"MFA_REQUIRED":         {En: "Multi-factor authentication (MFA) is required.", Ar: "المصادقة متعددة العوامل (MFA) مطلوبة."},
	"SSO_NOT_CONFIGURED":   {En: "No identity provider is configured for single sign-on (SSO).", Ar: "لم يُهيَّأ مزوّد هوية للدخول الموحّد (SSO)."},

	// -- Conflict / governance -------------------------------------------
	"CONFLICT":           {En: "The request conflicts with the current state of the resource.", Ar: "يتعارض الطلب مع الحالة الحالية للمورد."},
	"SOD_CONFLICT":       {En: "This action violates a separation-of-duties control.", Ar: "يخالف هذا الإجراء ضابط الفصل بين المهام."},
	"SOD_RESOLVE_FAILED": {En: "Failed to resolve the target record for the separation-of-duties check.", Ar: "تعذّر تحديد السجل المستهدف للتحقق من الفصل بين المهام."},

	// -- Rate limiting / upstream ----------------------------------------
	"RATE_LIMITED":   {En: "Rate limit exceeded. Please try again later.", Ar: "تم تجاوز الحد المسموح من الطلبات، يُرجى المحاولة لاحقًا."},
	"PROVIDER_ERROR": {En: "An upstream provider returned an error.", Ar: "أرجع المزوّد الخارجي خطأً."},

	// -- Generic CRUD / internal -----------------------------------------
	"LIST_FAILED":    {En: "Failed to load the list.", Ar: "تعذّر تحميل القائمة."},
	"GET_FAILED":     {En: "Failed to retrieve the record.", Ar: "تعذّر استرجاع السجل."},
	"CREATE_FAILED":  {En: "Failed to create the record.", Ar: "تعذّر إنشاء السجل."},
	"UPDATE_FAILED":  {En: "Failed to update the record.", Ar: "تعذّر تحديث السجل."},
	"DELETE_FAILED":  {En: "Failed to delete the record.", Ar: "تعذّر حذف السجل."},
	"INTERNAL_ERROR": {En: "An internal server error occurred.", Ar: "حدث خطأ داخلي في الخادم."},

	// -- Lex (Watheeq) suite-specific ------------------------------------
	// Codes surfaced by lex handlers/services. Callsites that pass an
	// interpolated message (e.g. LEGAL_HOLD_ACTIVE names the held subject id)
	// keep that specific text via Localize's baked-in-Message precedence; the
	// copy here is the generic per-code fallback used when the Message is empty.
	"NOT_CONFIGURED":                              {En: "This feature is not configured for this deployment.", Ar: "هذه الميزة غير مُهيّأة لهذا النشر."},
	"DRAFTING_UNAVAILABLE":                        {En: "AI drafting is not available for this deployment.", Ar: "خدمة الصياغة بالذكاء الاصطناعي غير متاحة لهذا النشر."},
	"DRAFTING_TIMEOUT":                            {En: "AI drafting took too long and was stopped. Your input is still available; try again or enter the text manually.", Ar: "استغرقت الصياغة بالذكاء الاصطناعي وقتًا طويلًا وتم إيقافها. ما زالت مدخلاتك محفوظة؛ أعد المحاولة أو أدخل النص يدويًا."},
	"DRAFTING_PROVIDER_ERROR":                     {En: "The AI drafting provider could not complete this request. Your input is still available; try again or enter the text manually.", Ar: "تعذّر على مزوّد الصياغة بالذكاء الاصطناعي إكمال هذا الطلب. ما زالت مدخلاتك محفوظة؛ أعد المحاولة أو أدخل النص يدويًا."},
	"DRAFTING_NO_OUTPUT":                          {En: "The AI model did not return a structured draft.", Ar: "لم يُرجع نموذج الذكاء الاصطناعي مسودة منظمة."},
	"SECOND_BRAIN_UNAVAILABLE":                    {En: "The knowledge assistant is currently unavailable.", Ar: "مساعد المعرفة غير متاح حاليًا."},
	"STREAM_UNSUPPORTED":                          {En: "Streaming is not supported for this request.", Ar: "البث المباشر غير مدعوم لهذا الطلب."},
	"UNSUPPORTED_FORMAT":                          {En: "The requested export format is not supported.", Ar: "صيغة التصدير المطلوبة غير مدعومة."},
	"LEGAL_HOLD_ACTIVE":                           {En: "The subject is under an active legal hold and cannot be deleted, archived, or modified.", Ar: "الموضوع خاضع لحجز قانوني نشط ولا يمكن حذفه أو أرشفته أو تعديله."},
	"PERSONA_NOT_AVAILABLE":                       {En: "The requested role is not one of your available legal personas.", Ar: "الدور المطلوب ليس من ضمن الشخصيات القانونية المتاحة لك."},
	"REFERENCE_LIBRARY_INVALID_KEY":               {En: "The reference library storage key is invalid.", Ar: "مفتاح تخزين مكتبة المراجع غير صالح."},
	"REFERENCE_LIBRARY_STORAGE_UNCONFIGURED":      {En: "Reference library storage is not configured.", Ar: "لم يُهيَّأ تخزين مكتبة المراجع."},
	"REFERENCE_LIBRARY_NO_LIBRARY_TENANT":         {En: "No reference library tenant is configured.", Ar: "لم يُهيَّأ مستأجر لمكتبة المراجع."},
	"REFERENCE_LIBRARY_FILE_SERVICE_UNCONFIGURED": {En: "The reference library file service is not configured.", Ar: "لم تُهيَّأ خدمة ملفات مكتبة المراجع."},
	"REFERENCE_LIBRARY_FILE_SERVICE_UNAVAILABLE":  {En: "The reference library file service is unavailable.", Ar: "خدمة ملفات مكتبة المراجع غير متاحة."},
	"LEGAL_REQUEST_FILE_SERVICE_UNCONFIGURED":     {En: "The legal request file service is not configured.", Ar: "لم تُهيَّأ خدمة ملفات الطلبات القانونية."},
	"LEGAL_REQUEST_FILE_SERVICE_UNAVAILABLE":      {En: "The legal request file service is unavailable.", Ar: "خدمة ملفات الطلبات القانونية غير متاحة."},
}

// Localize returns the user-facing message for this error in the requested
// locale ("ar" or "en"), resolved from the bilingual catalog by Code.
//
// A concrete baked-in Message always wins: when the caller supplied a specific
// Message — a field-level VALIDATION_ERROR detail, an interpolated id, or any
// other handler-specific copy — it is returned verbatim rather than flattened to
// the catalog's generic per-code sentence, so that specificity is never
// discarded. The localized catalog copy is used only for a catalogued Code whose
// Message is empty. It otherwise falls back to the baked-in English Message when
// the Code is absent from the catalog, when the locale is unknown, or when a
// translation is missing — so it degrades gracefully and never returns a blank
// string for a populated error.
func (e *AppError) Localize(locale string) string {
	if e == nil {
		return ""
	}
	entry, ok := localizedMessages[e.Code]
	if !ok || e.Message != "" {
		// Uncatalogued code, or the caller supplied a specific baked-in
		// message: prefer that concrete message over the generic catalog copy.
		return e.Message
	}

	var msg string
	switch locale {
	case "ar":
		msg = entry.Ar
	case "en":
		msg = entry.En
	default:
		// Unknown locale: degrade to the baked-in (English) message.
		return e.Message
	}

	if msg == "" {
		// Missing translation for this locale: never return blank.
		if e.Message != "" {
			return e.Message
		}
		if entry.En != "" {
			return entry.En
		}
		return entry.Ar
	}
	return msg
}
