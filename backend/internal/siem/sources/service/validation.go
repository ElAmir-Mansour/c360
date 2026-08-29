package service

import (
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/clario360/platform/internal/siem/sources"
)

var (
	nameRE = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{2,63}$`)
	tagKey = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_-]{0,31}$`)
	sqsARN = regexp.MustCompile(`^arn:aws:sqs:[a-z0-9-]+:\d+:[A-Za-z0-9_-]+$`)
)

// Validate runs the full PROMPT3.MD §4.4.1 rule set. Returns
// *sources.FieldErrors on failure, wrapped in sources.ErrValidation
// via its Unwrap.
func Validate(in sources.OnboardInput) error {
	fe := &sources.FieldErrors{}
	if !nameRE.MatchString(in.Name) {
		fe.Errors = append(fe.Errors, sources.FieldError{Field: "name", Code: "regex", Message: "must match ^[a-z0-9][a-z0-9-]{2,63}$"})
	}
	if strings.TrimSpace(in.Type) == "" || len(in.Type) > 64 {
		fe.Errors = append(fe.Errors, sources.FieldError{Field: "type", Code: "length", Message: "must be 1..64 chars"})
	}
	if !isValidTransport(in.Transport) {
		fe.Errors = append(fe.Errors, sources.FieldError{Field: "transport", Code: "enum", Message: "unknown transport"})
	}
	if err := validateAddress(in.Transport, in.Address); err != nil {
		fe.Errors = append(fe.Errors, sources.FieldError{Field: "address", Code: "format", Message: err.Error()})
	}
	if in.ExpectedEPS < 0 || in.ExpectedEPS > 1000000 {
		fe.Errors = append(fe.Errors, sources.FieldError{Field: "expected_eps", Code: "range", Message: "must be 0..1000000"})
	}
	if in.TZ != "" {
		if _, err := time.LoadLocation(in.TZ); err != nil {
			fe.Errors = append(fe.Errors, sources.FieldError{Field: "tz", Code: "tz", Message: "not a valid IANA tz: " + err.Error()})
		}
	}
	if err := validateTags(in.Tags); err != nil {
		fe.Errors = append(fe.Errors, sources.FieldError{Field: "tags", Code: "shape", Message: err.Error()})
	}
	if len(fe.Errors) > 0 {
		return fe
	}
	return nil
}

// ValidateUpdate validates the patch payload. Same field rules but
// applied only to non-nil fields.
func ValidateUpdate(in sources.UpdateInput, transport sources.Transport) error {
	fe := &sources.FieldErrors{}
	if in.Type != nil {
		if strings.TrimSpace(*in.Type) == "" || len(*in.Type) > 64 {
			fe.Errors = append(fe.Errors, sources.FieldError{Field: "type", Code: "length", Message: "must be 1..64 chars"})
		}
	}
	if in.Address != nil {
		if err := validateAddress(transport, *in.Address); err != nil {
			fe.Errors = append(fe.Errors, sources.FieldError{Field: "address", Code: "format", Message: err.Error()})
		}
	}
	if in.ExpectedEPS != nil {
		if *in.ExpectedEPS < 0 || *in.ExpectedEPS > 1000000 {
			fe.Errors = append(fe.Errors, sources.FieldError{Field: "expected_eps", Code: "range", Message: "must be 0..1000000"})
		}
	}
	if in.TZ != nil {
		if _, err := time.LoadLocation(*in.TZ); err != nil {
			fe.Errors = append(fe.Errors, sources.FieldError{Field: "tz", Code: "tz", Message: "not a valid IANA tz"})
		}
	}
	if len(in.Tags) > 0 {
		if err := validateTags(in.Tags); err != nil {
			fe.Errors = append(fe.Errors, sources.FieldError{Field: "tags", Code: "shape", Message: err.Error()})
		}
	}
	if len(fe.Errors) > 0 {
		return fe
	}
	return nil
}

func isValidTransport(t sources.Transport) bool {
	for _, v := range sources.AllTransports {
		if v == t {
			return true
		}
	}
	return false
}

func validateAddress(t sources.Transport, addr string) error {
	addr = strings.TrimSpace(addr)
	if addr == "" {
		return fmt.Errorf("address required")
	}
	switch t {
	case sources.TransportSyslogUDP, sources.TransportSyslogTCPTLS, sources.TransportCEFSyslog, sources.TransportLEEFSyslog,
		sources.TransportNetflow, sources.TransportZeekJSON, sources.TransportSuricataJSON, sources.TransportWinEventWEC,
		sources.TransportOktaSystemLog, sources.TransportM365Graph, sources.TransportAzureEventHub:
		return validateHostPort(addr)
	case sources.TransportJSONHTTPS, sources.TransportNIBSSIAF:
		return validateHTTPS(addr)
	case sources.TransportCloudTrailSQS:
		if !sqsARN.MatchString(addr) {
			return fmt.Errorf("expected SQS ARN")
		}
		return nil
	case sources.TransportFileTail, sources.TransportSWIFTAudit, sources.TransportRTGSAudit,
		sources.TransportT24Export, sources.TransportFinacleExport, sources.TransportFlexcubeExport,
		sources.TransportPostilionLog:
		return validateFilePath(addr)
	case sources.TransportKafka:
		return validateKafka(addr)
	case sources.TransportGCPPubSub, sources.TransportGWorkspace:
		// Lightweight: expect a non-empty resource identifier.
		if !strings.Contains(addr, "/") {
			return fmt.Errorf("expected resource path containing /")
		}
		return nil
	case sources.TransportISO8583, sources.TransportPGAudit, sources.TransportOracleAudit,
		sources.TransportMSSQLAudit, sources.TransportK8sAudit:
		return validateHostPort(addr)
	default:
		// Unknown transports fail at the enum check; reaching here
		// would be a programming error, but we be conservative.
		return fmt.Errorf("address format for transport %q not enumerated", t)
	}
}

func validateHostPort(addr string) error {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return fmt.Errorf("expected host:port: %v", err)
	}
	if host == "" {
		return fmt.Errorf("host empty")
	}
	p, err := strconv.Atoi(port)
	if err != nil {
		return fmt.Errorf("port not numeric")
	}
	if p < 1 || p > 65535 {
		return fmt.Errorf("port out of range")
	}
	return nil
}

func validateHTTPS(addr string) error {
	u, err := url.Parse(addr)
	if err != nil {
		return fmt.Errorf("bad URL: %v", err)
	}
	if u.Scheme != "https" {
		return fmt.Errorf("must be https://")
	}
	if u.Host == "" {
		return fmt.Errorf("host required")
	}
	return nil
}

// forbiddenFilePaths blocks security-sensitive directories.
var forbiddenFilePaths = []string{"/etc", "/proc", "/sys", "/var/log/secure", "/var/log/auth.log"}

func validateFilePath(addr string) error {
	if !strings.HasPrefix(addr, "/") {
		return fmt.Errorf("must be absolute POSIX path")
	}
	for _, bad := range forbiddenFilePaths {
		if addr == bad || strings.HasPrefix(addr, bad+"/") {
			return fmt.Errorf("path forbidden by security policy (%s)", bad)
		}
	}
	return nil
}

func validateKafka(addr string) error {
	// broker1:9092,broker2:9092[/topic]
	main := addr
	if idx := strings.Index(addr, "/"); idx > 0 {
		main = addr[:idx]
	}
	brokers := strings.Split(main, ",")
	if len(brokers) == 0 {
		return fmt.Errorf("no brokers")
	}
	for _, b := range brokers {
		if err := validateHostPort(strings.TrimSpace(b)); err != nil {
			return fmt.Errorf("broker %q: %v", b, err)
		}
	}
	return nil
}

func validateTags(raw json.RawMessage) error {
	if len(raw) == 0 {
		return nil
	}
	var tags map[string]string
	if err := json.Unmarshal(raw, &tags); err != nil {
		return fmt.Errorf("tags must be a flat string→string map: %v", err)
	}
	if len(tags) > 16 {
		return fmt.Errorf("at most 16 tag keys")
	}
	for k, v := range tags {
		if !tagKey.MatchString(k) {
			return fmt.Errorf("tag key %q does not match %s", k, tagKey)
		}
		if len(v) > 128 {
			return fmt.Errorf("tag value for %q exceeds 128 chars", k)
		}
	}
	return nil
}
