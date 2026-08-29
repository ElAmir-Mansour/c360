package integration

import "testing"

func TestParseIMAPConfigDefaults(t *testing.T) {
	cfg := ParseIMAPConfig(map[string]any{
		"imap_host":               "imap.example.com",
		"imap_username":           "legal@othaim.demo",
		"imap_password":           "app-pass",
		"inbound_mailbox_address": "legal@othaim.demo",
	})
	if !cfg.Configured() {
		t.Fatalf("cfg should be Configured: %+v", cfg)
	}
	if cfg.Folder != "INBOX" {
		t.Fatalf("Folder = %q, want INBOX default", cfg.Folder)
	}
	if !cfg.UseTLS {
		t.Fatalf("UseTLS = false, want true default")
	}
	if cfg.Addr() != "imap.example.com:993" {
		t.Fatalf("Addr() = %q, want default IMAPS port", cfg.Addr())
	}
}

func TestParseIMAPConfigExplicit(t *testing.T) {
	cfg := ParseIMAPConfig(map[string]any{
		"imap_host":     "mail.internal",
		"imap_port":     "1143",
		"imap_username": "svc",
		"imap_folder":   "Legal/Intake",
		"imap_use_tls":  false,
	})
	if cfg.Addr() != "mail.internal:1143" {
		t.Fatalf("Addr() = %q", cfg.Addr())
	}
	if cfg.Folder != "Legal/Intake" {
		t.Fatalf("Folder = %q", cfg.Folder)
	}
	if cfg.UseTLS {
		t.Fatalf("UseTLS = true, want explicit false")
	}
}

func TestParseIMAPConfigUnconfigured(t *testing.T) {
	if ParseIMAPConfig(map[string]any{}).Configured() {
		t.Fatalf("empty config should not be Configured")
	}
	if ParseIMAPConfig(map[string]any{"imap_host": "h"}).Configured() {
		t.Fatalf("host without username should not be Configured")
	}
}
