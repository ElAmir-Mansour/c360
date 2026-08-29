// Package service hosts the SIEM-03 Service interface that handlers
// invoke for every CRUD + lifecycle operation. The interface is the
// stable surface; the concrete implementation orchestrates the repo
// layer, PKI, enrollment-token mint/claim, event emission, and audit
// chain.
package service
