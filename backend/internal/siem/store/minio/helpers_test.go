package minio

import (
	"errors"
	"net/http"
	"testing"
	"time"

	miniogo "github.com/minio/minio-go/v7"
	"github.com/rs/zerolog"
)

func TestIsWORMError(t *testing.T) {
	cases := []struct {
		name string
		resp miniogo.ErrorResponse
		want bool
	}{
		{"empty", miniogo.ErrorResponse{}, false},
		{"worm-msg", miniogo.ErrorResponse{StatusCode: 403, Message: "object is WORM protected"}, true},
		{"retention-msg", miniogo.ErrorResponse{StatusCode: 400, Message: "retention period not met"}, true},
		{"object-lock-msg", miniogo.ErrorResponse{StatusCode: 400, Message: "Object lock active"}, true},
		{"invalidRetention", miniogo.ErrorResponse{StatusCode: 400, Code: "InvalidRetentionPeriod", Message: "x"}, true},
		{"unrelated", miniogo.ErrorResponse{StatusCode: 500, Message: "internal"}, false},
	}
	for _, c := range cases {
		c := c
		t.Run(c.name, func(t *testing.T) {
			got := isWORMError(c.resp)
			if got != c.want {
				t.Errorf("got %v want %v", got, c.want)
			}
		})
	}
}

func TestErrCheck(t *testing.T) {
	if errCheck(nil, ErrBucketMissing) {
		t.Error("nil err should not match")
	}
	if !errCheck(ErrBucketMissing, ErrBucketMissing) {
		t.Error("identical should match")
	}
}

func TestErrCheckTarget(t *testing.T) {
	if errCheckTarget(nil, ErrObjectLocked) {
		t.Error("nil should not match")
	}
	if !errCheckTarget(errors.New("minio: object locked by WORM"), ErrObjectLocked) {
		t.Error("substring match expected")
	}
}

func TestToObjectInfo(t *testing.T) {
	src := miniogo.ObjectInfo{
		Key:          "k",
		Size:         100,
		ContentType:  "application/zstd",
		ETag:         "deadbeef",
		LastModified: time.Now(),
		UserMetadata: miniogo.StringMap{"k": "v"},
	}
	got := toObjectInfo(src)
	if got.Key != "k" || got.Size != 100 || got.ContentType != "application/zstd" || got.ETag != "deadbeef" {
		t.Errorf("got %+v", got)
	}
	if got.UserMetadata["k"] != "v" {
		t.Errorf("user-metadata not copied: %+v", got.UserMetadata)
	}
}

func TestHashSink(t *testing.T) {
	h := newHashSink()
	n, err := h.Write([]byte("abc"))
	if err != nil || n != 3 {
		t.Fatalf("Write: n=%d err=%v", n, err)
	}
	if h.Sum() == "" {
		t.Error("Sum empty")
	}
}

func TestClose_NoOp(t *testing.T) {
	log := zerolog.Nop()
	c, err := NewClient(nil, Config{Endpoint: "x", Bucket: "b"}, &log, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := c.Close(); err != nil {
		t.Errorf("Close: %v", err)
	}
}

func TestHealthCheckerAdapter_Name(t *testing.T) {
	log := zerolog.Nop()
	c, err := NewClient(nil, Config{Endpoint: "x", Bucket: "b"}, &log, nil)
	if err != nil {
		t.Fatal(err)
	}
	hc := c.HealthChecker()
	if hc.Name() != "minio_object_lock" {
		t.Errorf("name = %s", hc.Name())
	}
}

func TestClassifyMinioError_NoSuchKey(t *testing.T) {
	err := classifyMinioError(miniogo.ErrorResponse{Code: "NoSuchKey", StatusCode: http.StatusNotFound})
	if err == nil || !errors.Is(err, ErrObjectNotFound) {
		t.Errorf("got %v want ErrObjectNotFound", err)
	}
}

func TestClassifyMinioError_WORMDetected(t *testing.T) {
	err := classifyMinioError(miniogo.ErrorResponse{Code: "AccessDenied", StatusCode: 403, Message: "WORM protected"})
	if err == nil {
		t.Fatal("expected wrapped error")
	}
	if !errors.Is(err, ErrObjectLocked) {
		t.Errorf("got %v want ErrObjectLocked", err)
	}
}
