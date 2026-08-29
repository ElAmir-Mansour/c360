package handler

import (
	"encoding/base64"
	"strings"
	"testing"
)

// dataURL builds a base64 image data URL from a MIME type and raw bytes.
func dataURL(mime string, b []byte) string {
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(b)
}

var (
	pngMagic  = []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}
	jpegMagic = []byte{0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10}
	webpMagic = append(append([]byte("RIFF"), 0x00, 0x00, 0x00, 0x00), []byte("WEBP")...)
)

func TestParseAvatarDataURL(t *testing.T) {
	png := dataURL("image/png", append(pngMagic, make([]byte, 32)...))
	jpeg := dataURL("image/jpeg", append(jpegMagic, make([]byte, 32)...))
	webp := dataURL("image/webp", append(webpMagic, make([]byte, 32)...))

	t.Run("valid formats pass and round-trip unchanged", func(t *testing.T) {
		for _, in := range []string{png, jpeg, webp} {
			got, err := parseAvatarDataURL(in)
			if err != nil {
				t.Fatalf("parseAvatarDataURL(%.24s...) unexpected error: %v", in, err)
			}
			if got != in {
				t.Fatalf("expected the normalized data URL to be returned unchanged")
			}
		}
	})

	t.Run("trims surrounding whitespace", func(t *testing.T) {
		if _, err := parseAvatarDataURL("  " + png + "\n"); err != nil {
			t.Fatalf("expected trimmed input to validate, got %v", err)
		}
	})

	rejects := []struct {
		name string
		in   string
	}{
		{"empty", ""},
		{"not a data url", "https://example.com/a.png"},
		{"missing base64 marker", "data:image/png," + base64.StdEncoding.EncodeToString(pngMagic)},
		{"disallowed svg", dataURL("image/svg+xml", []byte("<svg/>"))},
		{"disallowed gif", dataURL("image/gif", []byte{'G', 'I', 'F', '8'})},
		{"invalid base64", "data:image/png;base64,@@@not-base64@@@"},
		{"empty payload", "data:image/png;base64,"},
		{"magic mismatch: png header, jpeg bytes", dataURL("image/png", append(jpegMagic, make([]byte, 16)...))},
		{"webp missing WEBP tag", dataURL("image/webp", append([]byte("RIFF____NOPE"), make([]byte, 8)...))},
	}
	for _, tc := range rejects {
		t.Run("rejects "+tc.name, func(t *testing.T) {
			if _, err := parseAvatarDataURL(tc.in); err == nil {
				t.Fatalf("expected parseAvatarDataURL to reject %q", tc.name)
			}
		})
	}

	t.Run("rejects oversize image", func(t *testing.T) {
		big := append(pngMagic, make([]byte, maxAvatarBytes+1)...)
		if _, err := parseAvatarDataURL(dataURL("image/png", big)); err == nil ||
			!strings.Contains(err.Error(), "exceeds") {
			t.Fatalf("expected size-cap rejection, got %v", err)
		}
	})
}
