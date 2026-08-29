// Package detector hosts the 1-minute background loop that drives
// EWMA baseline maintenance, silent-source detection, recovery,
// cert-expiry warnings, EPS sample retention pruning, and deferred
// revocation cleanup. The whole loop is gated by a leadership.Elector
// so a multi-replica siem-service deployment runs the loop exactly
// once.
package detector
