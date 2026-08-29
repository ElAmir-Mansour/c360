package mtls

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/siem/sources"
)

func TestMiddleware_Invalidate(t *testing.T) {
	m := NewMiddleware(&stubLookup{by: map[string]*sources.Source{}}, nil, time.Minute)
	m.cache.put("a", &sources.Source{Name: "x"})
	require.NotNil(t, m.cache.get("a"))
	m.Invalidate("a")
	require.Nil(t, m.cache.get("a"))
}

func TestListener_Defaults(t *testing.T) {
	l := New(ListenerConfig{}, http.NewServeMux(), zerolog.Nop())
	require.NotNil(t, l)
}

func TestListener_StartCancels(t *testing.T) {
	// Generate a valid CA bundle for the listener to load.
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	tpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "CA"},
		NotBefore:    time.Now().Add(-time.Minute),
		NotAfter:     time.Now().Add(time.Hour),
		IsCA:         true,
		KeyUsage:     x509.KeyUsageCertSign,
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &priv.PublicKey, priv)
	require.NoError(t, err)
	caPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})

	path := filepath.Join(t.TempDir(), "ca.pem")
	require.NoError(t, os.WriteFile(path, caPEM, 0o644))

	l := New(ListenerConfig{Addr: "127.0.0.1:0", CABundlePath: path}, http.NewServeMux(), zerolog.Nop())
	ctx, cancel := context.WithTimeout(context.Background(), 80*time.Millisecond)
	defer cancel()
	err = l.Start(ctx)
	// No server cert/key configured, so Start fails fast in buildTLSConfig.
	require.Error(t, err)
}

func TestListener_StartWithServerCert(t *testing.T) {
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	tpl := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: "localhost"},
		NotBefore:    time.Now().Add(-time.Minute),
		NotAfter:     time.Now().Add(time.Hour),
		IsCA:         true,
		KeyUsage:     x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &priv.PublicKey, priv)
	require.NoError(t, err)
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	keyDER, err := x509.MarshalECPrivateKey(priv)
	require.NoError(t, err)
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})

	dir := t.TempDir()
	caPath := filepath.Join(dir, "ca.pem")
	certPath := filepath.Join(dir, "server.pem")
	keyPath := filepath.Join(dir, "server-key.pem")
	require.NoError(t, os.WriteFile(caPath, certPEM, 0o644))
	require.NoError(t, os.WriteFile(certPath, certPEM, 0o644))
	require.NoError(t, os.WriteFile(keyPath, keyPEM, 0o600))

	l := New(ListenerConfig{
		Addr:           "127.0.0.1:0",
		CABundlePath:   caPath,
		ServerCertPath: certPath,
		ServerKeyPath:  keyPath,
	}, http.NewServeMux(), zerolog.Nop())
	ctx, cancel := context.WithTimeout(context.Background(), 150*time.Millisecond)
	defer cancel()
	// With a full keypair the listener binds and runs until ctx cancels.
	require.NoError(t, l.Start(ctx))
}
