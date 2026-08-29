package seeder

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Arabic (AR) localization for the onboarding catalogs seeded into visus_db.
//
// These helpers write the additive, nullable *_ar sibling columns added by
// migrations/visus_db/000004_localized_text_ar.up.sql. They mirror the
// forms.LocalizedText{EN,AR} model: the existing English columns are never
// touched and remain the canonical fallback, while the AR columns carry the
// Saudi-MSA rendering (grounded in frontend/scripts/i18n-glossary.json).
//
// Every write is best-effort and non-fatal:
//   - localizedColumnExists short-circuits on an UNMIGRATED database (columns
//     absent), leaving the English columns as the sole source.
//   - individual UPDATE errors are swallowed; onboarding must never fail on
//     localization, and a partially back-filled catalog still renders via the
//     English fallback.

// arText pairs the Arabic name/title with its Arabic description for a catalog
// row keyed by the English name/title.
type arText struct {
	AR     string
	DescAR string
}

// dashboardArabic maps the onboarding executive dashboard name to its Saudi-MSA
// rendering (dashboard = لوحة المعلومات).
var dashboardArabic = map[string]arText{
	"Executive Overview": {AR: "النظرة التنفيذية العامة", DescAR: "لوحة معلومات تنفيذية شاملة عبر الأجنحة."},
}

// dashboardWidgetArabic maps each onboarding dashboard widget title to its
// Saudi-MSA rendering (alert = تنبيه, compliance = امتثال, contract = عقد,
// overdue = متأخر).
var dashboardWidgetArabic = map[string]string{
	"Risk Score":         "درجة المخاطر",
	"Critical Alerts":    "التنبيهات الحرجة",
	"Quality Score":      "درجة الجودة",
	"Compliance Score":   "درجة الامتثال",
	"Alert Trend":        "اتجاه التنبيهات",
	"Pipeline Status":    "حالة خطوط البيانات",
	"Expiring Contracts": "العقود قريبة الانتهاء",
	"Overdue Actions":    "الإجراءات المتأخرة",
}

// kpiArabic maps each seeded KPI name (as written by KPISeeder, including the
// MTTR / MITRE Coverage renames) to its Saudi-MSA name and description. Acronyms
// are kept verbatim and glossed per the termbase policy. The ClarioDR KPIs are
// intentionally omitted (DR is out of scope this wave) and fall back to English.
var kpiArabic = map[string]arText{
	"Security Risk Score":    {AR: "درجة المخاطر الأمنية", DescAR: "درجة المخاطر الأمنية"},
	"Open Critical Alerts":   {AR: "التنبيهات الحرجة المفتوحة", DescAR: "التنبيهات الحرجة المفتوحة"},
	"MTTR":                   {AR: "متوسط زمن الاستجابة (MTTR)", DescAR: "متوسط زمن الاستجابة"},
	"MITRE Coverage":         {AR: "تغطية MITRE ATT&CK", DescAR: "تغطية إطار MITRE ATT&CK"},
	"Data Quality Score":     {AR: "درجة جودة البيانات", DescAR: "درجة جودة البيانات"},
	"Pipeline Success Rate":  {AR: "معدل نجاح خطوط البيانات", DescAR: "معدل نجاح خطوط البيانات"},
	"Open Contradictions":    {AR: "التناقضات المفتوحة", DescAR: "التناقضات المفتوحة"},
	"Dark Data Assets":       {AR: "أصول البيانات المظلمة", DescAR: "أصول البيانات المظلمة"},
	"Governance Compliance":  {AR: "امتثال الحوكمة", DescAR: "امتثال الحوكمة"},
	"Overdue Action Items":   {AR: "بنود الإجراءات المتأخرة", DescAR: "بنود الإجراءات المتأخرة"},
	"Contracts Expiring 30d": {AR: "العقود المنتهية خلال 30 يومًا", DescAR: "العقود المنتهية خلال 30 يومًا"},
	"High Risk Contracts":    {AR: "العقود عالية المخاطر", DescAR: "العقود عالية المخاطر"},
}

// backfillDashboardArabic writes the AR sibling columns for the onboarding
// executive dashboard and its widgets. Best-effort; a no-op on an unmigrated
// database.
func backfillDashboardArabic(ctx context.Context, pool *pgxpool.Pool, tenantID, dashboardID uuid.UUID) {
	if pool == nil || dashboardID == uuid.Nil {
		return
	}
	if !localizedColumnExists(ctx, pool, "visus_dashboards", "name_ar") {
		return
	}
	if tr, ok := dashboardArabic["Executive Overview"]; ok {
		_, _ = pool.Exec(ctx,
			`UPDATE visus_dashboards SET name_ar = $1, description_ar = $2 WHERE id = $3 AND tenant_id = $4`,
			tr.AR, tr.DescAR, dashboardID, tenantID,
		)
	}
	for enTitle, arTitle := range dashboardWidgetArabic {
		_, _ = pool.Exec(ctx,
			`UPDATE visus_widgets SET title_ar = $1 WHERE dashboard_id = $2 AND tenant_id = $3 AND title = $4`,
			arTitle, dashboardID, tenantID, enTitle,
		)
	}
}

// backfillKPIArabic writes the AR sibling columns for the onboarding KPI
// definitions. Best-effort; a no-op on an unmigrated database.
func backfillKPIArabic(ctx context.Context, pool *pgxpool.Pool, tenantID uuid.UUID) {
	if pool == nil {
		return
	}
	if !localizedColumnExists(ctx, pool, "visus_kpi_definitions", "name_ar") {
		return
	}
	for enName, tr := range kpiArabic {
		_, _ = pool.Exec(ctx,
			`UPDATE visus_kpi_definitions SET name_ar = $1, description_ar = $2 WHERE tenant_id = $3 AND name = $4 AND deleted_at IS NULL`,
			tr.AR, tr.DescAR, tenantID, enName,
		)
	}
}

// localizedColumnExists reports whether the additive localization migration has
// been applied (the given column is present). A query error is treated as
// "absent" so callers safely skip the backfill on an unmigrated database.
func localizedColumnExists(ctx context.Context, pool *pgxpool.Pool, table, column string) bool {
	var exists bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2)`,
		table, column,
	).Scan(&exists); err != nil {
		return false
	}
	return exists
}
