// Package repository contains the SIEM data-access layer.
//
// The health-check repository proves read+write tenancy isolation
// end-to-end without depending on domain tables.
//
// All public types accept a *pgxpool.Pool injected at construction;
// nothing in this package touches a global DB handle.
package repository
