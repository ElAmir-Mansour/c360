package enroll

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/clario360/platform/internal/siem/sources/pki"
)

// makeCSR returns a valid CSR PEM signed by a fresh ecdsa key.
func makeCSR(t *testing.T) string {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	require.NoError(t, err)
	tpl := &x509.CertificateRequest{Subject: pkix.Name{CommonName: "test"}}
	der, err := x509.CreateCertificateRequest(rand.Reader, tpl, priv)
	require.NoError(t, err)
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: der}))
}

// generateLeaf returns a deterministic self-signed leaf cert suitable
// for thumbprint computation.
func generateLeaf(cn string, ttl time.Duration) (pki.LeafCert, error) {
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return pki.LeafCert{}, err
	}
	tpl := &x509.Certificate{
		SerialNumber: big.NewInt(time.Now().UnixNano()),
		Subject:      pkix.Name{CommonName: cn},
		NotBefore:    time.Now().UTC(),
		NotAfter:     time.Now().UTC().Add(ttl),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &priv.PublicKey, priv)
	if err != nil {
		return pki.LeafCert{}, err
	}
	leafPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	return pki.LeafCert{
		CertPEM:    string(leafPEM),
		CAChainPEM: "fake-chain\n",
		Serial:     tpl.SerialNumber.String(),
		NotBefore:  tpl.NotBefore,
		NotAfter:   tpl.NotAfter,
	}, nil
}
