package store_test

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

	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/siem/store"
	storeminio "github.com/clario360/platform/internal/siem/store/minio"
	storeos "github.com/clario360/platform/internal/siem/store/opensearch"
)

// fakeS3SelfTest emulates the subset of S3 operations exercised by
// store.SelfTest -> minio.BucketHealthy + minio.WORMSelfTest.
type fakeS3SelfTest struct {
	srv *httptest.Server
	mu  sync.Mutex
}

func newFakeS3SelfTest() *fakeS3SelfTest {
	f := &fakeS3SelfTest{}
	f.srv = httptest.NewServer(http.HandlerFunc(f.handle))
	return f
}

func (f *fakeS3SelfTest) Close() { f.srv.Close() }
func (f *fakeS3SelfTest) endpoint() string {
	u, _ := url.Parse(f.srv.URL)
	return u.Host
}

func (f *fakeS3SelfTest) handle(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	switch {
	case r.Method == http.MethodHead:
		w.WriteHeader(200)
	case r.Method == http.MethodGet && q.Has("encryption"):
		w.Header().Set("Content-Type", "application/xml")
		_, _ = w.Write([]byte(`<?xml version="1.0"?><ServerSideEncryptionConfiguration><Rule><ApplyServerSideEncryptionByDefault><SSEAlgorithm>AES256</SSEAlgorithm></ApplyServerSideEncryptionByDefault></Rule></ServerSideEncryptionConfiguration>`))
	case r.Method == http.MethodGet && q.Has("location"):
		w.Header().Set("Content-Type", "application/xml")
		_, _ = w.Write([]byte(`<?xml version="1.0"?><LocationConstraint>us-east-1</LocationConstraint>`))
	case r.Method == http.MethodGet && (q.Has("prefix") || q.Has("list-type")):
		w.Header().Set("Content-Type", "application/xml")
		_, _ = w.Write([]byte(`<?xml version="1.0"?><ListBucketResult><Contents><Key>__siem_self_test/sentinel</Key><Size>1</Size></Contents></ListBucketResult>`))
	case r.Method == http.MethodPut:
		_, _ = io.Copy(io.Discard, r.Body)
		w.Header().Set("ETag", `"abc"`)
		w.WriteHeader(200)
	case r.Method == http.MethodDelete:
		w.Header().Set("Content-Type", "application/xml")
		w.WriteHeader(403)
		_, _ = w.Write([]byte(`<?xml version="1.0"?><Error><Code>AccessDenied</Code><Message>object is WORM protected</Message></Error>`))
	default:
		w.WriteHeader(200)
	}
}

// fakeOpenSearch responds to /_cluster/health.
func fakeOpenSearch(t *testing.T, color string) (string, func()) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/_cluster/health") {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"status":"` + color + `","number_of_nodes":1}`))
			return
		}
		w.WriteHeader(200)
	}))
	return srv.URL, srv.Close
}

func TestSelfTest_Success(t *testing.T) {
	osURL, cleanupOS := fakeOpenSearch(t, "green")
	defer cleanupOS()
	fake := newFakeS3SelfTest()
	defer fake.Close()

	log := zerolog.Nop()
	vc := &stubVaultClient{}
	s, err := store.New(context.Background(), store.Dependencies{
		Logger: &log, Vault: vc,
	}, store.WithConfig(store.Config{
		OpenSearch: storeos.Config{Addresses: []string{osURL}},
		MinIO: storeminio.Config{
			Endpoint:                      fake.endpoint(),
			Bucket:                        "siem-cold",
			WORMSelfTestBucket:            "siem-cold-test",
			SkipServerSideEncryptionCheck: true,
		},
		SelfTestTimeout: 5 * time.Second,
	}))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()

	res, err := s.SelfTest(context.Background())
	if err != nil {
		t.Fatalf("SelfTest: %v", err)
	}
	if res.OpenSearch != "ok" || res.MinIO != "ok" || res.Vault != "ok" || res.ObjectLock != "enforced" {
		t.Errorf("unexpected result: %+v", res)
	}
}

func TestSelfTest_OpenSearchRed(t *testing.T) {
	osURL, cleanupOS := fakeOpenSearch(t, "red")
	defer cleanupOS()
	fake := newFakeS3SelfTest()
	defer fake.Close()

	log := zerolog.Nop()
	vc := &stubVaultClient{}
	s, err := store.New(context.Background(), store.Dependencies{
		Logger: &log, Vault: vc,
	}, store.WithConfig(store.Config{
		OpenSearch: storeos.Config{Addresses: []string{osURL}},
		MinIO: storeminio.Config{
			Endpoint:                      fake.endpoint(),
			Bucket:                        "siem-cold",
			WORMSelfTestBucket:            "siem-cold-test",
			SkipServerSideEncryptionCheck: true,
		},
	}))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	_, err = s.SelfTest(context.Background())
	if err == nil {
		t.Fatal("expected error")
	}
	if !errors.Is(err, store.ErrSelfTestFailed) {
		t.Errorf("err = %v", err)
	}
}

func TestSelfTest_VaultHealthFails(t *testing.T) {
	osURL, cleanupOS := fakeOpenSearch(t, "green")
	defer cleanupOS()
	fake := newFakeS3SelfTest()
	defer fake.Close()

	log := zerolog.Nop()
	vc := &stubVaultClient{healthErr: errors.New("sealed")}
	s, err := store.New(context.Background(), store.Dependencies{
		Logger: &log, Vault: vc,
	}, store.WithConfig(store.Config{
		OpenSearch: storeos.Config{Addresses: []string{osURL}},
		MinIO: storeminio.Config{
			Endpoint:                      fake.endpoint(),
			Bucket:                        "siem-cold",
			WORMSelfTestBucket:            "siem-cold-test",
			SkipServerSideEncryptionCheck: true,
		},
	}))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	_, err = s.SelfTest(context.Background())
	if err == nil {
		t.Fatal("expected error")
	}
	if !errors.Is(err, store.ErrSelfTestFailed) {
		t.Errorf("err = %v", err)
	}
}
