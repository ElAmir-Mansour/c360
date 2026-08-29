package export

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"strconv"

	"github.com/clario360/platform/internal/pricing/model"
)

// ErrUnsupportedFormat is returned by Render for an unknown format.
var ErrUnsupportedFormat = errors.New("unsupported export format")

const xlsxContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

// A .xlsx is a ZIP (OPC package) of a handful of XML parts. We emit the minimal
// set that Excel/LibreOffice open: content-types, package + workbook rels, the
// workbook, and one worksheet. All values are inline strings or numbers, so no
// sharedStrings part is needed. This keeps the exporter dependency-free.

// row is one worksheet row: a label column and zero-or-more value cells. Numeric
// cells are emitted as <c t="n"> so spreadsheet apps treat totals as numbers.
type cell struct {
	text    string
	isNum   bool
	numeric float64
}

func textCell(s string) cell { return cell{text: s} }
func numCell(v float64) cell { return cell{isNum: true, numeric: v} }
func blankCell() cell        { return cell{} }

// renderXLSX builds a single-sheet workbook from the MASKED ClientView. Because
// the input is a ClientView (tiers are ClientTier), there is no internal margin
// field to emit — the governance property holds by construction.
func renderXLSX(v model.ClientView) (*Rendered, error) {
	rows := buildRows(v)
	sheetXML := buildSheetXML(rows)

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	parts := []struct {
		name string
		data string
	}{
		{"[Content_Types].xml", contentTypesXML},
		{"_rels/.rels", rootRelsXML},
		{"xl/workbook.xml", workbookXML},
		{"xl/_rels/workbook.xml.rels", workbookRelsXML},
		{"xl/worksheets/sheet1.xml", sheetXML},
	}
	for _, p := range parts {
		w, err := zw.Create(p.name)
		if err != nil {
			return nil, fmt.Errorf("xlsx: creating part %s: %w", p.name, err)
		}
		if _, err := w.Write([]byte(p.data)); err != nil {
			return nil, fmt.Errorf("xlsx: writing part %s: %w", p.name, err)
		}
	}
	if err := zw.Close(); err != nil {
		return nil, fmt.Errorf("xlsx: closing zip: %w", err)
	}

	return &Rendered{
		Bytes:       buf.Bytes(),
		ContentType: xlsxContentType,
		Filename:    v.QuoteNumber + ".xlsx",
	}, nil
}

// buildRows produces the client-facing table for the quote. It reads ONLY
// ClientTier fields (base_charge / ai_allocation / storage / vm / setup /
// sub_total / discounts / net / vat / total_monthly / contract_value). There is
// no internal-cost, margin, or markup field on ClientTier to include.
func buildRows(v model.ClientView) [][]cell {
	rows := [][]cell{
		{textCell("Clario360 Pricing Quote")},
		{textCell("Quote Number"), textCell(v.QuoteNumber)},
		{textCell("Account"), textCell(v.AccountName)},
		{textCell("Model"), textCell(modelLabel(v.Model))},
		{textCell("Pricing Version"), numCell(float64(v.PricingVersion))},
		{textCell("Currency"), textCell(v.Currency)},
		{textCell("Status"), textCell(v.Status)},
		{},
	}

	// Header row: metric label + one column per tier.
	header := []cell{textCell("Line Item")}
	for _, t := range v.Tiers {
		header = append(header, textCell(tierLabel(t.Tier)))
	}
	rows = append(rows, header)

	metric := func(label string, pick func(model.ClientTier) float64) []cell {
		r := []cell{textCell(label)}
		for _, t := range v.Tiers {
			r = append(r, numCell(pick(t)))
		}
		return r
	}

	rows = append(rows,
		metric("Base Charge", func(t model.ClientTier) float64 { return t.LineItems.BaseCharge }),
		metric("AI Allocation", func(t model.ClientTier) float64 { return t.LineItems.AIAllocation }),
		metric("Data Storage", func(t model.ClientTier) float64 { return t.LineItems.DataStorage }),
		metric("VM Infrastructure", func(t model.ClientTier) float64 { return t.LineItems.VMInfrastructure }),
		metric("Deployment Setup Premium", func(t model.ClientTier) float64 { return t.LineItems.DeploymentSetupPremium }),
		metric("Sub Total", func(t model.ClientTier) float64 { return t.SubTotal }),
		metric("Volume Discount", func(t model.ClientTier) float64 { return t.VolumeDiscount }),
		metric("Term Discount", func(t model.ClientTier) float64 { return t.TermDiscount }),
		metric("Sales Discount", func(t model.ClientTier) float64 { return t.SalesDiscount }),
		metric("Net Sub Total", func(t model.ClientTier) float64 { return t.NetSubTotal }),
		metric("VAT", func(t model.ClientTier) float64 { return t.VAT }),
		metric("Total Monthly", func(t model.ClientTier) float64 { return t.TotalMonthly }),
		metric("Contract Value", func(t model.ClientTier) float64 { return t.ContractValue }),
	)

	if v.SelectedTier != nil {
		rows = append(rows, []cell{}, []cell{textCell("Selected Tier"), textCell(tierLabel(*v.SelectedTier))})
	}
	return rows
}

// buildSheetXML serializes the rows into worksheet XML. Cell refs (A1/B1/...)
// are computed by index; values are XML-escaped.
func buildSheetXML(rows [][]cell) string {
	var b bytes.Buffer
	b.WriteString(xml.Header)
	b.WriteString(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`)
	for r, row := range rows {
		rowNum := r + 1
		b.WriteString(`<row r="` + strconv.Itoa(rowNum) + `">`)
		for c, cl := range row {
			ref := columnName(c) + strconv.Itoa(rowNum)
			if cl.isNum {
				b.WriteString(`<c r="` + ref + `" t="n"><v>` + strconv.FormatFloat(cl.numeric, 'f', -1, 64) + `</v></c>`)
			} else if cl.text != "" {
				b.WriteString(`<c r="` + ref + `" t="inlineStr"><is><t xml:space="preserve">` + escapeXML(cl.text) + `</t></is></c>`)
			}
		}
		b.WriteString(`</row>`)
	}
	b.WriteString(`</sheetData></worksheet>`)
	return b.String()
}

// columnName converts a 0-based column index to a spreadsheet column name
// (0->A, 25->Z, 26->AA).
func columnName(idx int) string {
	name := ""
	idx++
	for idx > 0 {
		idx--
		name = string(rune('A'+idx%26)) + name
		idx /= 26
	}
	return name
}

func escapeXML(s string) string {
	var buf bytes.Buffer
	_ = xml.EscapeText(&buf, []byte(s))
	return buf.String()
}

const contentTypesXML = xml.Header + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
	`<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
	`<Default Extension="xml" ContentType="application/xml"/>` +
	`<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
	`<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
	`</Types>`

const rootRelsXML = xml.Header + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
	`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
	`</Relationships>`

const workbookXML = xml.Header + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
	`<sheets><sheet name="Quote" sheetId="1" r:id="rId1"/></sheets></workbook>`

const workbookRelsXML = xml.Header + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
	`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
	`</Relationships>`
