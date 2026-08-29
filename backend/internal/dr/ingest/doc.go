// Package ingest provides the ClarioDR mTLS frame-ingest boundary.
//
// Main wiring:
//   - build NewHandler with a dr_agent thumbprint lookup, pki.CRLCache,
//     DEKProvider, ApplierFactory, and CheckpointerFactory;
//   - mount Handler.Routes() on NewListener, the reused SIEM mTLS listener;
//   - bind CheckpointerFactory to core.NewDBCheckpointer through the existing
//     DR repository checkpoint store so successful applies update the stream
//     RPO ledger;
//   - use Authorizer to ensure the authenticated agent may ship the requested
//     replication_stream before any frame bytes are read.
package ingest
