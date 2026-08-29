package handler

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rs/zerolog"
)

func TestOrgImportTemplateBlankAndFilledCSV(t *testing.T) {
	h := NewOrgEntityHandler(nil, zerolog.Nop())
	blank := httptest.NewRecorder()
	h.ImportTemplate(blank, httptest.NewRequest(http.MethodGet, "/?format=csv", nil))
	if blank.Code != http.StatusOK {
		t.Fatalf("blank status=%d", blank.Code)
	}
	if !strings.Contains(blank.Header().Get("Content-Disposition"), "template.csv") {
		t.Fatalf("blank filename=%q", blank.Header().Get("Content-Disposition"))
	}
	if lines := strings.Count(strings.TrimSpace(blank.Body.String()), "\n"); lines != 0 {
		t.Fatalf("blank template has data rows: %q", blank.Body.String())
	}

	filled := httptest.NewRecorder()
	h.ImportTemplate(filled, httptest.NewRequest(http.MethodGet, "/?format=csv&sample=true", nil))
	if filled.Code != http.StatusOK {
		t.Fatalf("sample status=%d", filled.Code)
	}
	if !strings.Contains(filled.Header().Get("Content-Disposition"), "filled-sample.csv") {
		t.Fatalf("sample filename=%q", filled.Header().Get("Content-Disposition"))
	}
	for _, value := range []string{"ACME", "LEGAL", "CONTRACTS", "parent_code", "role_key", "role_holder_user_id"} {
		if !strings.Contains(filled.Body.String(), value) {
			t.Fatalf("filled sample missing %q", value)
		}
	}
	for _, advanced := range []string{"manager_user_id", "roles_json", "metadata_json", "employees_json"} {
		if strings.Contains(filled.Body.String(), advanced) {
			t.Fatalf("demo sample unexpectedly contains advanced column %q", advanced)
		}
	}
}

func TestOrgImportTemplateFilledJSONAndXLSX(t *testing.T) {
	h := NewOrgEntityHandler(nil, zerolog.Nop())
	jsonResponse := httptest.NewRecorder()
	h.ImportTemplate(jsonResponse, httptest.NewRequest(http.MethodGet, "/?format=json&sample=true", nil))
	var rows []map[string]any
	if err := json.Unmarshal(jsonResponse.Body.Bytes(), &rows); err != nil {
		t.Fatalf("decode JSON: %v", err)
	}
	if len(rows) != 5 {
		t.Fatalf("JSON rows=%d want 5", len(rows))
	}

	xlsxResponse := httptest.NewRecorder()
	h.ImportTemplate(xlsxResponse, httptest.NewRequest(http.MethodGet, "/?format=xlsx&sample=true", nil))
	zr, err := zip.NewReader(bytes.NewReader(xlsxResponse.Body.Bytes()), int64(xlsxResponse.Body.Len()))
	if err != nil {
		t.Fatalf("open XLSX: %v", err)
	}
	var worksheet string
	for _, file := range zr.File {
		if file.Name != "xl/worksheets/sheet1.xml" {
			continue
		}
		reader, openErr := file.Open()
		if openErr != nil {
			t.Fatal(openErr)
		}
		body, readErr := io.ReadAll(reader)
		_ = reader.Close()
		if readErr != nil {
			t.Fatal(readErr)
		}
		worksheet = string(body)
	}
	if !strings.Contains(worksheet, "ACME") || !strings.Contains(worksheet, "Contracts") {
		t.Fatal("filled XLSX lacks sample rows")
	}
	if strings.Contains(worksheet, "manager_user_id") || strings.Contains(worksheet, "roles_json") {
		t.Fatal("filled XLSX contains advanced demo columns")
	}
	if !strings.Contains(worksheet, "role_key") || !strings.Contains(worksheet, "legal_director") {
		t.Fatal("filled XLSX lacks simple role columns")
	}
}

func TestOrgImportTemplateRejectsInvalidSampleFlag(t *testing.T) {
	h := NewOrgEntityHandler(nil, zerolog.Nop())
	response := httptest.NewRecorder()
	h.ImportTemplate(response, httptest.NewRequest(http.MethodGet, "/?format=csv&sample=maybe", nil))
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status=%d want 400", response.Code)
	}
}
