// Package mtls hosts the mTLS verification middleware and the
// dedicated TLS listener used by the heartbeat endpoint on
// :8095. Identity = SHA-256 thumbprint of the leaf DER, looked up
// against the sources registry; revocation = local denylist
// (CRLCache) which is kept current by pki.CRLCache.
package mtls
