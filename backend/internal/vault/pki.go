package vault

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path"
	"strings"
	"time"

	vaultapi "github.com/hashicorp/vault/api"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
)

// PKIRoleSettings configures a Vault PKI role used to issue leaf certs.
//
// The zero value is NOT valid; callers must populate at minimum
// AllowedDomains, KeyType (one of "ec"|"rsa"), KeyBits, MaxTTL, DefaultTTL.
type PKIRoleSettings struct {
	AllowedDomains   []string // e.g. ["collectors.siem.{tenant}.clario360.local"]
	AllowSubdomains  bool
	AllowBareDomains bool
	AllowLocalhost   bool
	AllowIPSANs      bool
	EnforceHostnames bool
	KeyType          string // "ec" or "rsa"
	KeyBits          int    // 256 (ec) or 2048 (rsa)
	MaxTTL           time.Duration
	DefaultTTL       time.Duration
	ClientFlag       bool
	ServerFlag       bool
}

// LeafCert is the result of IssueLeaf. The private key is intentionally NOT
// present here — the CSR flow keeps the key on the collector at all times.
type LeafCert struct {
	CertPEM    string
	CAChainPEM string
	Serial     string
	NotBefore  time.Time
	NotAfter   time.Time
}

// PKI op identifiers used for OTEL spans (no sensitive material leaks via
// attribute names).
const (
	opPKIMount        transitOp = "pki_ensure_mount"
	opPKIRoot         transitOp = "pki_generate_root"
	opPKIIntermediate transitOp = "pki_ensure_intermediate"
	opPKIRole         transitOp = "pki_ensure_role"
	opPKIIssueLeaf    transitOp = "pki_issue_leaf"
	opPKIRevokeLeaf   transitOp = "pki_revoke_leaf"
)

// ErrPKIIssueFailed wraps non-classifiable PKI failures.
var ErrPKIIssueFailed = errors.New("vault: pki issue failed")

// pkiMountPath normalises a user-supplied mount path. Strips leading/trailing
// slashes so we always get exactly "<mount>/<sub>".
func pkiMountPath(mountPath, sub string) string {
	mountPath = strings.Trim(mountPath, "/")
	sub = strings.Trim(sub, "/")
	return path.Join(mountPath, sub)
}

// pkiSpan opens an OTEL span for a PKI operation. No certificate body, no CSR,
// no key material is ever attached to the span attributes — only the mount
// path and operation name.
func (c *vaultClient) pkiSpan(ctx context.Context, op transitOp, mountPath string) (context.Context, trace.Span) {
	return tracer().Start(ctx, "vault."+string(op), trace.WithAttributes(
		attribute.String("vault.pki_mount", mountPath),
		attribute.String("vault.auth_method", c.cfg.AuthMethod),
	))
}

// EnsurePKIMount idempotently mounts the PKI secrets engine at mountPath.
// If the mount already exists with type "pki", it is a no-op (config TTLs are
// NOT modified — callers wanting to change TTLs must tune via /sys/mounts/.../tune).
func (c *vaultClient) EnsurePKIMount(ctx context.Context, mountPath string, defaultTTL, maxTTL time.Duration) error {
	if strings.TrimSpace(mountPath) == "" {
		return fmt.Errorf("vault: pki mount path is required")
	}
	if defaultTTL <= 0 || maxTTL <= 0 {
		return fmt.Errorf("vault: pki mount TTLs must be positive")
	}
	if maxTTL < defaultTTL {
		return fmt.Errorf("vault: pki mount max_ttl must be >= default_ttl")
	}
	ctx, span := c.pkiSpan(ctx, opPKIMount, mountPath)
	defer span.End()

	mountPath = strings.Trim(mountPath, "/")

	// Read existing mounts; if our path is already configured as PKI, no-op.
	mounts, err := c.listMounts(ctx)
	if err != nil {
		return fmt.Errorf("vault: list mounts: %w", err)
	}
	if existing, ok := mounts[mountPath+"/"]; ok {
		if existing != nil && strings.EqualFold(existing.Type, "pki") {
			return nil
		}
		return fmt.Errorf("vault: mount %q exists with type %q (not pki)", mountPath, existing.Type)
	}

	// Create.
	input := &vaultapi.MountInput{
		Type: "pki",
		Config: vaultapi.MountConfigInput{
			DefaultLeaseTTL: defaultTTL.String(),
			MaxLeaseTTL:     maxTTL.String(),
		},
	}
	callCtx, cancel := context.WithTimeout(ctx, c.cfg.Timeout)
	defer cancel()
	if err := c.api.Sys().MountWithContext(callCtx, mountPath, input); err != nil {
		// Concurrent creator may have raced; re-list once.
		if mounts2, e2 := c.listMounts(ctx); e2 == nil {
			if existing, ok := mounts2[mountPath+"/"]; ok && existing != nil && strings.EqualFold(existing.Type, "pki") {
				return nil
			}
		}
		return fmt.Errorf("vault: mount pki at %q: %w", mountPath, classifyError(err))
	}
	return nil
}

// listMounts returns the current mount table.
func (c *vaultClient) listMounts(ctx context.Context) (map[string]*vaultapi.MountOutput, error) {
	callCtx, cancel := context.WithTimeout(ctx, c.cfg.Timeout)
	defer cancel()
	return c.api.Sys().ListMountsWithContext(callCtx)
}

// GenerateRootCA generates an internal root CA at mountPath. If a root cert is
// already present (read on /ca/pem returns non-empty), the existing PEM is
// returned and no new root is generated.
func (c *vaultClient) GenerateRootCA(ctx context.Context, mountPath, commonName string, ttl time.Duration) (string, error) {
	if strings.TrimSpace(mountPath) == "" {
		return "", fmt.Errorf("vault: pki mount path is required")
	}
	if strings.TrimSpace(commonName) == "" {
		return "", fmt.Errorf("vault: common name is required")
	}
	if ttl <= 0 {
		return "", fmt.Errorf("vault: root CA ttl must be positive")
	}
	ctx, span := c.pkiSpan(ctx, opPKIRoot, mountPath)
	defer span.End()

	// Already present?
	if pem, err := c.readCAPEM(ctx, mountPath); err == nil && pem != "" {
		return pem, nil
	}

	secret, err := c.doWrite(ctx, pkiMountPath(mountPath, "root/generate/internal"), map[string]interface{}{
		"common_name": commonName,
		"ttl":         ttl.String(),
		"key_type":    "ec",
		"key_bits":    256,
	})
	if err != nil {
		return "", fmt.Errorf("vault: generate root CA at %q: %w", mountPath, err)
	}
	if secret == nil || secret.Data == nil {
		return "", fmt.Errorf("vault: empty root generate response: %w", ErrPKIIssueFailed)
	}
	certPEM, _ := secret.Data["certificate"].(string)
	if certPEM == "" {
		// Older Vault versions: re-read via /ca/pem.
		if pem, e2 := c.readCAPEM(ctx, mountPath); e2 == nil && pem != "" {
			return pem, nil
		}
		return "", fmt.Errorf("vault: root generate returned no certificate: %w", ErrPKIIssueFailed)
	}
	return certPEM, nil
}

// readCAPEM reads the CA cert at /ca/pem; returns "" if absent.
func (c *vaultClient) readCAPEM(ctx context.Context, mountPath string) (string, error) {
	callCtx, cancel := context.WithTimeout(ctx, c.cfg.Timeout)
	defer cancel()
	req := c.api.NewRequest("GET", "/v1/"+pkiMountPath(mountPath, "ca/pem"))
	resp, err := c.api.RawRequestWithContext(callCtx, req) //nolint:staticcheck // RawRequest is the documented way to fetch PEM blobs from Vault.
	if err != nil {
		return "", classifyError(err)
	}
	defer func() { _ = resp.Body.Close() }()
	buf := make([]byte, 0, 4096)
	tmp := make([]byte, 4096)
	for {
		n, rerr := resp.Body.Read(tmp)
		if n > 0 {
			buf = append(buf, tmp[:n]...)
		}
		if rerr != nil {
			break
		}
	}
	return strings.TrimSpace(string(buf)), nil
}

// EnsureIntermediate idempotently creates an intermediate CA at intermediateMount
// signed by rootMount. Returns the intermediate cert PEM (the leaf intermediate
// concatenated with the root, suitable as a CA chain).
//
// Idempotency: if the intermediate mount already has a CA cert, that cert is
// returned and no new CSR is generated.
func (c *vaultClient) EnsureIntermediate(ctx context.Context, rootMount, intermediateMount, commonName string, ttl time.Duration) (string, error) {
	if strings.TrimSpace(rootMount) == "" || strings.TrimSpace(intermediateMount) == "" {
		return "", fmt.Errorf("vault: root and intermediate mount paths are required")
	}
	if strings.TrimSpace(commonName) == "" {
		return "", fmt.Errorf("vault: common name is required")
	}
	if ttl <= 0 {
		return "", fmt.Errorf("vault: intermediate ttl must be positive")
	}
	ctx, span := c.pkiSpan(ctx, opPKIIntermediate, intermediateMount)
	defer span.End()

	// Already configured?
	if pem, err := c.readCAPEM(ctx, intermediateMount); err == nil && pem != "" {
		return pem, nil
	}

	// 1) Generate an internal CSR on the intermediate mount.
	csrSecret, err := c.doWrite(ctx, pkiMountPath(intermediateMount, "intermediate/generate/internal"), map[string]interface{}{
		"common_name": commonName,
		"key_type":    "ec",
		"key_bits":    256,
	})
	if err != nil {
		return "", fmt.Errorf("vault: generate intermediate CSR at %q: %w", intermediateMount, err)
	}
	if csrSecret == nil || csrSecret.Data == nil {
		return "", fmt.Errorf("vault: empty intermediate CSR response: %w", ErrPKIIssueFailed)
	}
	csr, _ := csrSecret.Data["csr"].(string)
	if csr == "" {
		return "", fmt.Errorf("vault: intermediate CSR missing: %w", ErrPKIIssueFailed)
	}

	// 2) Sign the CSR with the root.
	signSecret, err := c.doWrite(ctx, pkiMountPath(rootMount, "root/sign-intermediate"), map[string]interface{}{
		"csr":         csr,
		"common_name": commonName,
		"ttl":         ttl.String(),
		"format":      "pem",
	})
	if err != nil {
		return "", fmt.Errorf("vault: sign intermediate at %q: %w", rootMount, err)
	}
	if signSecret == nil || signSecret.Data == nil {
		return "", fmt.Errorf("vault: empty sign-intermediate response: %w", ErrPKIIssueFailed)
	}
	intermediatePEM, _ := signSecret.Data["certificate"].(string)
	if intermediatePEM == "" {
		return "", fmt.Errorf("vault: signed intermediate missing certificate: %w", ErrPKIIssueFailed)
	}

	// 3) Upload signed cert back to the intermediate mount.
	if _, err := c.doWrite(ctx, pkiMountPath(intermediateMount, "intermediate/set-signed"), map[string]interface{}{
		"certificate": intermediatePEM,
	}); err != nil {
		return "", fmt.Errorf("vault: set-signed intermediate at %q: %w", intermediateMount, err)
	}

	// 4) Build chain: intermediate || root (if available).
	chain := strings.TrimSpace(intermediatePEM)
	if rootPEM, err := c.readCAPEM(ctx, rootMount); err == nil && rootPEM != "" {
		chain = chain + "\n" + strings.TrimSpace(rootPEM)
	}
	return chain, nil
}

// EnsurePKIRole idempotently creates/updates a role for issuing leaf certs.
// Vault role writes are inherently idempotent (PUT semantics), so this method
// always writes the role with the current settings.
func (c *vaultClient) EnsurePKIRole(ctx context.Context, mountPath, roleName string, settings PKIRoleSettings) error {
	if strings.TrimSpace(mountPath) == "" {
		return fmt.Errorf("vault: pki mount path is required")
	}
	if strings.TrimSpace(roleName) == "" {
		return fmt.Errorf("vault: role name is required")
	}
	if settings.KeyType == "" {
		return fmt.Errorf("vault: role key_type is required")
	}
	if settings.KeyBits <= 0 {
		return fmt.Errorf("vault: role key_bits must be positive")
	}
	if settings.MaxTTL <= 0 || settings.DefaultTTL <= 0 {
		return fmt.Errorf("vault: role TTLs must be positive")
	}
	ctx, span := c.pkiSpan(ctx, opPKIRole, mountPath)
	defer span.End()

	body := map[string]interface{}{
		"allowed_domains":    settings.AllowedDomains,
		"allow_subdomains":   settings.AllowSubdomains,
		"allow_bare_domains": settings.AllowBareDomains,
		"allow_localhost":    settings.AllowLocalhost,
		"allow_ip_sans":      settings.AllowIPSANs,
		"enforce_hostnames":  settings.EnforceHostnames,
		"key_type":           settings.KeyType,
		"key_bits":           settings.KeyBits,
		"max_ttl":            settings.MaxTTL.String(),
		"ttl":                settings.DefaultTTL.String(),
		"client_flag":        settings.ClientFlag,
		"server_flag":        settings.ServerFlag,
	}
	if _, err := c.doWrite(ctx, pkiMountPath(mountPath, "roles/"+roleName), body); err != nil {
		return fmt.Errorf("vault: ensure pki role %q at %q: %w", roleName, mountPath, err)
	}
	return nil
}

// IssueLeaf signs the given CSR against the role and returns the leaf cert,
// CA chain, and serial. The private key NEVER traverses this service.
func (c *vaultClient) IssueLeaf(ctx context.Context, mountPath, roleName, csrPEM, commonName string, ttl time.Duration) (LeafCert, error) {
	if strings.TrimSpace(mountPath) == "" {
		return LeafCert{}, fmt.Errorf("vault: pki mount path is required")
	}
	if strings.TrimSpace(roleName) == "" {
		return LeafCert{}, fmt.Errorf("vault: role name is required")
	}
	if strings.TrimSpace(csrPEM) == "" {
		return LeafCert{}, fmt.Errorf("vault: csr is required")
	}
	if strings.TrimSpace(commonName) == "" {
		return LeafCert{}, fmt.Errorf("vault: common name is required")
	}
	if ttl <= 0 {
		return LeafCert{}, fmt.Errorf("vault: leaf ttl must be positive")
	}
	ctx, span := c.pkiSpan(ctx, opPKIIssueLeaf, mountPath)
	defer span.End()

	secret, err := c.doWrite(ctx, pkiMountPath(mountPath, "sign/"+roleName), map[string]interface{}{
		"csr":         csrPEM,
		"common_name": commonName,
		"ttl":         ttl.String(),
		"format":      "pem",
	})
	if err != nil {
		return LeafCert{}, fmt.Errorf("vault: issue leaf at %q/%s: %w", mountPath, roleName, err)
	}
	if secret == nil || secret.Data == nil {
		return LeafCert{}, fmt.Errorf("vault: empty leaf issue response: %w", ErrPKIIssueFailed)
	}

	certPEM, _ := secret.Data["certificate"].(string)
	if certPEM == "" {
		return LeafCert{}, fmt.Errorf("vault: leaf issue returned no certificate: %w", ErrPKIIssueFailed)
	}
	serial, _ := secret.Data["serial_number"].(string)
	caChain := pemList(secret.Data["ca_chain"])
	issuingCA, _ := secret.Data["issuing_ca"].(string)
	if caChain == "" && issuingCA != "" {
		caChain = issuingCA
	}

	// Expiration timestamps (Vault returns expiration as JSON number / int).
	notAfter := pkiExpiration(secret.Data)

	c.debugSafe(opPKIIssueLeaf, mountPath+"/"+roleName, 0)

	return LeafCert{
		CertPEM:    certPEM,
		CAChainPEM: caChain,
		Serial:     serial,
		NotBefore:  time.Now().UTC(),
		NotAfter:   notAfter,
	}, nil
}

// pemList flattens a Vault "ca_chain" response (string or []interface{}) into
// a newline-separated PEM bundle.
func pemList(v interface{}) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(t)
	case []interface{}:
		parts := make([]string, 0, len(t))
		for _, item := range t {
			if s, ok := item.(string); ok && strings.TrimSpace(s) != "" {
				parts = append(parts, strings.TrimSpace(s))
			}
		}
		return strings.Join(parts, "\n")
	}
	return ""
}

// pkiExpiration extracts the expiration timestamp from a Vault PKI response.
// Returns the zero time.Time if absent / unparseable.
func pkiExpiration(data map[string]interface{}) time.Time {
	raw, ok := data["expiration"]
	if !ok {
		return time.Time{}
	}
	var unix int64
	switch t := raw.(type) {
	case float64:
		unix = int64(t)
	case int64:
		unix = t
	case int:
		unix = int64(t)
	case json.Number:
		v, _ := t.Int64()
		unix = v
	default:
		return time.Time{}
	}
	if unix <= 0 {
		return time.Time{}
	}
	return time.Unix(unix, 0).UTC()
}

// RevokeLeaf revokes a leaf by serial. Vault returns 200 with the revocation
// timestamp, and is silently successful when re-revoking an already-revoked
// cert (the revocation_time field is unchanged).
func (c *vaultClient) RevokeLeaf(ctx context.Context, mountPath, serial string) error {
	if strings.TrimSpace(mountPath) == "" {
		return fmt.Errorf("vault: pki mount path is required")
	}
	if strings.TrimSpace(serial) == "" {
		return fmt.Errorf("vault: serial is required")
	}
	ctx, span := c.pkiSpan(ctx, opPKIRevokeLeaf, mountPath)
	defer span.End()

	if _, err := c.doWrite(ctx, pkiMountPath(mountPath, "revoke"), map[string]interface{}{
		"serial_number": serial,
	}); err != nil {
		return fmt.Errorf("vault: revoke leaf at %q: %w", mountPath, err)
	}
	return nil
}
