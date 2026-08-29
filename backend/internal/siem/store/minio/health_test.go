package minio

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/siem/store/storetypes"
)

// fakeS3 emulates the subset of S3 endpoints exercised by BucketHealthy,
// WORMSelfTest, Get, and Stat. It is intentionally permissive: as long as
// a sensible XML response is returned, minio-go is happy.
type fakeS3 struct {
	srv *httptest.Server

	mu               sync.Mutex
	listObjectsBody  string
	listObjectsStat  int
	encryptionStatus int
	encryptionBody   string
	bucketExists     bool
	putStatus        int
	removeStatus     int
	removeBody       string
	headObjectStatus int
	headObjectETag   string
}

func newFakeS3() *fakeS3 {
	f := &fakeS3{
		listObjectsBody:  `<?xml version="1.0"?><ListBucketResult><Contents><Key>__siem_self_test/sentinel</Key><Size>1</Size></Contents></ListBucketResult>`,
		listObjectsStat:  200,
		encryptionStatus: 200,
		encryptionBody:   `<?xml version="1.0"?><ServerSideEncryptionConfiguration><Rule><ApplyServerSideEncryptionByDefault><SSEAlgorithm>AES256</SSEAlgorithm></ApplyServerSideEncryptionByDefault></Rule></ServerSideEncryptionConfiguration>`,
		bucketExists:     true,
		putStatus:        200,
		removeStatus:     403,
		removeBody:       `<?xml version="1.0"?><Error><Code>AccessDenied</Code><Message>object is WORM protected</Message></Error>`,
		headObjectStatus: 200,
		headObjectETag:   `"deadbeef"`,
	}
	f.srv = httptest.NewServer(http.HandlerFunc(f.handle))
	return f
}

func (f *fakeS3) Close() { f.srv.Close() }

func (f *fakeS3) endpoint() string {
	u, _ := url.Parse(f.srv.URL)
	return u.Host
}

func (f *fakeS3) handle(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	switch {
	case r.Method == http.MethodHead && r.URL.Path == "/" || (r.Method == http.MethodHead && !strings.Contains(r.URL.Path, "/")):
		f.mu.Lock()
		ok := f.bucketExists
		f.mu.Unlock()
		if ok {
			w.WriteHeader(200)
		} else {
			w.WriteHeader(404)
		}
	case r.Method == http.MethodHead:
		// Stat object.
		f.mu.Lock()
		s, etag := f.headObjectStatus, f.headObjectETag
		f.mu.Unlock()
		w.Header().Set("ETag", etag)
		w.Header().Set("Last-Modified", time.Now().UTC().Format(http.TimeFormat))
		w.Header().Set("Content-Length", "5")
		w.Header().Set("Content-Type", "application/zstd")
		w.WriteHeader(s)
	case r.Method == http.MethodGet && q.Has("encryption"):
		f.mu.Lock()
		s, b := f.encryptionStatus, f.encryptionBody
		f.mu.Unlock()
		w.Header().Set("Content-Type", "application/xml")
		w.WriteHeader(s)
		_, _ = w.Write([]byte(b))
	case r.Method == http.MethodGet && q.Has("location"):
		w.Header().Set("Content-Type", "application/xml")
		_, _ = w.Write([]byte(`<?xml version="1.0"?><LocationConstraint>us-east-1</LocationConstraint>`))
	case r.Method == http.MethodGet && (q.Has("prefix") || q.Has("list-type")):
		f.mu.Lock()
		body, status := f.listObjectsBody, f.listObjectsStat
		f.mu.Unlock()
		w.Header().Set("Content-Type", "application/xml")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	case r.Method == http.MethodPut && q.Has("retention"):
		f.mu.Lock()
		s := f.putStatus
		f.mu.Unlock()
		w.WriteHeader(s)
	case r.Method == http.MethodPut:
		// PUT object or PUT bucket. Both succeed.
		_, _ = io.Copy(io.Discard, r.Body)
		w.Header().Set("ETag", `"deadbeef"`)
		w.WriteHeader(200)
	case r.Method == http.MethodDelete:
		f.mu.Lock()
		s, b := f.removeStatus, f.removeBody
		f.mu.Unlock()
		w.Header().Set("Content-Type", "application/xml")
		w.WriteHeader(s)
		_, _ = w.Write([]byte(b))
	case r.Method == http.MethodGet:
		w.Header().Set("Content-Type", "application/zstd")
		w.Header().Set("ETag", `"deadbeef"`)
		w.Header().Set("Last-Modified", time.Now().UTC().Format(http.TimeFormat))
		w.Header().Set("Content-Length", "2")
		w.WriteHeader(200)
		_, _ = w.Write([]byte("ok"))
	default:
		w.WriteHeader(200)
	}
}

func newTestClient(t *testing.T, fake *fakeS3, mut func(*Config)) Client {
	t.Helper()
	cfg := Config{
		Endpoint:                      fake.endpoint(),
		AccessKey:                     "minio",
		SecretKey:                     "minio123",
		Bucket:                        "siem-cold",
		WORMSelfTestBucket:            "siem-cold-test",
		Region:                        "us-east-1",
		SkipServerSideEncryptionCheck: true,
	}
	if mut != nil {
		mut(&cfg)
	}
	log := zerolog.Nop()
	c, err := NewClient(context.Background(), cfg, &log, nil)
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	return c
}

func TestBucketHealthy_Success(t *testing.T) {
	fake := newFakeS3()
	defer fake.Close()
	c := newTestClient(t, fake, nil)
	if err := c.BucketHealthy(context.Background()); err != nil {
		t.Fatalf("BucketHealthy: %v", err)
	}
}

func TestBucketHealthy_NoSentinel(t *testing.T) {
	fake := newFakeS3()
	defer fake.Close()
	fake.mu.Lock()
	fake.listObjectsBody = `<?xml version="1.0"?><ListBucketResult></ListBucketResult>`
	fake.mu.Unlock()
	c := newTestClient(t, fake, nil)
	err := c.BucketHealthy(context.Background())
	if err == nil {
		t.Fatal("expected sentinel-missing")
	}
	if !errors.Is(err, ErrSentinelMissing) {
		t.Errorf("err = %v", err)
	}
}

func TestHealthCheckerAdapter_Check(t *testing.T) {
	fake := newFakeS3()
	defer fake.Close()
	c := newTestClient(t, fake, nil)
	hc := c.HealthChecker()
	res := hc.Check(context.Background())
	if res.Status != "healthy" {
		t.Errorf("status = %s err=%s", res.Status, res.Error)
	}
}

func TestWORMSelfTest_Success(t *testing.T) {
	fake := newFakeS3()
	defer fake.Close()
	c := newTestClient(t, fake, nil)
	if err := c.WORMSelfTest(context.Background()); err != nil {
		t.Fatalf("WORMSelfTest: %v", err)
	}
}

func TestWORMSelfTest_DeleteSucceededFails(t *testing.T) {
	fake := newFakeS3()
	defer fake.Close()
	fake.mu.Lock()
	fake.removeStatus = 204
	fake.removeBody = ""
	fake.mu.Unlock()
	c := newTestClient(t, fake, nil)
	err := c.WORMSelfTest(context.Background())
	if err == nil {
		t.Fatal("expected ErrWORMSelfTestFailed")
	}
	if !errors.Is(err, ErrWORMSelfTestFailed) {
		t.Errorf("err = %v", err)
	}
}

func TestStat_Success(t *testing.T) {
	fake := newFakeS3()
	defer fake.Close()
	c := newTestClient(t, fake, nil)
	info, err := c.Stat(context.Background(), "k")
	if err != nil {
		t.Fatal(err)
	}
	if info.Size == 0 {
		t.Error("size = 0")
	}
}

func TestGet_Success(t *testing.T) {
	fake := newFakeS3()
	defer fake.Close()
	c := newTestClient(t, fake, nil)
	rc, _, err := c.Get(context.Background(), "k")
	if err != nil {
		t.Fatal(err)
	}
	defer rc.Close()
	b, _ := io.ReadAll(rc)
	if string(b) != "ok" {
		t.Errorf("body = %q", b)
	}
}

func TestSealIndex_HappyPath(t *testing.T) {
	// SealIndex pipes through zstd and uses minio-go's chunked PUT
	// stream. A faithful unit-level stub requires streaming-AWS4 signature
	// parsing which is out of scope for the unit-test layer; the integration
	// test (TestIntegration_EncryptedRoundTrip) covers the happy path live.
	t.Skip("requires AWS chunked-signature aware S3 mock; integration_test.go covers it")
}

func TestSealIndex_RetentionTooShort(t *testing.T) {
	fake := newFakeS3()
	defer fake.Close()
	c := newTestClient(t, fake, nil)
	_, err := c.SealIndex(context.Background(), uuid.New(), "idx",
		strings.NewReader("x"),
		SealOptions{
			DataClass:      storetypes.DataClassSwift,
			RetentionYears: 5, // less than 10
			EventTime:      time.Now().UTC(),
		})
	if err == nil {
		t.Fatal("expected ErrRetentionTooShort")
	}
	if !errors.Is(err, ErrRetentionTooShort) {
		t.Errorf("err = %v", err)
	}
}
