package channel

import (
	"strings"
	"testing"
)

// TestEncodeSubject_ArabicRFC2047 asserts a non-ASCII (Arabic) subject is RFC
// 2047 encoded so it survives transport with the correct charset, rather than
// being written raw.
func TestEncodeSubject_ArabicRFC2047(t *testing.T) {
	subject := "تنبيه أمني" // "Security Alert" in Arabic
	got := encodeSubject(subject)

	if got == subject {
		t.Fatal("Arabic subject was not encoded")
	}
	if !strings.HasPrefix(strings.ToLower(got), "=?utf-8?") {
		t.Fatalf("expected RFC 2047 encoded-word prefix, got %q", got)
	}
	// An RFC 2047 encoded-word must not contain raw whitespace or the raw
	// non-ASCII bytes.
	if strings.ContainsAny(got, "\r\n") {
		t.Fatal("encoded subject must not contain CR/LF")
	}
}

// TestEncodeSubject_StripsHeaderInjection asserts CR/LF injected into a subject
// (an attempt to smuggle extra headers) is stripped before encoding.
func TestEncodeSubject_StripsHeaderInjection(t *testing.T) {
	got := encodeSubject("Hello\r\nBcc: attacker@evil.com")
	if strings.Contains(got, "\r") || strings.Contains(got, "\n") {
		t.Fatalf("encoded subject still contains CR/LF: %q", got)
	}
	if strings.Contains(strings.ToLower(got), "bcc:") && strings.Contains(got, "\n") {
		t.Fatal("header injection not neutralized")
	}
}

// TestBuildMIMEMessage_MultipartAlternative asserts the SMTP message carries a
// multipart/alternative container with BOTH a text/plain and a text/html part,
// the correct boundary markers, and an encoded subject header.
func TestBuildMIMEMessage_MultipartAlternative(t *testing.T) {
	from := "Clario 360 <notifications@clario360.com>"
	to := "user@example.com"
	subject := "مرحبا Alert"
	text := "Plain text body"
	html := "<h1>HTML body</h1>"

	raw := string(buildMIMEMessage(from, to, subject, text, html))

	// Header block.
	if !strings.Contains(raw, "MIME-Version: 1.0\r\n") {
		t.Fatal("missing MIME-Version header")
	}
	if !strings.Contains(raw, "Content-Type: multipart/alternative; boundary=\"") {
		t.Fatalf("missing multipart/alternative content type:\n%s", raw)
	}
	if !strings.Contains(raw, "Subject: =?") {
		t.Fatal("subject header is not RFC 2047 encoded")
	}

	// Extract the boundary and assert exactly two body parts + a closing marker.
	const marker = "boundary=\""
	idx := strings.Index(raw, marker)
	rest := raw[idx+len(marker):]
	boundary := rest[:strings.Index(rest, "\"")]
	if boundary == "" {
		t.Fatal("empty boundary")
	}
	openCount := strings.Count(raw, "--"+boundary+"\r\n")
	if openCount != 2 {
		t.Fatalf("expected 2 body parts, found %d boundary openers", openCount)
	}
	if !strings.Contains(raw, "--"+boundary+"--\r\n") {
		t.Fatal("missing closing boundary")
	}

	// Both alternatives present, text before html (RFC 2046 preference order).
	textIdx := strings.Index(raw, "Content-Type: text/plain; charset=\"utf-8\"")
	htmlIdx := strings.Index(raw, "Content-Type: text/html; charset=\"utf-8\"")
	if textIdx < 0 || htmlIdx < 0 {
		t.Fatalf("missing a body part: textIdx=%d htmlIdx=%d", textIdx, htmlIdx)
	}
	if textIdx > htmlIdx {
		t.Fatal("text/plain part must precede text/html (least-preferred first)")
	}
	if !strings.Contains(raw, "Content-Transfer-Encoding: quoted-printable") {
		t.Fatal("body parts should be quoted-printable encoded for UTF-8")
	}
}

// TestHTMLToText derives a readable plain-text fallback from HTML.
func TestHTMLToText(t *testing.T) {
	html := "<h1>Title</h1><p>Hello &amp; welcome.</p><p>Line two</p>"
	got := htmlToText(html)
	if strings.Contains(got, "<") || strings.Contains(got, ">") {
		t.Fatalf("plain text still has tags: %q", got)
	}
	if !strings.Contains(got, "Hello & welcome.") {
		t.Fatalf("entity not decoded / text missing: %q", got)
	}
	if !strings.Contains(got, "Title") || !strings.Contains(got, "Line two") {
		t.Fatalf("expected block text preserved, got %q", got)
	}
}
