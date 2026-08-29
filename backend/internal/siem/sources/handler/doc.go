// Package handler hosts the SIEM-03 HTTP handlers: the 11 CRUD +
// lifecycle routes on the user-JWT plane, the two enrollment routes
// authenticated by an enrollment-token JWT, and the mTLS-only
// heartbeat route on the dedicated :8095 listener.
package handler
