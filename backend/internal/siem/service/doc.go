// Package service contains the SIEM business-logic layer.
//
// SIEM-01 ships only MetaService — the source of truth for the
// /_meta endpoint and for the readiness probe's "I am alive" signal.
// Future prompts plug source, parser, rule, alert, and hunt services
// into this same package.
//
// Every service constructor takes its dependencies explicitly; the
// package has no global state.
package service
