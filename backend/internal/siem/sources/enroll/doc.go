// Package enroll mints and atomically claims enrollment tokens, and
// drives the CSR-based cert-issuance handshake used by the
// /api/v1/siem/sources/{id}/enroll and /rotate-cert/exchange routes.
//
// Tokens are JWTs whose signing key lives in Vault transit
// (siem-enrollment-jwt). The claim step is a single Redis Lua script
// so racing requests cannot both consume the same JTI — see
// PROMPT3.MD §4.5 and §13 for why this is the highest-value
// guarantee in SIEM-03.
package enroll
