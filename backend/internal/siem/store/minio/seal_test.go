package minio

import (
	"context"
	"errors"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/clario360/platform/internal/siem/store/storetypes"
)

func TestSealIndex_NilSource(t *testing.T) {
	fake := newFakeS3()
	defer fake.Close()
	c := newTestClient(t, fake, nil)
	_, err := c.SealIndex(context.Background(), uuid.New(), "idx", nil, SealOptions{
		DataClass: storetypes.DataClassPII,
	})
	if err == nil || !strings.Contains(err.Error(), "source nil") {
		t.Errorf("err = %v", err)
	}
}

func TestSealIndex_EmptyIndexName(t *testing.T) {
	fake := newFakeS3()
	defer fake.Close()
	c := newTestClient(t, fake, nil)
	_, err := c.SealIndex(context.Background(), uuid.New(), "", strings.NewReader("x"), SealOptions{
		DataClass: storetypes.DataClassPII,
	})
	if err == nil || !strings.Contains(err.Error(), "indexName required") {
		t.Errorf("err = %v", err)
	}
}

func TestSealIndex_ClassDefaultUsed(t *testing.T) {
	fake := newFakeS3()
	defer fake.Close()
	c := newTestClient(t, fake, nil)
	_, err := c.SealIndex(context.Background(), uuid.New(), "idx",
		strings.NewReader("x"),
		SealOptions{
			DataClass:      storetypes.DataClassSwift,
			RetentionYears: 5, // less than 10
			EventTime:      time.Time{},
		})
	if !errors.Is(err, ErrRetentionTooShort) {
		t.Errorf("err = %v", err)
	}
}

func TestSealIndex_NilSourceVariants(t *testing.T) {
	fake := newFakeS3()
	defer fake.Close()
	c := newTestClient(t, fake, nil)
	for _, tc := range []struct {
		name string
		src  func() (io.Reader, string, SealOptions)
		want string
	}{
		{
			"nil source",
			func() (io.Reader, string, SealOptions) {
				return nil, "idx", SealOptions{DataClass: storetypes.DataClassPII}
			},
			"source nil",
		},
		{
			"empty index",
			func() (io.Reader, string, SealOptions) {
				return strings.NewReader("x"), "", SealOptions{DataClass: storetypes.DataClassPII}
			},
			"indexName required",
		},
	} {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			src, idx, opts := tc.src()
			_, err := c.SealIndex(context.Background(), uuid.New(), idx, src, opts)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("err = %v want %q", err, tc.want)
			}
		})
	}
}
