// Package export renders a client-facing quote document (PDF or XLSX).
//
// GOVERNANCE (hard rule): the exporter accepts ONLY model.ClientView — the
// masked, client-facing quote shape whose tiers are []model.ClientTier. That
// type PHYSICALLY LACKS internal_cost / gross_profit / realized_margin / markup
// and the per-unit build-up rates, so those figures can NEVER appear in a
// client-facing export by construction, regardless of the caller's role or any
// query flag. Masking is enforced by the type the exporter takes, not by a
// runtime toggle.
//
// XLSX is written as minimal Office Open XML (a .xlsx is a zip of XML parts) via
// archive/zip + encoding/xml — no third-party dependency. PDF uses the already
// vendored github.com/jung-kurt/gofpdf.
package export

import (
	"github.com/clario360/platform/internal/pricing/model"
)

// Format is the requested export format.
type Format string

const (
	FormatXLSX Format = "xlsx"
	FormatPDF  Format = "pdf"
)

// ParseFormat validates a format string.
func ParseFormat(s string) (Format, bool) {
	switch Format(s) {
	case FormatXLSX:
		return FormatXLSX, true
	case FormatPDF:
		return FormatPDF, true
	}
	return "", false
}

// Rendered is an encoded export document.
type Rendered struct {
	Bytes       []byte
	ContentType string
	Filename    string
}

// tierLabel returns the human title-cased tier name for headings.
func tierLabel(t model.Tier) string {
	switch t {
	case model.TierStandard:
		return "Standard"
	case model.TierGrowth:
		return "Growth"
	case model.TierProfessional:
		return "Professional"
	case model.TierCustomized:
		return "Customized"
	}
	return string(t)
}

// modelLabel renders the pricing model for display.
func modelLabel(m model.Model) string {
	switch m {
	case model.ModelPerUser:
		return "Per User"
	case model.ModelPerCore:
		return "Per Core"
	}
	return string(m)
}

// Render dispatches to the requested format. The input is the MASKED ClientView
// only — the internal margin block is not reachable from here.
func Render(format Format, v model.ClientView) (*Rendered, error) {
	switch format {
	case FormatXLSX:
		return renderXLSX(v)
	case FormatPDF:
		return renderPDF(v)
	}
	return nil, ErrUnsupportedFormat
}
