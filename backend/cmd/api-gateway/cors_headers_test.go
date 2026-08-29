package main

import "testing"

func TestGatewayCORSAllowedHeadersIncludesDeviceID(t *testing.T) {
	for _, h := range gatewayCORSAllowedHeaders {
		if h == "X-Device-Id" {
			return
		}
	}
	t.Fatal("gateway CORS allowed headers must include X-Device-Id for device-trust login requests")
}
