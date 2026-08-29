package channel

import (
	"context"
	"fmt"
	"math"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"syscall"
	"time"
)

// SSRF hardening for outbound webhook delivery (Wave B #4).
//
// Two layers defend against Server-Side Request Forgery, including the
// DNS-rebinding class where a hostname resolves to a public IP at validation
// time and a private one at connect time:
//
//  1. ValidateWebhookURL — an up-front, DNS-aware check. It parses the URL,
//     enforces HTTPS outside development, decodes literal / numeric-encoded
//     (decimal, hex, octal) IP hosts, resolves hostnames, and rejects any IP
//     that is loopback / private / link-local (incl. 169.254.169.254 cloud
//     metadata) / unique-local / unspecified / multicast / reserved.
//
//  2. safeDialControl — a net.Dialer Control hook re-checked at connect time on
//     the ACTUAL resolved IP the OS is about to dial. This defeats DNS
//     rebinding (a second resolution after validation) and catches any
//     numeric-host encoding the OS resolver interprets that the up-front parser
//     did not.
//
// The two share blockedIP so the policy cannot drift.

// blockedIP reports whether ip must never be a webhook target. It normalizes
// IPv4-mapped IPv6 to IPv4 first, then rejects the full set of non-routable /
// internal ranges.
func blockedIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if v4 := ip.To4(); v4 != nil {
		ip = v4
	}
	if ip.IsLoopback() || // 127.0.0.0/8, ::1
		ip.IsPrivate() || // 10/8, 172.16/12, 192.168/16, fc00::/7
		ip.IsUnspecified() || // 0.0.0.0, ::
		ip.IsLinkLocalUnicast() || // 169.254.0.0/16 (incl. metadata), fe80::/10
		ip.IsLinkLocalMulticast() ||
		ip.IsInterfaceLocalMulticast() ||
		ip.IsMulticast() { // 224.0.0.0/4, ff00::/8
		return true
	}
	// Cloud metadata endpoint — already covered by IsLinkLocalUnicast, asserted
	// explicitly as a defense-in-depth tripwire.
	if ip.Equal(net.IPv4(169, 254, 169, 254)) {
		return true
	}
	if v4 := ip.To4(); v4 != nil {
		// 0.0.0.0/8 "this network".
		if v4[0] == 0 {
			return true
		}
		// Limited broadcast.
		if v4.Equal(net.IPv4(255, 255, 255, 255)) {
			return true
		}
		// Carrier-grade NAT 100.64.0.0/10.
		if v4[0] == 100 && v4[1] >= 64 && v4[1] <= 127 {
			return true
		}
	}
	return false
}

// parseHostIP returns the IP a host literal denotes, decoding the inet_aton-style
// numeric encodings (single decimal / hex / octal integer) that are commonly
// abused to smuggle an internal IP past a naive string check (e.g. 2130706433
// and 0x7f000001 both mean 127.0.0.1). It returns nil for a genuine hostname.
func parseHostIP(host string) net.IP {
	if host == "" {
		return nil
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip
	}
	var (
		n   uint64
		err error
	)
	switch {
	case strings.HasPrefix(host, "0x") || strings.HasPrefix(host, "0X"):
		n, err = strconv.ParseUint(host[2:], 16, 64)
	case len(host) > 1 && host[0] == '0' && isAllOctalDigits(host):
		n, err = strconv.ParseUint(host, 8, 64)
	case isAllDigits(host):
		n, err = strconv.ParseUint(host, 10, 64)
	default:
		return nil
	}
	if err != nil || n > math.MaxUint32 {
		return nil
	}
	return net.IPv4(byte(n>>24), byte(n>>16), byte(n>>8), byte(n))
}

func isAllDigits(s string) bool {
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return len(s) > 0
}

func isAllOctalDigits(s string) bool {
	for _, r := range s {
		if r < '0' || r > '7' {
			return false
		}
	}
	return len(s) > 0
}

// hostIPLookup is the resolver used by ValidateWebhookURL. It is a package
// variable so tests can inject a deterministic resolver (e.g. a hostname that
// "resolves" to a private IP) without real DNS.
var hostIPLookup = func(ctx context.Context, host string) ([]net.IP, error) {
	addrs, err := net.DefaultResolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	ips := make([]net.IP, 0, len(addrs))
	for _, a := range addrs {
		ips = append(ips, a.IP)
	}
	return ips, nil
}

// ValidateWebhookURL performs the DNS-aware up-front SSRF check. environment
// gates only the HTTPS requirement (development may use http); IP blocking is
// always enforced.
func ValidateWebhookURL(ctx context.Context, rawURL, environment string) error {
	u, err := url.Parse(rawURL)
	if err != nil {
		return fmt.Errorf("parse url: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("webhook URL scheme must be http or https")
	}
	if environment != "development" && u.Scheme != "https" {
		return fmt.Errorf("webhook URL must be HTTPS in production")
	}

	host := u.Hostname()
	if host == "" {
		return fmt.Errorf("webhook URL has no host")
	}

	// Literal or numeric-encoded IP host: validate directly, never resolve.
	if ip := parseHostIP(host); ip != nil {
		if blockedIP(ip) {
			return fmt.Errorf("webhook URL resolves to a blocked address: %s", ip)
		}
		return nil
	}

	// Hostname: resolve and reject if ANY answer is internal (an attacker
	// controlling DNS could return one public + one private A record).
	ips, err := hostIPLookup(ctx, host)
	if err != nil {
		return fmt.Errorf("resolve webhook host %q: %w", host, err)
	}
	if len(ips) == 0 {
		return fmt.Errorf("webhook host %q did not resolve", host)
	}
	for _, ip := range ips {
		if blockedIP(ip) {
			return fmt.Errorf("webhook URL resolves to a blocked address: %s", ip)
		}
	}
	return nil
}

// safeDialControl is a net.Dialer Control hook that rejects a connection whose
// concrete resolved IP is internal. Because the dialer resolves the host and
// invokes Control with the final "ip:port" it is about to connect to, this is
// the authoritative connect-time guard that defeats DNS rebinding.
func safeDialControl(network, address string, _ syscall.RawConn) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil {
		host = address
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return fmt.Errorf("ssrf: cannot parse dial address %q", address)
	}
	if blockedIP(ip) {
		return fmt.Errorf("ssrf: refusing to connect to blocked address %s", ip)
	}
	return nil
}

// newSafeHTTPClient builds an *http.Client hardened for outbound webhook calls:
// it never follows redirects (a 30x to an internal URL would otherwise bypass
// the up-front check) and installs safeDialControl so every dialed IP is
// re-validated at connect time.
func newSafeHTTPClient(timeout time.Duration) *http.Client {
	dialer := &net.Dialer{
		Timeout:   10 * time.Second,
		KeepAlive: 30 * time.Second,
		Control:   safeDialControl,
	}
	transport := &http.Transport{
		DialContext:           dialer.DialContext,
		ForceAttemptHTTP2:     true,
		MaxIdleConns:          100,
		IdleConnTimeout:       90 * time.Second,
		TLSHandshakeTimeout:   10 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
	}
	return &http.Client{
		Timeout:   timeout,
		Transport: transport,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

// NewSafeWebhookClient exposes an SSRF-hardened HTTP client (no redirects,
// connect-time IP re-validation) for outbound webhook calls made outside this
// package (e.g. the webhook test path in the handler layer).
func NewSafeWebhookClient(timeout time.Duration) *http.Client {
	return newSafeHTTPClient(timeout)
}
