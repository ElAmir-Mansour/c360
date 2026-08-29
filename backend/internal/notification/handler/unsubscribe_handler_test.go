package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWriteUnsubscribeResultUsesClarioPaletteAndEscapesMessage(t *testing.T) {
	recorder := httptest.NewRecorder()
	writeUnsubscribeResult(recorder, http.StatusOK, `<script>alert("xss")</script>`)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	body := recorder.Body.String()
	for _, want := range []string{"#06352F", "#FDFFF6", "#6C7874", "#D1D8D5"} {
		if !strings.Contains(body, want) {
			t.Errorf("unsubscribe result is missing Clario palette color %s", want)
		}
	}
	if strings.Contains(body, "<script>") {
		t.Error("unsubscribe message was not HTML-escaped")
	}
	if strings.Contains(body, "#1B5E20") {
		t.Error("unsubscribe result contains the legacy brand color")
	}
}
