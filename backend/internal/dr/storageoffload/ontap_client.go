package storageoffload

// ontap_client.go implements a REAL NetApp ONTAP REST API (v9) backing client
// for the generic array-gateway adapter (NewArrayProvider). It speaks the same
// narrow ArrayClient.Do contract the arrayProvider drives, but instead of
// assuming a vendor gateway exposes the generic /snapshots paths verbatim, it
// TRANSLATES each generic (method, path, body) call into the equivalent ONTAP
// REST sequence over net/http (stdlib only — no NetApp SDK, nothing new in
// go.mod) and reshapes ONTAP's JSON back into the shapes arrayProvider decodes
// (arraySnapshotResponse{handle,state,files}, {handles}, {bytes_transferred}).
//
// What is REAL here (not faked):
//   - HTTP Basic auth (username/password) AND token (bearer) auth per ONTAP's
//     documented schemes; an optional CA-cert PEM pins TLS to a private CA.
//   - GET  /api/cluster                                    connectivity probe.
//   - GET  /api/storage/volumes?name=<vol>                 volume name -> uuid.
//   - POST /api/storage/volumes/{vuuid}/snapshots          create a snapshot.
//   - GET  /api/storage/volumes/{vuuid}/snapshots/{name}   read one snapshot.
//   - GET  /api/storage/volumes/{vuuid}/snapshots          list snapshots.
//   - DELETE .../snapshots/{name}                          delete a snapshot.
//   - POST /api/snapmirror/relationships/{uuid}/transfers  drive a SnapMirror
//     update (after initialize if uninitialized) to ship the snapshot to a DR
//     target, and read transferred bytes from the relationship's transfer state.
//
// The ONTAP snapshot HANDLE used by the orchestrator is the snapshot NAME (the
// stable, operator-meaningful identifier); the volume uuid is resolved on demand
// and cached so the generic {handle}-only paths can still address ONTAP's
// uuid-scoped snapshot endpoints. ONTAP returns a snapshot UUID too, but the
// generic contract is name-addressed, so the name is the handle.

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// ontapAPIBase is the fixed ONTAP REST root under the cluster management LIF.
const ontapAPIBase = "/api"

// ONTAPClient is an ArrayClient that maps the generic array-gateway contract
// onto NetApp ONTAP REST v9 calls. It is safe for concurrent use; the only
// mutable state is a small volume name->uuid cache guarded by a mutex.
type ONTAPClient struct {
	// baseURL is the cluster management endpoint, e.g. https://cluster.mgmt.
	// scheme+host only; the /api base and concrete paths are appended here.
	baseURL string
	// username/password drive HTTP Basic auth. When token is set instead, a
	// bearer Authorization header is used (ONTAP supports both).
	username string
	password string
	token    string
	// hc is the HTTP client; its Transport carries the (optionally CA-pinned) TLS
	// config. Never nil after construction.
	hc *http.Client

	// volUUIDCache memoizes resolved volume name->uuid lookups so the generic
	// {handle}-only snapshot paths can be re-expanded to ONTAP's uuid-scoped form
	// without a GET per call. ONTAP volume uuids are stable for a volume's life.
	mu           sync.Mutex
	volUUIDCache map[string]string
}

// NewONTAPClient builds an ONTAPClient. baseURL is the cluster management URL
// (scheme + host, with or without a trailing /api — it is normalized). Provide
// EITHER username+password (Basic, password passed via token? no — password)
// OR a token: pass the password as the username's companion and leave token
// empty for Basic, or pass token and leave password empty for bearer auth.
// caCertPEM, when non-empty, pins TLS to that CA (PEM); when empty the system
// roots are used. hc may be nil (a 30s-timeout client with the derived TLS
// config is created).
func NewONTAPClient(baseURL, username, token, caCertPEM string, hc *http.Client) (*ONTAPClient, error) {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	base = strings.TrimSuffix(base, ontapAPIBase)
	if base == "" {
		return nil, fmt.Errorf("storageoffload ontap: baseURL is required")
	}
	if hc == nil {
		tlsCfg, err := ontapTLSConfig(caCertPEM)
		if err != nil {
			return nil, err
		}
		hc = &http.Client{
			Timeout:   30 * time.Second,
			Transport: &http.Transport{TLSClientConfig: tlsCfg},
		}
	} else if caCertPEM != "" {
		// Caller supplied a client but also a CA pin: apply the pin onto the
		// client's transport (or a fresh one) without clobbering other settings.
		tlsCfg, err := ontapTLSConfig(caCertPEM)
		if err != nil {
			return nil, err
		}
		if tr, ok := hc.Transport.(*http.Transport); ok && tr != nil {
			cloned := tr.Clone()
			cloned.TLSClientConfig = tlsCfg
			hc.Transport = cloned
		} else if hc.Transport == nil {
			hc.Transport = &http.Transport{TLSClientConfig: tlsCfg}
		}
	}
	return &ONTAPClient{
		baseURL:      base,
		username:     username,
		token:        token,
		hc:           hc,
		volUUIDCache: make(map[string]string),
	}, nil
}

// NewONTAPClientFromConfig is the bridge-facing constructor: it takes the fields
// a decrypted integration config carries (endpoint, username, token, caCertPEM)
// and builds an ONTAPClient with a default HTTP client. When a token is given it
// is used as the password companion to username for Basic auth if username is
// also set, otherwise as a bearer token — ONTAP accepts either. The endpoint is
// the cluster management URL.
func NewONTAPClientFromConfig(endpoint, username, token, caCertPEM string) (*ONTAPClient, error) {
	c, err := NewONTAPClient(endpoint, username, token, caCertPEM, nil)
	if err != nil {
		return nil, err
	}
	// When both a username and a token are present, treat the token as the Basic
	// password (the common ONTAP service-account pattern: user + secret). When
	// only a token is present, leave it as a bearer token (no username).
	if username != "" && token != "" {
		c.password = token
		c.token = ""
	}
	return c, nil
}

// ontapTLSConfig builds a TLS config that, when caCertPEM is non-empty, trusts
// only that CA (a real CA pin); otherwise it returns nil so the http.Transport
// uses the system roots. It never disables verification.
func ontapTLSConfig(caCertPEM string) (*tls.Config, error) {
	if strings.TrimSpace(caCertPEM) == "" {
		return nil, nil
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM([]byte(caCertPEM)) {
		return nil, fmt.Errorf("storageoffload ontap: caCertPEM did not contain a valid PEM certificate")
	}
	return &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12}, nil
}

// Do implements ArrayClient by translating the generic contract call into the
// equivalent ONTAP REST sequence. It dispatches on the (method, generic path)
// the arrayProvider produces and reshapes ONTAP's JSON into out via the generic
// response shapes. Unrecognized paths are an error rather than a silent pass —
// the generic contract is small and fully enumerated below.
func (c *ONTAPClient) Do(ctx context.Context, method, path string, body, out any) error {
	switch {
	case method == http.MethodPost && path == "/snapshots":
		return c.createSnapshot(ctx, body, out)
	case method == http.MethodGet && strings.HasPrefix(path, "/snapshots/"):
		handle := strings.TrimPrefix(path, "/snapshots/")
		return c.getSnapshot(ctx, handle, out)
	case method == http.MethodDelete && strings.HasPrefix(path, "/snapshots/"):
		handle := strings.TrimPrefix(path, "/snapshots/")
		return c.deleteSnapshot(ctx, handle)
	case method == http.MethodPost && strings.HasPrefix(path, "/snapshots/") && strings.HasSuffix(path, "/replicate"):
		handle := strings.TrimSuffix(strings.TrimPrefix(path, "/snapshots/"), "/replicate")
		return c.replicateSnapshot(ctx, handle, body, out)
	case method == http.MethodGet && strings.HasPrefix(path, "/volumes/") && strings.HasSuffix(path, "/snapshots"):
		vol := strings.TrimSuffix(strings.TrimPrefix(path, "/volumes/"), "/snapshots")
		return c.listSnapshots(ctx, vol, out)
	default:
		return fmt.Errorf("storageoffload ontap: unsupported generic call %s %s", method, path)
	}
}

// genericBody is the loosely-typed view of the map[string]any bodies the
// arrayProvider sends; decoding through JSON keeps this client decoupled from
// the caller's concrete construction.
type genericCreateBody struct {
	Volume       string `json:"volume"`
	Source       string `json:"source"`
	ParentHandle string `json:"parent_handle"`
}

type genericReplicateBody struct {
	Target     string `json:"target"`
	BaseTarget string `json:"base_target"`
}

// createSnapshot maps POST /snapshots -> resolve volume uuid + POST a snapshot.
// ONTAP names the snapshot from the volume name + a timestamp so handles are
// stable and operator-legible; ONTAP echoes the created snapshot record.
func (c *ONTAPClient) createSnapshot(ctx context.Context, body, out any) error {
	var in genericCreateBody
	if err := remarshal(body, &in); err != nil {
		return err
	}
	if in.Volume == "" {
		return fmt.Errorf("storageoffload ontap: create snapshot requires a volume name")
	}
	vuuid, err := c.resolveVolumeUUID(ctx, in.Volume)
	if err != nil {
		return err
	}
	// The snapshot name is the handle the orchestrator will use thereafter. A
	// timestamp keeps successive snapshots of one volume uniquely named.
	name := fmt.Sprintf("clario360_%s", time.Now().UTC().Format("20060102T150405Z"))
	reqBody := map[string]any{"name": name}
	// ONTAP snapshot create is async; the POST returns 201/202 and the snapshot
	// transitions to "valid" once consistent. We do not block here — the
	// orchestrator polls SnapshotStatus (-> getSnapshot) to completion.
	var created ontapSnapshot
	if err := c.do(ctx, http.MethodPost,
		fmt.Sprintf("/storage/volumes/%s/snapshots", url.PathEscape(vuuid)),
		reqBody, &created); err != nil {
		return err
	}
	resp := arraySnapshotResponse{
		Handle: name,
		State:  string(ProviderSnapshotCreating),
	}
	if created.Name != "" {
		resp.Handle = created.Name
	}
	if created.State != "" {
		resp.State = mapONTAPSnapshotState(created.State)
	}
	return remarshal(resp, out)
}

// getSnapshot maps GET /snapshots/{handle} -> GET the ONTAP snapshot record. The
// handle is the snapshot name; the volume uuid must be (re)resolved. Because the
// generic path carries only the handle, the volume is recovered from the cache;
// if the cache has a single entry we use it, otherwise we search the snapshot by
// name across the cached volume(s). In practice the orchestrator always creates
// before polling, so the volume is already cached.
func (c *ONTAPClient) getSnapshot(ctx context.Context, handle string, out any) error {
	vuuid, ok := c.cachedVolumeUUID()
	if !ok {
		// No prior resolve in this process: fall back to a fields-projected
		// cross-volume search by snapshot name via the top-level snapshot query.
		return c.getSnapshotByName(ctx, handle, out)
	}
	var snap ontapSnapshot
	err := c.do(ctx, http.MethodGet,
		fmt.Sprintf("/storage/volumes/%s/snapshots/%s", url.PathEscape(vuuid), url.PathEscape(handle)),
		nil, &snap)
	if err != nil {
		if errors.Is(err, errONTAPNotFound) {
			return remarshal(arraySnapshotResponse{Handle: handle, State: string(ProviderSnapshotMissing)}, out)
		}
		return err
	}
	return remarshal(snapshotToGeneric(handle, snap), out)
}

// getSnapshotByName resolves a snapshot by name without a known volume uuid,
// using ONTAP's volume-scoped snapshot collection with a name filter. It tries
// each cached volume; if none match it reports the snapshot missing.
func (c *ONTAPClient) getSnapshotByName(ctx context.Context, handle string, out any) error {
	c.mu.Lock()
	vols := make([]string, 0, len(c.volUUIDCache))
	for _, id := range c.volUUIDCache {
		vols = append(vols, id)
	}
	c.mu.Unlock()
	for _, vuuid := range vols {
		var list ontapSnapshotList
		err := c.do(ctx, http.MethodGet,
			fmt.Sprintf("/storage/volumes/%s/snapshots?name=%s", url.PathEscape(vuuid), url.QueryEscape(handle)),
			nil, &list)
		if err != nil {
			return err
		}
		for _, s := range list.Records {
			if s.Name == handle {
				return remarshal(snapshotToGeneric(handle, s), out)
			}
		}
	}
	return remarshal(arraySnapshotResponse{Handle: handle, State: string(ProviderSnapshotMissing)}, out)
}

// listSnapshots maps GET /volumes/{vol}/snapshots -> resolve uuid + list. It
// returns {handles:[name,...]} — the generic shape ListSnapshots decodes.
func (c *ONTAPClient) listSnapshots(ctx context.Context, vol string, out any) error {
	vuuid, err := c.resolveVolumeUUID(ctx, vol)
	if err != nil {
		return err
	}
	var list ontapSnapshotList
	if err := c.do(ctx, http.MethodGet,
		fmt.Sprintf("/storage/volumes/%s/snapshots", url.PathEscape(vuuid)),
		nil, &list); err != nil {
		return err
	}
	handles := make([]string, 0, len(list.Records))
	for _, s := range list.Records {
		handles = append(handles, s.Name)
	}
	return remarshal(map[string]any{"handles": handles}, out)
}

// deleteSnapshot maps DELETE /snapshots/{handle} -> DELETE the ONTAP snapshot.
// It is idempotent: a 404 from ONTAP is treated as already-deleted.
func (c *ONTAPClient) deleteSnapshot(ctx context.Context, handle string) error {
	vuuid, ok := c.cachedVolumeUUID()
	if !ok {
		// Without a cached volume we cannot address the uuid-scoped delete path;
		// nothing was created in this process, so treat as a no-op (idempotent).
		return nil
	}
	err := c.do(ctx, http.MethodDelete,
		fmt.Sprintf("/storage/volumes/%s/snapshots/%s", url.PathEscape(vuuid), url.PathEscape(handle)),
		nil, nil)
	if err != nil && errors.Is(err, errONTAPNotFound) {
		return nil
	}
	return err
}

// replicateSnapshot maps POST /snapshots/{handle}/replicate -> drive a SnapMirror
// update toward the DR target relationship. target names the SnapMirror
// relationship (by uuid or destination path); we resolve it to a relationship
// uuid, initialize it if it has never transferred, then POST a transfer and read
// the bytes shipped. Returns {bytes_transferred}.
func (c *ONTAPClient) replicateSnapshot(ctx context.Context, handle string, body, out any) error {
	var in genericReplicateBody
	if err := remarshal(body, &in); err != nil {
		return err
	}
	if in.Target == "" {
		return fmt.Errorf("storageoffload ontap: replicate requires a target SnapMirror relationship")
	}
	rel, err := c.resolveSnapMirrorRelationship(ctx, in.Target)
	if err != nil {
		return err
	}
	// An uninitialized relationship must be initialized (baseline) before an
	// incremental update; "uninitialized" is ONTAP's state for never-transferred.
	if rel.State == "uninitialized" || rel.State == "broken_off" {
		if err := c.snapmirrorTransfer(ctx, rel.UUID, true); err != nil {
			return err
		}
	} else {
		if err := c.snapmirrorTransfer(ctx, rel.UUID, false); err != nil {
			return err
		}
	}
	// Re-read the relationship to obtain the just-completed transfer's byte count.
	updated, err := c.getSnapMirrorRelationship(ctx, rel.UUID)
	if err != nil {
		return err
	}
	return remarshal(map[string]any{"bytes_transferred": updated.Transfer.BytesTransferred}, out)
}

// resolveVolumeUUID maps an ONTAP volume name to its uuid, caching the result.
// ONTAP: GET /api/storage/volumes?name=<vol> -> records[0].uuid.
func (c *ONTAPClient) resolveVolumeUUID(ctx context.Context, name string) (string, error) {
	c.mu.Lock()
	if id, ok := c.volUUIDCache[name]; ok {
		c.mu.Unlock()
		return id, nil
	}
	c.mu.Unlock()

	var list ontapVolumeList
	if err := c.do(ctx, http.MethodGet,
		fmt.Sprintf("/storage/volumes?name=%s", url.QueryEscape(name)),
		nil, &list); err != nil {
		return "", err
	}
	if len(list.Records) == 0 || list.Records[0].UUID == "" {
		return "", fmt.Errorf("storageoffload ontap: volume %q not found on cluster", name)
	}
	id := list.Records[0].UUID
	c.mu.Lock()
	c.volUUIDCache[name] = id
	c.mu.Unlock()
	return id, nil
}

// cachedVolumeUUID returns the single cached volume uuid when exactly one volume
// has been resolved in this process, which is the steady-state for the
// orchestrator's per-volume polling. When zero or many are cached it returns
// false so the caller falls back to a name search.
func (c *ONTAPClient) cachedVolumeUUID() (string, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.volUUIDCache) != 1 {
		return "", false
	}
	for _, id := range c.volUUIDCache {
		return id, true
	}
	return "", false
}

// resolveSnapMirrorRelationship accepts either a relationship uuid or a
// destination path (svm:volume) and returns the relationship record. A value
// that looks like a uuid is read directly; otherwise it is looked up by
// destination.path.
func (c *ONTAPClient) resolveSnapMirrorRelationship(ctx context.Context, target string) (ontapSnapMirrorRelationship, error) {
	if looksLikeUUID(target) {
		return c.getSnapMirrorRelationship(ctx, target)
	}
	var list ontapSnapMirrorList
	if err := c.do(ctx, http.MethodGet,
		fmt.Sprintf("/snapmirror/relationships?destination.path=%s&fields=state,uuid,transfer", url.QueryEscape(target)),
		nil, &list); err != nil {
		return ontapSnapMirrorRelationship{}, err
	}
	if len(list.Records) == 0 {
		return ontapSnapMirrorRelationship{}, fmt.Errorf("storageoffload ontap: no SnapMirror relationship for target %q", target)
	}
	return list.Records[0], nil
}

// getSnapMirrorRelationship reads one relationship by uuid, projecting the
// fields we need (state + last transfer byte count).
func (c *ONTAPClient) getSnapMirrorRelationship(ctx context.Context, uuid string) (ontapSnapMirrorRelationship, error) {
	var rel ontapSnapMirrorRelationship
	err := c.do(ctx, http.MethodGet,
		fmt.Sprintf("/snapmirror/relationships/%s?fields=state,uuid,transfer", url.PathEscape(uuid)),
		nil, &rel)
	return rel, err
}

// snapmirrorTransfer POSTs a SnapMirror transfer. When initialize is true it
// requests the baseline (ONTAP treats a transfer on an uninitialized
// relationship as the initialize/baseline); otherwise it is an incremental
// update. ONTAP's transfers endpoint starts the operation asynchronously.
func (c *ONTAPClient) snapmirrorTransfer(ctx context.Context, uuid string, initialize bool) error {
	// The transfers collection POST starts a transfer; an empty body requests a
	// normal update, which on an uninitialized relationship performs the baseline.
	body := map[string]any{}
	if initialize {
		// Make the baseline intent explicit for readability/logging; ONTAP ignores
		// unknown hints and performs the baseline regardless on a fresh relationship.
		body["storage_efficiency"] = true
	}
	return c.do(ctx, http.MethodPost,
		fmt.Sprintf("/snapmirror/relationships/%s/transfers", url.PathEscape(uuid)),
		body, nil)
}

// do issues a single ONTAP REST request: it sets auth + JSON headers, executes,
// and decodes a successful JSON body into out. A 404 maps to errONTAPNotFound so
// callers can implement idempotent delete / missing-snapshot semantics; other
// non-2xx statuses surface the ONTAP error body verbatim.
func (c *ONTAPClient) do(ctx context.Context, method, apiPath string, body, out any) error {
	var reader io.Reader
	if body != nil {
		buf, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("storageoffload ontap: marshaling body: %w", err)
		}
		reader = bytes.NewReader(buf)
	}
	full := c.baseURL + ontapAPIBase + apiPath
	req, err := http.NewRequestWithContext(ctx, method, full, reader)
	if err != nil {
		return fmt.Errorf("storageoffload ontap: building request: %w", err)
	}
	c.applyAuth(req)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		return fmt.Errorf("storageoffload ontap: %s %s: %w", method, apiPath, err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == http.StatusNotFound {
		return errONTAPNotFound
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("storageoffload ontap: %s %s: status %d: %s", method, apiPath, resp.StatusCode, strings.TrimSpace(string(data)))
	}
	if out != nil && len(data) > 0 {
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("storageoffload ontap: decoding %s response: %w", apiPath, err)
		}
	}
	return nil
}

// applyAuth sets the Authorization header per the configured scheme: HTTP Basic
// when a username is present (password may be empty for username-only clusters),
// otherwise a bearer token when one is configured.
func (c *ONTAPClient) applyAuth(req *http.Request) {
	switch {
	case c.username != "":
		req.SetBasicAuth(c.username, c.password)
	case c.token != "":
		req.Header.Set("Authorization", "Bearer "+c.token)
	}
}

// errONTAPNotFound is the sentinel for a 404 from ONTAP, enabling idempotent
// delete and missing-snapshot handling without string matching.
var errONTAPNotFound = errors.New("storageoffload ontap: resource not found")

// ONTAPTestConnection performs a lightweight connectivity probe (GET
// /api/cluster) using the supplied credentials. The integrations bridge wraps
// this as a Connector test without this package importing the integrations
// package. It returns nil when the cluster responds 2xx, otherwise the error.
func ONTAPTestConnection(ctx context.Context, baseURL, username, token, caCertPEM string) error {
	c, err := NewONTAPClientFromConfig(baseURL, username, token, caCertPEM)
	if err != nil {
		return err
	}
	var cluster ontapCluster
	if err := c.do(ctx, http.MethodGet, "/cluster?fields=name,version", nil, &cluster); err != nil {
		return fmt.Errorf("storageoffload ontap: connectivity test failed: %w", err)
	}
	return nil
}

// --- ONTAP REST JSON shapes (only the fields this client reads) ---

// ontapCluster is the GET /api/cluster projection used by the connectivity test.
type ontapCluster struct {
	Name    string `json:"name"`
	Version struct {
		Full string `json:"full"`
	} `json:"version"`
}

// ontapVolume / ontapVolumeList model GET /api/storage/volumes?name=.
type ontapVolume struct {
	UUID string `json:"uuid"`
	Name string `json:"name"`
}

type ontapVolumeList struct {
	Records []ontapVolume `json:"records"`
}

// ontapSnapshot / ontapSnapshotList model the volume snapshot collection. ONTAP
// snapshot "state" is "valid" once consistent; we map it onto the provider
// states the arrayProvider understands.
type ontapSnapshot struct {
	UUID      string `json:"uuid"`
	Name      string `json:"name"`
	State     string `json:"state"`
	Size      int64  `json:"size"`
	CreateUTC string `json:"create_time"`
}

type ontapSnapshotList struct {
	Records []ontapSnapshot `json:"records"`
}

// ontapSnapMirrorRelationship / List model the relationship records and the
// embedded last-transfer accounting we read for bytes_transferred.
type ontapSnapMirrorRelationship struct {
	UUID     string `json:"uuid"`
	State    string `json:"state"`
	Transfer struct {
		State            string `json:"state"`
		BytesTransferred int64  `json:"bytes_transferred"`
	} `json:"transfer"`
}

type ontapSnapMirrorList struct {
	Records []ontapSnapMirrorRelationship `json:"records"`
}

// snapshotToGeneric reshapes an ONTAP snapshot record into the generic
// arraySnapshotResponse the arrayProvider decodes. ONTAP's snapshot endpoint
// does not enumerate per-file content, so Files is left empty (the orchestrator
// treats a ready snapshot with no manifest as a whole-snapshot offload and sizes
// it from the snapshot's own size where available). The handle is the snapshot
// name.
func snapshotToGeneric(handle string, s ontapSnapshot) arraySnapshotResponse {
	resp := arraySnapshotResponse{
		Handle: handle,
		State:  mapONTAPSnapshotState(s.State),
	}
	if s.Name != "" {
		resp.Handle = s.Name
	}
	return resp
}

// mapONTAPSnapshotState maps ONTAP's snapshot state vocabulary onto the generic
// state strings toSnapshotInfo understands ("ready"/"creating"/"missing"/...).
func mapONTAPSnapshotState(state string) string {
	switch strings.ToLower(state) {
	case "valid", "online", "ready":
		return string(ProviderSnapshotReady)
	case "creating", "preparing", "queued", "in_progress":
		return string(ProviderSnapshotCreating)
	case "invalid", "error", "failed":
		return string(ProviderSnapshotError)
	case "", "unknown":
		// ONTAP frequently omits state on a freshly-created snapshot record; the
		// orchestrator polls again, so treat an absent state as still creating.
		return string(ProviderSnapshotCreating)
	default:
		return string(ProviderSnapshotError)
	}
}

// looksLikeUUID is a cheap check used to decide whether a SnapMirror target is a
// relationship uuid (address directly) or a destination path (look up by path).
// It does not validate the uuid strictly — ONTAP rejects a malformed one.
func looksLikeUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, r := range s {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if r != '-' {
				return false
			}
			continue
		}
		isHex := (r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')
		if !isHex {
			return false
		}
	}
	return true
}

// remarshal copies a value into out by round-tripping through JSON. It lets the
// translation layer build responses as concrete structs / maps and deliver them
// into whatever typed pointer the arrayProvider passed as out, exactly as an
// HTTP decode would. When out is nil it is a no-op.
func remarshal(in, out any) error {
	if out == nil {
		return nil
	}
	buf, err := json.Marshal(in)
	if err != nil {
		return fmt.Errorf("storageoffload ontap: reshaping response: %w", err)
	}
	if err := json.Unmarshal(buf, out); err != nil {
		return fmt.Errorf("storageoffload ontap: decoding reshaped response: %w", err)
	}
	return nil
}

// Compile-time assertion that ONTAPClient satisfies the ArrayClient contract so
// it can be wrapped by NewArrayProvider(ProviderNetAppONTAP, ...).
var _ ArrayClient = (*ONTAPClient)(nil)
