package storage

import (
	"bytes"
	"io"
	"testing"
)

func TestValidate_PDF(t *testing.T) {
	// PDF magic bytes: %PDF
	content := append([]byte("%PDF-1.7 fake pdf content"), make([]byte, 500)...)
	result, err := ValidateContent(bytes.NewReader(content), "application/pdf", "cyber")
	if err != nil {
		t.Fatalf("ValidateContent: %v", err)
	}
	if result.DetectedType != "application/pdf" {
		t.Fatalf("expected detected type application/pdf, got %s", result.DetectedType)
	}
	if result.Blocked {
		t.Fatal("PDF should not be blocked")
	}
	if result.Mismatch {
		t.Fatal("declared matches detected, should not be mismatch")
	}
	if !result.Allowed {
		t.Fatal("PDF should be allowed for cyber suite")
	}
}

func TestValidate_PNG(t *testing.T) {
	// PNG magic bytes: \x89PNG\r\n\x1a\n
	header := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
	content := append(header, make([]byte, 500)...)
	result, err := ValidateContent(bytes.NewReader(content), "image/png", "cyber")
	if err != nil {
		t.Fatalf("ValidateContent: %v", err)
	}
	if result.DetectedType != "image/png" {
		t.Fatalf("expected detected type image/png, got %s", result.DetectedType)
	}
	if result.Blocked {
		t.Fatal("PNG should not be blocked")
	}
	if !result.Allowed {
		t.Fatal("PNG should be allowed for cyber suite")
	}
}

func TestValidate_JPEG(t *testing.T) {
	// JPEG magic bytes: \xff\xd8\xff
	header := []byte{0xFF, 0xD8, 0xFF, 0xE0}
	content := append(header, make([]byte, 500)...)
	result, err := ValidateContent(bytes.NewReader(content), "image/jpeg", "cyber")
	if err != nil {
		t.Fatalf("ValidateContent: %v", err)
	}
	if result.DetectedType != "image/jpeg" {
		t.Fatalf("expected detected type image/jpeg, got %s", result.DetectedType)
	}
	if result.Blocked {
		t.Fatal("JPEG should not be blocked")
	}
	if !result.Allowed {
		t.Fatal("JPEG should be allowed for cyber suite")
	}
}

func TestValidate_JSON(t *testing.T) {
	content := []byte(`{"key": "value", "number": 42}`)
	result, err := ValidateContent(bytes.NewReader(content), "application/json", "platform")
	if err != nil {
		t.Fatalf("ValidateContent: %v", err)
	}
	if result.DetectedType != "application/json" {
		t.Fatalf("expected detected type application/json, got %s", result.DetectedType)
	}
	if result.Blocked {
		t.Fatal("JSON should not be blocked")
	}
	if !result.Allowed {
		t.Fatal("JSON should be allowed for platform suite")
	}
}

func TestValidate_GZIP(t *testing.T) {
	// GZIP magic bytes: \x1f\x8b
	header := []byte{0x1F, 0x8B, 0x08, 0x00}
	content := append(header, make([]byte, 500)...)
	result, err := ValidateContent(bytes.NewReader(content), "application/gzip", "data")
	if err != nil {
		t.Fatalf("ValidateContent: %v", err)
	}
	if result.DetectedType != "application/gzip" {
		t.Fatalf("expected detected type application/gzip, got %s", result.DetectedType)
	}
	if result.Blocked {
		t.Fatal("GZIP should not be blocked")
	}
	if !result.Allowed {
		t.Fatal("GZIP should be allowed for data suite")
	}
}

func TestValidate_ExecutableBlocked(t *testing.T) {
	// ELF binary magic bytes: \x7fELF
	header := []byte{0x7F, 0x45, 0x4C, 0x46}
	content := append(header, make([]byte, 500)...)

	// Test across multiple suites -- ELF should always be blocked
	suites := []string{"cyber", "data", "acta", "lex", "visus", "platform", "models", "unknown-suite"}
	for _, suite := range suites {
		t.Run(suite, func(t *testing.T) {
			result, err := ValidateContent(bytes.NewReader(content), "application/x-executable", suite)
			if err != nil {
				t.Fatalf("ValidateContent: %v", err)
			}
			if result.DetectedType != "application/x-executable" {
				t.Fatalf("expected detected type application/x-executable, got %s", result.DetectedType)
			}
			if !result.Blocked {
				t.Fatal("ELF binary should be blocked regardless of suite")
			}
		})
	}
}

func TestValidate_ContentTypeMismatch(t *testing.T) {
	// Declare as PDF but provide JPEG content
	header := []byte{0xFF, 0xD8, 0xFF, 0xE0}
	content := append(header, make([]byte, 500)...)
	result, err := ValidateContent(bytes.NewReader(content), "application/pdf", "cyber")
	if err != nil {
		t.Fatalf("ValidateContent: %v", err)
	}
	if result.DeclaredType != "application/pdf" {
		t.Fatalf("expected declared type application/pdf, got %s", result.DeclaredType)
	}
	if result.DetectedType != "image/jpeg" {
		t.Fatalf("expected detected type image/jpeg, got %s", result.DetectedType)
	}
	if !result.Mismatch {
		t.Fatal("declared PDF vs detected JPEG should set Mismatch flag")
	}
}

func TestValidate_AllowedForSuite(t *testing.T) {
	// SQL content is allowed for "data" but not for "cyber"
	// SQL will be detected as text/plain by http.DetectContentType
	content := []byte("SELECT * FROM users WHERE id = 1;\n" + string(make([]byte, 500)))

	t.Run("allowed for data suite with matching declared type", func(t *testing.T) {
		result, err := ValidateContent(bytes.NewReader(content), "application/sql", "data")
		if err != nil {
			t.Fatalf("ValidateContent: %v", err)
		}
		if !result.Allowed {
			t.Fatal("application/sql should be allowed for data suite")
		}
	})

	t.Run("not allowed for platform suite", func(t *testing.T) {
		// PNG is not in platform allowed types
		header := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A}
		pngContent := append(header, make([]byte, 500)...)
		result, err := ValidateContent(bytes.NewReader(pngContent), "image/png", "platform")
		if err != nil {
			t.Fatalf("ValidateContent: %v", err)
		}
		if result.Allowed {
			t.Fatal("PNG should NOT be allowed for platform suite")
		}
	})

	t.Run("unknown suite allows all non-blocked", func(t *testing.T) {
		result, err := ValidateContent(bytes.NewReader(content), "text/plain", "nonexistent-suite")
		if err != nil {
			t.Fatalf("ValidateContent: %v", err)
		}
		if !result.Allowed {
			t.Fatal("unknown suite should allow all non-blocked content")
		}
	})
}

func TestValidate_ReaderReplay(t *testing.T) {
	original := []byte("This is the full file content that should be completely readable after validation.")
	result, err := ValidateContent(bytes.NewReader(original), "text/plain", "cyber")
	if err != nil {
		t.Fatalf("ValidateContent: %v", err)
	}

	// The returned Reader should contain the full original content
	replayed, err := io.ReadAll(result.Reader)
	if err != nil {
		t.Fatalf("reading replayed reader: %v", err)
	}
	if !bytes.Equal(replayed, original) {
		t.Fatalf("replayed content mismatch:\n  got:  %q\n  want: %q", replayed, original)
	}
}

// TestValidate_LexSpreadsheets covers the intake regression where the legal
// suite advertised XLSX in its upload hint but the allow-list carried neither
// Excel type, so every spreadsheet was rejected with UNSUPPORTED_MEDIA_TYPE.
func TestValidate_LexSpreadsheets(t *testing.T) {
	const xlsxMIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
	const xlsMIME = "application/vnd.ms-excel"

	// XLSX is a ZIP container: magic bytes detect application/zip, so it is the
	// DECLARED type that has to carry it through — the same path DOCX relies on.
	xlsx := append([]byte("PK\x03\x04"), make([]byte, 500)...)
	result, err := ValidateContent(bytes.NewReader(xlsx), xlsxMIME, "lex")
	if err != nil {
		t.Fatalf("ValidateContent(xlsx): %v", err)
	}
	if result.DetectedType != "application/zip" {
		t.Fatalf("xlsx detected type = %s, want application/zip", result.DetectedType)
	}
	if result.Blocked {
		t.Fatal("xlsx must not be blocked")
	}
	if !result.Allowed {
		t.Fatal("xlsx must be allowed for the lex suite")
	}

	// Legacy .xls is an OLE2 compound file with no registered magic signature.
	xls := append([]byte("\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"), make([]byte, 500)...)
	result, err = ValidateContent(bytes.NewReader(xls), xlsMIME, "lex")
	if err != nil {
		t.Fatalf("ValidateContent(xls): %v", err)
	}
	if result.Blocked {
		t.Fatal("legacy xls must not be blocked")
	}
	if !result.Allowed {
		t.Fatal("legacy xls must be allowed for the lex suite")
	}

	// Widening the spreadsheet types must not have widened anything else: an
	// executable stays blocked no matter what the client declares.
	exe := append([]byte("MZ\x90\x00"), make([]byte, 500)...)
	result, err = ValidateContent(bytes.NewReader(exe), xlsxMIME, "lex")
	if err != nil {
		t.Fatalf("ValidateContent(exe): %v", err)
	}
	if !result.Blocked {
		t.Fatal("executable must stay blocked even when declared as a spreadsheet")
	}
}

// TestValidate_LexAcceptsEveryOfferedFormat pins the server allow-list to the
// wizard's accept list. The regression this guards is a UI that offers a format
// the upload then rejects with 415 — which is how both Excel types shipped.
//
// Each case uses REAL leading bytes so the detection path exercised here is the
// one a browser upload actually takes.
func TestValidate_LexAcceptsEveryOfferedFormat(t *testing.T) {
	pad := func(prefix []byte) []byte { return append(prefix, make([]byte, 512)...) }

	cases := []struct {
		name     string
		declared string
		content  []byte
	}{
		{"pdf", "application/pdf", pad([]byte("%PDF-1.7"))},
		{"docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", pad([]byte("PK\x03\x04"))},
		{"doc", "application/msword", pad([]byte("\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"))},
		{"xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pad([]byte("PK\x03\x04"))},
		{"xls", "application/vnd.ms-excel", pad([]byte("\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"))},
		{"txt", "text/plain", pad([]byte("Meeting notes\n"))},
		{"csv", "text/csv", pad([]byte("ref,amount\nA-1,100\n"))},
		{"rtf", "application/rtf", pad([]byte(`{\rtf1\ansi `))},
		{"png", "image/png", pad([]byte("\x89PNG\r\n\x1a\n"))},
		{"jpg", "image/jpeg", pad([]byte("\xff\xd8\xff\xe0"))},
		{"gif", "image/gif", pad([]byte("GIF89a"))},
		{"webp", "image/webp", pad(append([]byte("RIFF\x00\x00\x00\x00"), []byte("WEBP")...))},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			result, err := ValidateContent(bytes.NewReader(tc.content), tc.declared, "lex")
			if err != nil {
				t.Fatalf("ValidateContent: %v", err)
			}
			if result.Blocked {
				t.Fatalf("%s must not be blocked (detected %s)", tc.name, result.DetectedType)
			}
			if !result.Allowed {
				t.Fatalf("%s must be allowed for the lex suite (detected %s, declared %s)",
					tc.name, result.DetectedType, tc.declared)
			}
		})
	}
}

// TestValidate_LexStillBlocksExecutables proves the widened list did not widen
// the blocklist: a declared content type can never launder an executable.
func TestValidate_LexStillBlocksExecutables(t *testing.T) {
	for _, declared := range []string{
		"application/pdf",
		"image/webp",
		"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	} {
		content := append([]byte("MZ\x90\x00"), make([]byte, 512)...)
		result, err := ValidateContent(bytes.NewReader(content), declared, "lex")
		if err != nil {
			t.Fatalf("ValidateContent: %v", err)
		}
		if !result.Blocked {
			t.Fatalf("executable declared as %s must stay blocked", declared)
		}
	}
}
