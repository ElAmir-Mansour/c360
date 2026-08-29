package crypto

// Metrics for this package are owned per-instance by the constructors:
//
//   - NewDEKManager registers DEK cache + generation counters.
//   - NewFieldCrypto registers PII encrypt/decrypt counters.
//
// There is no shared package-level registrar; this file exists to document
// that intent and to keep file-naming symmetric with the parent store
// package.
