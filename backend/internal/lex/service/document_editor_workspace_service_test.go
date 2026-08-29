package service

import "testing"

func TestEditorProviderEventTypeClassifiesProviderCallbacks(t *testing.T) {
	tests := []struct {
		name    string
		payload map[string]any
		want    string
	}{
		{name: "saved status", payload: map[string]any{"status": 2}, want: "saved"},
		{name: "force saved status", payload: map[string]any{"status": "force_saved"}, want: "force_saved"},
		{name: "provider error", payload: map[string]any{"status": 7}, want: "provider_error"},
		{name: "explicit type wins", payload: map[string]any{"event_type": "comment_created", "status": 2}, want: "comment_created"},
		{name: "coauthor action", payload: map[string]any{"actions": []any{map[string]any{"type": "disconnect"}}}, want: "coauthor_left"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := editorProviderEventType(tt.payload); got != tt.want {
				t.Fatalf("editorProviderEventType() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestPrivilegedControlMapsFromDetailNormalizesPayloadShapes(t *testing.T) {
	direct := privilegedControlMapsFromDetail(map[string]any{
		"externalSharingAllowed": true,
		"download_allowed":       false,
		"reason":                 "privileged draft",
	})
	if len(direct) != 2 {
		t.Fatalf("direct control maps length = %d, want 2", len(direct))
	}
	found := map[string]bool{}
	for _, item := range direct {
		found[item["control_key"].(string)] = item["enabled"].(bool)
	}
	if !found["external_sharing"] {
		t.Fatalf("expected external_sharing control to be enabled: %#v", found)
	}
	if found["download"] {
		t.Fatalf("expected download control to be disabled: %#v", found)
	}

	list := privilegedControlMapsFromDetail(map[string]any{
		"controls": []any{
			map[string]any{"key": "watermark-required", "enabled": true},
		},
	})
	if len(list) != 1 {
		t.Fatalf("list control maps length = %d, want 1", len(list))
	}
	if got := normalizeEditorControlKey(stringFromKeys(list[0], "key")); got != "watermark" {
		t.Fatalf("normalized key = %q, want watermark", got)
	}
}
