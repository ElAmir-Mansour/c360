package minio

import (
	"context"
	"net/http"
	"testing"

	miniogo "github.com/minio/minio-go/v7"
	"github.com/rs/zerolog"
)

func TestNewClient_Validates(t *testing.T) {
	log := zerolog.Nop()
	if _, err := NewClient(context.Background(), Config{}, &log, nil); err == nil {
		t.Error("expected endpoint required")
	}
	if _, err := NewClient(context.Background(), Config{Endpoint: "x"}, &log, nil); err == nil {
		t.Error("expected bucket required")
	}
	// Same bucket as worm test bucket -> reject.
	if _, err := NewClient(context.Background(), Config{
		Endpoint:           "x",
		Bucket:             "siem-cold",
		WORMSelfTestBucket: "siem-cold",
	}, &log, nil); err == nil {
		t.Error("expected error when bucket == WORMSelfTestBucket")
	}
}

func TestNewClient_AppliesDefaults(t *testing.T) {
	log := zerolog.Nop()
	c, err := NewClient(context.Background(), Config{
		Endpoint: "localhost:9010",
		Bucket:   "siem-cold",
	}, &log, nil)
	if err != nil {
		t.Fatal(err)
	}
	cc := c.(*client)
	if cc.cfg.Region != "us-east-1" {
		t.Errorf("region = %q", cc.cfg.Region)
	}
	if cc.cfg.ZstdLevel != 19 {
		t.Errorf("zstd = %d", cc.cfg.ZstdLevel)
	}
	if cc.cfg.WORMSelfTestBucket != "siem-cold-test" {
		t.Errorf("WORM bucket = %q", cc.cfg.WORMSelfTestBucket)
	}
}

func TestClassifyMinioError_NoSuchBucket(t *testing.T) {
	resp := miniogo.ErrorResponse{Code: "NoSuchBucket", Message: "no bucket", StatusCode: http.StatusNotFound}
	err := classifyMinioError(resp)
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestClassifyMinioError_Nil(t *testing.T) {
	if err := classifyMinioError(nil); err != nil {
		t.Errorf("got %v", err)
	}
}
