package export

import (
	"bytes"
	"fmt"
	"strconv"

	"github.com/jung-kurt/gofpdf"

	"github.com/clario360/platform/internal/forms"
	"github.com/clario360/platform/internal/pricing/model"
)

const pdfContentTypeQuote = "application/pdf"

// PDF layout (A4, mm).
const (
	pdfMargin   = 15.0
	pdfPageW    = 210.0
	pdfContentW = pdfPageW - 2*pdfMargin
)

// Report localization notes
// ==========================
//
// Report string LITERALS are routed through quoteLabels — a per-report label
// table keyed by a stable slug and resolved by the report's locale — so the same
// generator can emit an English or an Arabic quote. renderPDFLocalized is the
// locale-aware entrypoint; renderPDF keeps the legacy no-locale signature (English)
// so existing callers stay unchanged.
//
// gofpdf LIMITATION (do not "fix" here): the vendored gofpdf ships only the core
// Latin PDF fonts and performs NO Arabic glyph shaping or bidi reordering. Feeding
// it the Arabic strings below produces missing-glyph / visually-broken output. The
// locale threading + right-alignment ('R') implemented here is the SAFE, compiling
// scaffolding only. For a customer-facing Arabic quote PDF, render via the
// HTML->PDF path (headless Chrome / chromedp) which gets RTL + shaping for free from
// the browser and can reuse the notification-service email RTL CSS
// (internal/notification/service/template_service.go baseLayoutTemplate:
// dir="rtl", text-align:right). See RenderEvidenceHTML in internal/recover for the
// reference "HTML half" of that path. Keep gofpdf for internal/English artifacts.

const (
	localeEN = "en"
	localeAR = "ar"
)

// reportLocaleDefault is the tenant/product default locale for customer-facing
// reports (Watheeq / KSA tenants default to Arabic, matching the frontend). It is
// applied by renderPDFLocalized when the caller passes an empty locale. The legacy
// renderPDF wrapper passes localeEN explicitly so its output never regresses while
// the gofpdf Arabic-shaping gap is open.
const reportLocaleDefault = localeAR

// normalizeReportLocale collapses an arbitrary locale tag to the two supported
// report locales, defaulting to the tenant/product default when unset.
func normalizeReportLocale(locale string) string {
	switch locale {
	case localeAR:
		return localeAR
	case localeEN:
		return localeEN
	case "":
		return reportLocaleDefault
	default:
		if len(locale) >= 2 && locale[:2] == "ar" {
			return localeAR
		}
		return localeEN
	}
}

// alignFor returns the gofpdf cell alignment for a locale ("R" right-aligns Arabic
// text, "L" left-aligns Latin).
func alignFor(locale string) string {
	if locale == localeAR {
		return "R"
	}
	return "L"
}

// localizeLabel resolves a report label slug to text in the requested locale via
// forms.LocalizedText (the canonical backend bilingual string type, with built-in
// other-locale fallback). An unknown slug falls back to the slug itself so a
// missing entry is visible rather than blank.
func localizeLabel(cat map[string]forms.LocalizedText, key, locale string) string {
	if lt, ok := cat[key]; ok {
		return lt.Localize(locale)
	}
	return key
}

// quoteLabels is the per-report label table for the pricing quote PDF. Arabic copy
// follows the Saudi-MSA termbase (frontend/scripts/i18n-glossary.json): quote =
// عرض سعر, pricing = التسعير, discount = خصم, volume discount = خصم الكمية,
// VAT = ضريبة القيمة المضافة, contract = عقد, status = الحالة, currency = العملة.
// Product names (Clario360) are kept verbatim per the acronym/proper-noun policy.
var quoteLabels = map[string]forms.LocalizedText{
	"title":            {EN: "Clario360 Pricing Quote", AR: "عرض سعر Clario360"},
	"quote_ref":        {EN: "Quote", AR: "عرض السعر"},
	"account":          {EN: "Account", AR: "الحساب"},
	"model":            {EN: "Model", AR: "النموذج"},
	"pricing_version":  {EN: "Pricing Version", AR: "إصدار التسعير"},
	"currency":         {EN: "Currency", AR: "العملة"},
	"status":           {EN: "Status", AR: "الحالة"},
	"selected_tier":    {EN: "Selected Tier", AR: "الباقة المختارة"},
	"line_item":        {EN: "Line Item", AR: "البند"},
	"base_charge":      {EN: "Base Charge", AR: "الرسوم الأساسية"},
	"ai_allocation":    {EN: "AI Allocation", AR: "تخصيص الذكاء الاصطناعي"},
	"data_storage":     {EN: "Data Storage", AR: "تخزين البيانات"},
	"vm_infra":         {EN: "VM Infrastructure", AR: "البنية التحتية للأجهزة الافتراضية"},
	"deployment_setup": {EN: "Deployment Setup", AR: "إعداد النشر"},
	"sub_total":        {EN: "Sub Total", AR: "المجموع الفرعي"},
	"volume_discount":  {EN: "Volume Discount", AR: "خصم الكمية"},
	"term_discount":    {EN: "Term Discount", AR: "خصم المدة"},
	"sales_discount":   {EN: "Sales Discount", AR: "خصم المبيعات"},
	"net_sub_total":    {EN: "Net Sub Total", AR: "صافي المجموع الفرعي"},
	"vat":              {EN: "VAT", AR: "ضريبة القيمة المضافة"},
	"total_monthly":    {EN: "Total Monthly", AR: "الإجمالي الشهري"},
	"contract_value":   {EN: "Contract Value", AR: "قيمة العقد"},
	"footer_pre":       {EN: "All amounts in ", AR: "جميع المبالغ بعملة "},
	"footer_post": {
		EN: ", inclusive of VAT where shown. This quote is generated by the Clario360 platform.",
		AR: "، شاملةً ضريبة القيمة المضافة حيثما ظهرت. تم إنشاء عرض السعر هذا بواسطة منصة Clario360.",
	},
}

// renderPDF renders the MASKED ClientView as a client-facing quote PDF using the
// vendored gofpdf. Because it takes a ClientView (tiers are ClientTier), there is
// no internal margin field available to print — the governance property holds by
// construction. It preserves the legacy (English) signature; renderPDFLocalized is
// the locale-aware entrypoint.
func renderPDF(v model.ClientView) (*Rendered, error) {
	return renderPDFLocalized(v, localeEN)
}

// renderPDFLocalized renders the MASKED ClientView as a quote PDF in the requested
// locale, resolving every label through quoteLabels and right-aligning cells for
// Arabic. See the "gofpdf LIMITATION" note above: for a shaped, customer-facing
// Arabic PDF use the HTML->PDF path — this function is the label-catalog + locale
// threading + alignment scaffolding.
func renderPDFLocalized(v model.ClientView, locale string) (*Rendered, error) {
	locale = normalizeReportLocale(locale)
	align := alignFor(locale)
	lbl := func(key string) string { return localizeLabel(quoteLabels, key, locale) }

	pdf := gofpdf.New("P", "mm", "A4", "")
	pdf.SetTitle(lbl("title")+" "+v.QuoteNumber, false)
	pdf.SetAutoPageBreak(true, pdfMargin)
	pdf.AddPage()

	// Title.
	pdf.SetFont("Helvetica", "B", 16)
	pdf.CellFormat(pdfContentW, 9, lbl("title"), "", 1, align, false, 0, "")
	pdf.SetFont("Helvetica", "", 9)
	pdf.SetTextColor(90, 90, 90)
	pdf.CellFormat(pdfContentW, 5, lbl("quote_ref")+" "+v.QuoteNumber, "", 1, align, false, 0, "")
	pdf.SetTextColor(0, 0, 0)
	pdf.Ln(3)

	// Meta block.
	kv := func(k, val string) {
		pdf.SetFont("Helvetica", "B", 9)
		pdf.CellFormat(45, 5, k, "", 0, align, false, 0, "")
		pdf.SetFont("Helvetica", "", 9)
		pdf.CellFormat(pdfContentW-45, 5, val, "", 1, align, false, 0, "")
	}
	kv(lbl("account"), v.AccountName)
	kv(lbl("model"), modelLabel(v.Model))
	kv(lbl("pricing_version"), strconv.Itoa(v.PricingVersion))
	kv(lbl("currency"), v.Currency)
	kv(lbl("status"), v.Status)
	if v.SelectedTier != nil {
		kv(lbl("selected_tier"), tierLabel(*v.SelectedTier))
	}
	pdf.Ln(3)

	// Tier comparison table. Column layout: label + one column per tier.
	labelW := 50.0
	tierW := (pdfContentW - labelW) / float64(max(1, len(v.Tiers)))

	pdf.SetFont("Helvetica", "B", 9)
	pdf.SetFillColor(230, 230, 230)
	pdf.CellFormat(labelW, 7, lbl("line_item"), "1", 0, align, true, 0, "")
	for _, t := range v.Tiers {
		pdf.CellFormat(tierW, 7, tierLabel(t.Tier), "1", 0, "R", true, 0, "")
	}
	pdf.Ln(-1)

	metricRow := func(labelKey string, pick func(model.ClientTier) float64, bold bool) {
		if bold {
			pdf.SetFont("Helvetica", "B", 9)
		} else {
			pdf.SetFont("Helvetica", "", 9)
		}
		pdf.CellFormat(labelW, 6, lbl(labelKey), "1", 0, align, false, 0, "")
		for _, t := range v.Tiers {
			pdf.CellFormat(tierW, 6, fmtMoney(pick(t)), "1", 0, "R", false, 0, "")
		}
		pdf.Ln(-1)
	}

	metricRow("base_charge", func(t model.ClientTier) float64 { return t.LineItems.BaseCharge }, false)
	metricRow("ai_allocation", func(t model.ClientTier) float64 { return t.LineItems.AIAllocation }, false)
	metricRow("data_storage", func(t model.ClientTier) float64 { return t.LineItems.DataStorage }, false)
	metricRow("vm_infra", func(t model.ClientTier) float64 { return t.LineItems.VMInfrastructure }, false)
	metricRow("deployment_setup", func(t model.ClientTier) float64 { return t.LineItems.DeploymentSetupPremium }, false)
	metricRow("sub_total", func(t model.ClientTier) float64 { return t.SubTotal }, true)
	metricRow("volume_discount", func(t model.ClientTier) float64 { return t.VolumeDiscount }, false)
	metricRow("term_discount", func(t model.ClientTier) float64 { return t.TermDiscount }, false)
	metricRow("sales_discount", func(t model.ClientTier) float64 { return t.SalesDiscount }, false)
	metricRow("net_sub_total", func(t model.ClientTier) float64 { return t.NetSubTotal }, true)
	metricRow("vat", func(t model.ClientTier) float64 { return t.VAT }, false)
	metricRow("total_monthly", func(t model.ClientTier) float64 { return t.TotalMonthly }, true)
	metricRow("contract_value", func(t model.ClientTier) float64 { return t.ContractValue }, true)

	pdf.Ln(4)
	pdf.SetFont("Helvetica", "I", 8)
	pdf.SetTextColor(120, 120, 120)
	pdf.MultiCell(pdfContentW, 4, lbl("footer_pre")+v.Currency+lbl("footer_post"), "", align, false)

	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, fmt.Errorf("pdf: rendering quote: %w", err)
	}
	return &Rendered{
		Bytes:       buf.Bytes(),
		ContentType: pdfContentTypeQuote,
		Filename:    v.QuoteNumber + ".pdf",
	}, nil
}

// fmtMoney formats a SAR amount to 2 dp for display.
func fmtMoney(v float64) string {
	return strconv.FormatFloat(v, 'f', 2, 64)
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
