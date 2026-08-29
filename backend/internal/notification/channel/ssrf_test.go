package channel

import (
	"context"
	"net"
	"strings"
	"testing"
)

func TestBlockedIP(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		ip   string
		want bool
	}{
		{"loopback v4", "127.0.0.1", true},
		{"loopback v4 8-block", "127.10.20.30", true},
		{"cloud metadata", "169.254.169.254", true},
		{"link-local v4", "169.254.1.1", true},
		{"private 10", "10.1.2.3", true},
		{"private 172.16", "172.16.5.5", true},
		{"private 192.168", "192.168.0.1", true},
		{"unspecified v4", "0.0.0.0", true},
		{"broadcast", "255.255.255.255", true},
		{"cgnat", "100.64.0.1", true},
		{"multicast", "224.0.0.1", true},
		{"loopback v6", "::1", true},
		{"ula v6", "fc00::1", true},
		{"link-local v6", "fe80::1", true},
		{"unspecified v6", "::", true},
		{"ipv4-mapped loopback", "::ffff:127.0.0.1", true},
		{"public v4", "93.184.216.34", false},
		{"public v4 cloudflare", "1.1.1.1", false},
		{"public v6", "2606:4700:4700::1111", false},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			ip := net.ParseIP(tt.ip)
			if ip == nil {
				t.Fatalf("bad test IP %q", tt.ip)
			}
			if got := blockedIP(ip); got != tt.want {
				t.Fatalf("blockedIP(%s) = %v, want %v", tt.ip, got, tt.want)
			}
		})
	}
}

func TestParseHostIP_NumericEncodings(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		host string
		want string // expected dotted IP, "" means nil
	}{
		{"decimal loopback", "2130706433", "127.0.0.1"},
		{"hex loopback", "0x7f000001", "127.0.0.1"},
		{"octal loopback", "017700000001", "127.0.0.1"},
		{"dotted literal", "10.0.0.1", "10.0.0.1"},
		{"genuine hostname", "example.com", ""},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := parseHostIP(tt.host)
			if tt.want == "" {
				if got != nil {
					t.Fatalf("parseHostIP(%q) = %v, want nil", tt.host, got)
				}
				return
			}
			if got == nil || !got.Equal(net.ParseIP(tt.want)) {
				t.Fatalf("parseHostIP(%q) = %v, want %s", tt.host, got, tt.want)
			}
		})
	}
}

func TestValidateWebhookURL(t *testing.T) {
	// Not parallel: mutates the package-level resolver.
	restore := hostIPLookup
	t.Cleanup(func() { hostIPLookup = restore })

	tests := []struct {
		name        string
		url         string
		environment string
		resolvesTo  []net.IP // used only when host is a genuine name
		wantErr     bool
		errContains string
	}{
		{name: "https public IP literal", url: "https://93.184.216.34/hook", environment: "production", wantErr: false},
		{name: "metadata IP literal blocked", url: "https://169.254.169.254/latest/meta-data", environment: "production", wantErr: true, errContains: "blocked"},
		{name: "loopback literal blocked", url: "https://127.0.0.1/hook", environment: "production", wantErr: true, errContains: "blocked"},
		{name: "private 10 literal blocked", url: "https://10.0.0.5/hook", environment: "production", wantErr: true, errContains: "blocked"},
		{name: "decimal-encoded loopback blocked", url: "https://2130706433/hook", environment: "production", wantErr: true, errContains: "blocked"},
		{name: "hex-encoded loopback blocked", url: "https://0x7f000001/hook", environment: "production", wantErr: true, errContains: "blocked"},
		{name: "http rejected in production", url: "http://example.com/hook", environment: "production", wantErr: true, errContains: "HTTPS"},
		{name: "http allowed in development", url: "http://93.184.216.34/hook", environment: "development", wantErr: false},
		{name: "unsupported scheme", url: "ftp://93.184.216.34/hook", environment: "production", wantErr: true, errContains: "scheme"},
		{name: "hostname resolving to private blocked", url: "https://internal.example.com/hook", environment: "production", resolvesTo: []net.IP{net.ParseIP("10.0.0.9")}, wantErr: true, errContains: "blocked"},
		{name: "hostname resolving public allowed", url: "https://good.example.com/hook", environment: "production", resolvesTo: []net.IP{net.ParseIP("93.184.216.34")}, wantErr: false},
		{name: "dns rebind one private answer blocked", url: "https://mixed.example.com/hook", environment: "production", resolvesTo: []net.IP{net.ParseIP("93.184.216.34"), net.ParseIP("127.0.0.1")}, wantErr: true, errContains: "blocked"},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			hostIPLookup = func(_ context.Context, _ string) ([]net.IP, error) {
				return tt.resolvesTo, nil
			}
			err := ValidateWebhookURL(context.Background(), tt.url, tt.environment)
			if tt.wantErr {
				if err == nil {
					t.Fatalf("ValidateWebhookURL(%q) = nil, want error", tt.url)
				}
				if tt.errContains != "" && !strings.Contains(err.Error(), tt.errContains) {
					t.Fatalf("error %q does not contain %q", err.Error(), tt.errContains)
				}
				return
			}
			if err != nil {
				t.Fatalf("ValidateWebhookURL(%q) = %v, want nil", tt.url, err)
			}
		})
	}
}

func TestSafeDialControl(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		address string
		wantErr bool
	}{
		{"blocks metadata", "169.254.169.254:443", true},
		{"blocks loopback", "127.0.0.1:8080", true},
		{"blocks private", "10.0.0.1:443", true},
		{"allows public", "93.184.216.34:443", false},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			// The RawConn argument is unused by safeDialControl.
			err := safeDialControl("tcp", tt.address, nil)
			if (err != nil) != tt.wantErr {
				t.Fatalf("safeDialControl(%q) err=%v, wantErr=%v", tt.address, err, tt.wantErr)
			}
		})
	}
}
