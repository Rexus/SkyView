package server

import (
	"bytes"
	"encoding/json"
	"github.com/Rexus/SkyView/internal/standards"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestNativeDraftSnapshotPreservesProjectAndIsolation(t *testing.T) {
	root := t.TempDir()
	s := New(root)
	s.native = standards.NewRunner(t.TempDir(), "java")
	s.writeFile("Draft.sysml", "package Saved;")
	nested := filepath.Join(root, "projects", "unrelated")
	os.MkdirAll(nested, 0755)
	os.WriteFile(filepath.Join(nested, "Sibling.sysml"), []byte("package Sibling;"), 0644)
	draft := "package Unsaved;"
	files, err := s.nativeSnapshot("Draft.sysml", &draft)
	if err != nil || files["Draft.sysml"] != draft {
		t.Fatalf("snapshot: %v %v", files, err)
	}
	for name := range files {
		if name == "projects/unrelated/Sibling.sysml" {
			t.Fatal("legacy root included another project")
		}
	}
	got, _ := s.readFile("Draft.sysml")
	if got != "package Saved;" {
		t.Fatal("draft was saved")
	}
	body, _ := json.Marshal(map[string]string{"content": draft})
	rr := httptest.NewRecorder()
	s.Handler().ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/api/files/Draft.sysml/validate-native", bytes.NewReader(body)))
	var result standards.Result
	if err = json.Unmarshal(rr.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if rr.Code != 200 || result.Status != "unavailable" || result.Error == "" || result.SourceSHA256 != standards.SnapshotHash(files) {
		t.Fatalf("misleading missing-tool result: %s", rr.Body.String())
	}
}

func TestStandardsFooterIdentityReportsUnavailableTruthfully(t *testing.T) {
	s := New(t.TempDir())
	s.native = standards.NewRunner(t.TempDir(), "java")
	rr := httptest.NewRecorder()
	s.Handler().ServeHTTP(rr, httptest.NewRequest(http.MethodGet, "/api/standards", nil))
	var info standards.Identity
	if err := json.Unmarshal(rr.Body.Bytes(), &info); err != nil {
		t.Fatal(err)
	}
	if rr.Code != 200 || info.State != "unavailable" || info.Error == "" || info.Release.Version != standards.Pinned().Version || info.LockSHA256 == "" || info.AdapterSHA256 == "" {
		t.Fatalf("misleading identity: %s", rr.Body.String())
	}
	if rr.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("live version result can become stale in cache")
	}
}
