// Package repo contains the SQL data-access layer for the four
// siem.sources tables: sources, source_credentials, source_eps_samples,
// source_cert_revocations, and enrollment_tokens.
//
// Tenant isolation is enforced at every read and write — every query
// has an explicit WHERE tenant_id = $1 clause or operates on a primary
// key whose ownership has been pre-validated by the service layer.
package repo
