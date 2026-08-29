package provider

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"path"
	"strconv"
	"strings"
	"time"
)

const (
	k8sSettingNamespace       = "namespace"
	k8sSettingNamespacePrefix = "namespace_prefix"
	k8sSettingImage           = "image"
	k8sSettingCommand         = "command"
	k8sSettingInsecureSkipTLS = "insecure_skip_tls_verify"
	k8sSettingDeleteNamespace = "delete_namespace_on_teardown"
)

// KubernetesAdapter talks directly to the Kubernetes API server. It creates an
// idempotent recovery namespace, stores recovery metadata/payload as a Secret,
// and optionally launches a recovery Job when an image is configured.
type KubernetesAdapter struct {
	cfg    Config
	client *http.Client
}

func NewKubernetesAdapter(cfg Config) *KubernetesAdapter {
	cfg.Kind = normalizeKind(firstNonEmpty(cfg.Kind, KindKubernetes))
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if boolSetting(cfg, k8sSettingInsecureSkipTLS) {
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} //nolint:gosec // explicit deployment opt-in for private API servers.
	}
	return &KubernetesAdapter{
		cfg: cfg,
		client: &http.Client{
			Timeout:   2 * time.Minute,
			Transport: transport,
		},
	}
}

func (a *KubernetesAdapter) Capabilities() Capabilities {
	return Capabilities{
		Kind:                KindKubernetes,
		DisplayName:         "Kubernetes",
		Live:                true,
		SDKBacked:           true,
		SupportsEnsure:      true,
		SupportsTeardown:    true,
		SupportsDrill:       true,
		SupportsIdempotency: true,
		RegulatedCompatible: true,
		RequiredConfig:      []string{"endpoint", "credential_ref", "cluster", "token"},
		Notes: []string{
			"uses the Kubernetes API server for live namespace, secret, and optional job operations",
		},
	}
}

func (a *KubernetesAdapter) Validate(cfg Config) error {
	if cfg.Kind == "" {
		cfg.Kind = a.cfg.Kind
	}
	if err := missingRequired(cfg, "endpoint", "credential_ref", "cluster"); err != nil {
		return err
	}
	if k8sToken(cfg) == "" {
		return fmt.Errorf("%w: Kubernetes bearer token setting is required", ErrNotConfigured)
	}
	return nil
}

func (a *KubernetesAdapter) Ensure(ctx context.Context, req EnsureRequest) (EnsureResult, error) {
	if err := a.Validate(a.cfg); err != nil {
		return EnsureResult{}, err
	}
	namespace := k8sNamespace(a.cfg, req)
	secretName := k8sResourceName("clario-dr-recovery", req.IdempotencyKey)
	if err := a.createNamespace(ctx, namespace, req); err != nil {
		return EnsureResult{}, err
	}
	secretAlready, err := a.applySecret(ctx, namespace, secretName, req)
	if err != nil {
		return EnsureResult{}, err
	}
	jobName := ""
	jobAlready := false
	if image := strings.TrimSpace(setting(a.cfg, k8sSettingImage)); image != "" {
		jobName = k8sResourceName("clario-dr-recover", req.IdempotencyKey)
		jobAlready, err = a.applyJob(ctx, namespace, jobName, secretName, image, req)
		if err != nil {
			return EnsureResult{}, err
		}
	}
	externalID := fmt.Sprintf("kubernetes:%s:%s:%s", a.cfg.Cluster, namespace, secretName)
	if jobName != "" {
		externalID = fmt.Sprintf("kubernetes:%s:%s:%s", a.cfg.Cluster, namespace, jobName)
	}
	return EnsureResult{
		ExternalID: externalID,
		Already:    secretAlready || jobAlready,
		Metadata: map[string]string{
			"cluster":   a.cfg.Cluster,
			"namespace": namespace,
			"secret":    secretName,
			"job":       jobName,
			"provider":  KindKubernetes,
			"drill":     strconv.FormatBool(req.Drill),
			"site_id":   req.SiteID,
			"stream_id": req.StreamID,
		},
	}, nil
}

func (a *KubernetesAdapter) Teardown(ctx context.Context, req TeardownRequest) error {
	if err := a.Validate(a.cfg); err != nil {
		return err
	}
	_, namespace, resource := parseK8sExternalID(req.ExternalID)
	if namespace == "" {
		namespace = k8sNamespace(a.cfg, req.EnsureRequest)
	}
	if boolSetting(a.cfg, k8sSettingDeleteNamespace) {
		return a.k8s(ctx, http.MethodDelete, "/api/v1/namespaces/"+url.PathEscape(namespace), nil, nil, http.StatusOK, http.StatusAccepted, http.StatusNotFound)
	}
	if resource != "" && strings.Contains(resource, "recover") {
		if err := a.k8s(ctx, http.MethodDelete, "/apis/batch/v1/namespaces/"+url.PathEscape(namespace)+"/jobs/"+url.PathEscape(resource), nil, nil, http.StatusOK, http.StatusAccepted, http.StatusNotFound); err != nil {
			return err
		}
	}
	secretName := k8sResourceName("clario-dr-recovery", req.IdempotencyKey)
	if resource != "" && strings.Contains(resource, "recovery") {
		secretName = resource
	}
	return a.k8s(ctx, http.MethodDelete, "/api/v1/namespaces/"+url.PathEscape(namespace)+"/secrets/"+url.PathEscape(secretName), nil, nil, http.StatusOK, http.StatusAccepted, http.StatusNotFound)
}

func (a *KubernetesAdapter) createNamespace(ctx context.Context, namespace string, req EnsureRequest) error {
	body := map[string]any{
		"apiVersion": "v1",
		"kind":       "Namespace",
		"metadata": map[string]any{
			"name": namespace,
			"labels": map[string]string{
				"app.kubernetes.io/managed-by": "clario360",
				"clario360.io/component":       "dr-recovery",
				"clario360.io/tenant-id":       req.TenantID,
			},
			"annotations": map[string]string{
				"clario360.io/idempotency-key": req.IdempotencyKey,
				"clario360.io/group-id":        req.GroupID,
				"clario360.io/site-id":         req.SiteID,
			},
		},
	}
	return a.k8s(ctx, http.MethodPost, "/api/v1/namespaces", body, nil, http.StatusOK, http.StatusCreated, http.StatusConflict)
}

func (a *KubernetesAdapter) applySecret(ctx context.Context, namespace, secretName string, req EnsureRequest) (bool, error) {
	body := map[string]any{
		"apiVersion": "v1",
		"kind":       "Secret",
		"type":       "Opaque",
		"metadata":   k8sMetadata(secretName, req),
		"data": map[string]string{
			"payload": base64.StdEncoding.EncodeToString(req.Plaintext),
		},
		"stringData": map[string]string{
			"object_key":               req.ObjectKey,
			"recovery_endpoint":        req.RecoveryEndpoint,
			"instant_session_id":       req.InstantSessionID,
			"instant_overlay_location": req.InstantOverlayLocation,
			"profile":                  req.Profile,
		},
	}
	createPath := "/api/v1/namespaces/" + url.PathEscape(namespace) + "/secrets"
	err := a.k8s(ctx, http.MethodPost, createPath, body, nil, http.StatusOK, http.StatusCreated)
	if err == nil {
		return false, nil
	}
	if !strings.Contains(err.Error(), "http 409") {
		return false, err
	}
	replacePath := createPath + "/" + url.PathEscape(secretName)
	return true, a.k8s(ctx, http.MethodPut, replacePath, body, nil, http.StatusOK, http.StatusCreated)
}

func (a *KubernetesAdapter) applyJob(ctx context.Context, namespace, jobName, secretName, image string, req EnsureRequest) (bool, error) {
	container := map[string]any{
		"name":  "recover",
		"image": image,
		"env": []map[string]string{
			{"name": "CLARIO_DR_TENANT_ID", "value": req.TenantID},
			{"name": "CLARIO_DR_GROUP_ID", "value": req.GroupID},
			{"name": "CLARIO_DR_SITE_ID", "value": req.SiteID},
			{"name": "CLARIO_DR_STREAM_ID", "value": req.StreamID},
			{"name": "CLARIO_DR_SECRET_NAME", "value": secretName},
		},
	}
	if command := strings.TrimSpace(setting(a.cfg, k8sSettingCommand)); command != "" {
		container["command"] = []string{"/bin/sh", "-lc", command}
	}
	body := map[string]any{
		"apiVersion": "batch/v1",
		"kind":       "Job",
		"metadata":   k8sMetadata(jobName, req),
		"spec": map[string]any{
			"backoffLimit": intSetting(a.cfg, "backoff_limit", 1),
			"template": map[string]any{
				"metadata": map[string]any{
					"labels": map[string]string{"clario360.io/dr-run": k8sSafe(req.IdempotencyKey, 40)},
				},
				"spec": map[string]any{
					"restartPolicy": "Never",
					"containers":    []map[string]any{container},
				},
			},
		},
	}
	createPath := "/apis/batch/v1/namespaces/" + url.PathEscape(namespace) + "/jobs"
	err := a.k8s(ctx, http.MethodPost, createPath, body, nil, http.StatusOK, http.StatusCreated)
	if err == nil {
		return false, nil
	}
	if strings.Contains(err.Error(), "http 409") {
		return true, nil
	}
	return false, err
}

func (a *KubernetesAdapter) k8s(ctx context.Context, method, p string, body any, out any, okStatuses ...int) error {
	endpoint, err := joinURL(a.cfg.Endpoint, p)
	if err != nil {
		return err
	}
	var reader *bytes.Reader
	if body == nil {
		reader = bytes.NewReader(nil)
	} else {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", "Bearer "+k8sToken(a.cfg))
	resp, err := a.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	for _, status := range okStatuses {
		if resp.StatusCode == status {
			if out != nil {
				return json.NewDecoder(resp.Body).Decode(out)
			}
			return nil
		}
	}
	return fmt.Errorf("kubernetes provider %s %s failed: http %d", method, p, resp.StatusCode)
}

func k8sMetadata(name string, req EnsureRequest) map[string]any {
	return map[string]any{
		"name": name,
		"labels": map[string]string{
			"app.kubernetes.io/managed-by": "clario360",
			"clario360.io/component":       "dr-recovery",
			"clario360.io/tenant-id":       req.TenantID,
		},
		"annotations": map[string]string{
			"clario360.io/idempotency-key": req.IdempotencyKey,
			"clario360.io/group-id":        req.GroupID,
			"clario360.io/site-id":         req.SiteID,
			"clario360.io/stream-id":       req.StreamID,
		},
	}
}

func k8sNamespace(cfg Config, req EnsureRequest) string {
	if ns := strings.TrimSpace(setting(cfg, k8sSettingNamespace)); ns != "" {
		return k8sSafe(ns, 63)
	}
	prefix := firstNonEmpty(setting(cfg, k8sSettingNamespacePrefix), "clario-dr")
	suffix := req.SiteID
	if suffix == "" {
		suffix = req.GroupID
	}
	return k8sSafe(prefix+"-"+suffix, 63)
}

func k8sResourceName(prefix, key string) string {
	if strings.TrimSpace(key) == "" {
		key = time.Now().UTC().Format("20060102150405")
	}
	sum := sha256.Sum256([]byte(key))
	return k8sSafe(prefix+"-"+hex.EncodeToString(sum[:])[:12], 63)
}

func k8sSafe(value string, maxLen int) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var b strings.Builder
	lastDash := false
	for _, r := range value {
		ok := (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')
		if ok {
			b.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash {
			b.WriteByte('-')
			lastDash = true
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		out = "clario-dr"
	}
	if maxLen > 0 && len(out) > maxLen {
		out = strings.Trim(out[:maxLen], "-")
	}
	return out
}

func k8sToken(cfg Config) string {
	return firstNonEmpty(setting(cfg, settingBearerToken), setting(cfg, settingToken), setting(cfg, settingAPIToken))
}

func setting(cfg Config, key string) string {
	if cfg.Settings == nil {
		return ""
	}
	return strings.TrimSpace(cfg.Settings[key])
}

func boolSetting(cfg Config, key string) bool {
	v := strings.ToLower(setting(cfg, key))
	return v == "1" || v == "true" || v == "yes"
}

func intSetting(cfg Config, key string, fallback int) int {
	v := setting(cfg, key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
}

func joinURL(base, p string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(base))
	if err != nil {
		return "", err
	}
	parsed.Path = path.Join(parsed.Path, p)
	return parsed.String(), nil
}

func parseK8sExternalID(externalID string) (cluster, namespace, resource string) {
	parts := strings.Split(externalID, ":")
	if len(parts) >= 4 && parts[0] == "kubernetes" {
		return parts[1], parts[2], parts[3]
	}
	return "", "", ""
}
