// Package enroll provides the ClarioDR agent enrollment boundary.
//
// Main wiring:
//   - build the existing siem/sources/enroll.TokenManager and pass it as both
//     TokenMinter and TokenParser;
//   - build the existing siem/sources/enroll.Service and pass it as
//     ExchangeDelegate;
//   - use SourceAdapter as that SIEM service's SourcesReader so SIEM token/CSR
//     exchange persists certificate metadata against dr_agent rows;
//   - mount NewHandler(...).Routes() under the DR API, with MintToken behind
//     auth/tenant/RBAC and Exchange available to token-bearing agents.
package enroll
