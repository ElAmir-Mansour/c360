package integration

import (
	"context"
	"strconv"
	"strings"
)

// =============================================================================
// IMAP inbound-email source seam.
//
// This is the interface + config contract for polling a REAL IMAP mailbox and
// funneling its unread mail into the intake pipeline's trusted ingress
// (IntakeService.IngestInboundParsed), alongside the provider inbound-parse
// receiver. The leader-gated background poller (monitor.InboundEmailMonitor)
// consumes InboundEmailSource; a fake implementation exercises the whole
// fetch→ingest→mark-processed loop (and redelivery dedup) in tests.
//
// BUILD NOTE — the concrete IMAP client is intentionally NOT compiled into this
// build. A production imapSource needs an IMAP + MIME client dependency
// (github.com/emersion/go-imap/v2 + github.com/emersion/go-message), which is not
// present in go.mod and could not be added from the module proxy in this
// environment. The seam, config parser, poller, and tests are all in place and
// dep-free, so dropping in an emersion-backed InboundEmailSource that:
//   1. dials IMAPConfig.Addr() over TLS and LOGIN/AUTHENTICATEs,
//   2. SELECTs the folder and SEARCHes UNSEEN,
//   3. FETCHes each message, parses MIME into NormalizedInboundMessage (To =
//      IMAPConfig.MailboxAddress, or the envelope recipient), and
//   4. on MarkProcessed sets the \Seen flag for the ingested UIDs,
// wires it end-to-end without touching the poller or the pipeline. Until then the
// demonstrable path is the JWT-gated Simulate-Inbound admin action, and the live
// inbound leg runs through the provider inbound-parse receiver. Real IMAP
// credentials (host/user/app-password) on an `email` integration endpoint are the
// external go-live gate.
// =============================================================================

// InboundEmailSource is one pollable inbound mailbox. Fetch returns the currently
// unprocessed messages (normalized); MarkProcessed acknowledges the ones that were
// successfully ingested so they are not re-fetched (e.g. IMAP \Seen). Both are
// side-effecting against an external mailbox, which is why the poller that drives
// them MUST be leader-gated. Close releases the underlying connection.
type InboundEmailSource interface {
	Fetch(ctx context.Context) ([]NormalizedInboundMessage, error)
	MarkProcessed(ctx context.Context, messageIDs []string) error
	Close() error
}

// IMAPConfig is the per-endpoint IMAP connection contract, parsed tolerantly from
// an `email` integration endpoint's config map (the same map parseEmailConfig
// reads). It is the operator-facing shape a live imapSource consumes.
type IMAPConfig struct {
	Host           string
	Port           int
	Username       string
	Password       string
	Folder         string
	UseTLS         bool
	MailboxAddress string
}

// Addr returns host:port, defaulting the port to the IMAPS port (993) when unset.
func (c IMAPConfig) Addr() string {
	port := c.Port
	if port <= 0 {
		port = 993
	}
	return c.Host + ":" + strconv.Itoa(port)
}

// Configured reports whether the endpoint carries enough to attempt an IMAP poll.
func (c IMAPConfig) Configured() bool {
	return strings.TrimSpace(c.Host) != "" && strings.TrimSpace(c.Username) != ""
}

// ParseIMAPConfig extracts the IMAP connection contract from an endpoint config
// map. Missing keys yield zero values; UseTLS defaults to true (IMAPS) unless
// explicitly disabled, and Folder defaults to INBOX. It never errors — an
// unconfigured endpoint simply reports Configured()==false.
func ParseIMAPConfig(config map[string]any) IMAPConfig {
	cfg := IMAPConfig{
		Host:           firstEmailConfigString(config, "imap_host", "inbound_host", "host"),
		Port:           firstEmailConfigInt(config, 0, "imap_port", "inbound_port"),
		Username:       firstEmailConfigString(config, "imap_username", "inbound_username", "username", "user"),
		Password:       firstEmailConfigString(config, "imap_password", "inbound_password", "password"),
		Folder:         firstEmailConfigString(config, "imap_folder", "inbound_folder", "folder", "mailbox"),
		MailboxAddress: firstEmailConfigString(config, "inbound_mailbox_address", "mailbox_address", "intake_address"),
		// TLS defaults ON (IMAPS); only an explicit false disables it.
		UseTLS: firstEmailConfigBool(config, true, "imap_use_tls", "imap_tls"),
	}
	if strings.TrimSpace(cfg.Folder) == "" {
		cfg.Folder = "INBOX"
	}
	return cfg
}
