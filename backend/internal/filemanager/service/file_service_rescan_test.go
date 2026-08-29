package service

import (
	"testing"

	"github.com/clario360/platform/internal/filemanager/model"
)

func TestCanRescanFile(t *testing.T) {
	record := &model.FileRecord{UploadedBy: "uploader-1"}

	if !canRescanFile(record, "uploader-1", false) {
		t.Fatal("uploader should be able to retry their own scan")
	}
	if canRescanFile(record, "another-user", false) {
		t.Fatal("unrelated user should not be able to retry another uploader's scan")
	}
	if !canRescanFile(record, "admin-user", true) {
		t.Fatal("file administrator should be able to retry any tenant file")
	}
	if canRescanFile(nil, "admin-user", true) {
		t.Fatal("nil record must never be authorized")
	}
}
