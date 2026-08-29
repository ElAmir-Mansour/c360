package mtls

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"
)

func TestListener_MissingCAPath(t *testing.T) {
	l := New(ListenerConfig{Addr: "127.0.0.1:0"}, http.NewServeMux(), zerolog.Nop())
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	err := l.Start(ctx)
	require.Error(t, err)
}

func TestListener_BadCAPath(t *testing.T) {
	tmp := filepath.Join(t.TempDir(), "missing.pem")
	l := New(ListenerConfig{Addr: "127.0.0.1:0", CABundlePath: tmp}, http.NewServeMux(), zerolog.Nop())
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	err := l.Start(ctx)
	require.Error(t, err)
}

func TestListener_EmptyCAPEM(t *testing.T) {
	path := filepath.Join(t.TempDir(), "empty.pem")
	require.NoError(t, os.WriteFile(path, []byte(""), 0o644))
	l := New(ListenerConfig{Addr: "127.0.0.1:0", CABundlePath: path}, http.NewServeMux(), zerolog.Nop())
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	err := l.Start(ctx)
	require.Error(t, err)
}
