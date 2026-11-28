package server

import (
	"bytes"
	"encoding/json"
	"github.com/Rexus/SkyView/internal/views"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestSharedPreviewPublicationAndConflicts(t *testing.T) {
	s := New(t.TempDir())
	source := "package S {part <'A'> a;}"
	if err := s.writeFile("Model.sysml", source); err != nil {
		t.Fatal(err)
	}
	config := views.Config{Version: 2, Views: []views.View{{ID: "design", Title: "Design", Owner: ".", Subject: "A", Presentation: true, Width: 400, Height: 300,
		Nodes: []views.Node{{Element: "A", Parent: "frame", X: 60, Y: 90, Width: 200, Height: 80}}, Boundaries: []views.Boundary{{ID: "frame", Label: "Zone", X: 20, Y: 20, Width: 300, Height: 230, Layout: &views.Arrangement{Pattern: "vertical", Locked: true}}}}}}
	handler := s.Handler()
	request := func(method, url string, body []byte, viewRevision string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, url, bytes.NewReader(body))
		r.Header.Set("If-Match", revisionOf(source))
		if viewRevision != "" {
			r.Header.Set("If-View-Match", viewRevision)
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w
	}
	raw, _ := json.Marshal(config)
	preview := request("POST", "/api/files/Model.sysml/views/preview?view=design", raw, "")
	if preview.Code != 200 {
		t.Fatal(preview.Body.String())
	}
	path, _ := s.viewsPath("Model.sysml")
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("preview saved the view")
	}
	saved := request("PUT", "/api/files/Model.sysml/views", raw, "")
	if saved.Code != 200 || saved.Header().Get("ETag") == "" {
		t.Fatal(saved.Body.String())
	}
	rendered := request("GET", "/api/files/Model.sysml/views/design", nil, "")
	if rendered.Code != 200 || !bytes.Equal(preview.Body.Bytes(), rendered.Body.Bytes()) {
		t.Fatal("saved and preview rendering differ")
	}
	downloaded := request("GET", "/api/files/Model.sysml/views", nil, "")
	if !bytes.Equal(downloaded.Body.Bytes(), raw) || downloaded.Header().Get("ETag") != saved.Header().Get("ETag") {
		t.Fatal("view round trip changed")
	}
	config.Views[0].Boundaries[0].Label = "Changed zone"
	changed, _ := json.Marshal(config)
	updated := request("PUT", "/api/files/Model.sysml/views", changed, saved.Header().Get("ETag"))
	if updated.Code != 200 {
		t.Fatal(updated.Body.String())
	}
	stale := request("PUT", "/api/files/Model.sysml/views", raw, saved.Header().Get("ETag"))
	if stale.Code != http.StatusConflict {
		t.Fatal("stale view overwrite accepted")
	}
	config.Views[0].Nodes[0].Parent = "missing"
	bad, _ := json.Marshal(config)
	rejected := request("PUT", "/api/files/Model.sysml/views", bad, updated.Header().Get("ETag"))
	if rejected.Code != 422 {
		t.Fatal("invalid layout published")
	}
	content, _ := os.ReadFile(path)
	if !bytes.Equal(content, changed) {
		t.Fatal("failed publish altered stored layout")
	}
	got, _ := s.readFile("Model.sysml")
	if got != source {
		t.Fatal("presentation editing changed native source")
	}
}

func TestViewDraftRecoveryAndPublication(t *testing.T) {
	workspace := t.TempDir()
	s := New(workspace)
	name, source := "Model.sysml", "package S { part <'A'> a; }"
	if err := s.writeFile(name, source); err != nil {
		t.Fatal(err)
	}
	handler := s.Handler()
	request := func(method, suffix string, body []byte, base, draft string, want int) *httptest.ResponseRecorder {
		t.Helper()
		r := httptest.NewRequest(method, "/api/projects/workspace/files/"+name+suffix, bytes.NewReader(body))
		r.Header.Set("If-Match", revisionOf(source))
		r.Header.Set("If-View-Match", base)
		r.Header.Set("If-Draft-Match", draft)
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		if w.Code != want {
			t.Fatalf("%s %s: got %d, want %d: %s", method, suffix, w.Code, want, w.Body)
		}
		return w
	}
	layout := func(x float64) []byte {
		raw, err := json.Marshal(views.Config{Version: 2, Views: []views.View{{
			ID: "design", Title: "Design", Owner: ".", Subject: "A", Width: 400, Height: 300,
			Nodes: []views.Node{{Element: "A", X: x, Y: 70, Width: 120, Height: 65}},
		}}})
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	saved, moved := layout(30), layout(80)
	original := request("PUT", "/views", saved, "", "", 200).Header().Get("ETag")
	draft := request("PUT", "/view-draft", moved, original, "", 204).Header().Get("ETag")
	if draft == "" {
		t.Fatal("missing draft revision")
	}
	if _, err := os.Stat(filepath.Join(workspace, ".skyview", "view-drafts", "Model.json")); err != nil {
		t.Fatal(err)
	}
	if got := request("GET", "/views", nil, "", "", 200).Body.Bytes(); !bytes.Equal(got, saved) {
		t.Fatal("autosave changed the published view")
	}
	handler = New(workspace).Handler()
	reloaded := request("GET", "/view-draft", nil, "", "", 200)
	var recovered viewDraft
	if err := json.Unmarshal(reloaded.Body.Bytes(), &recovered); err != nil ||
		recovered.Base != original || !bytes.Equal(recovered.Config, moved) || reloaded.Header().Get("ETag") != draft {
		t.Fatal("could not recover the separate draft", err)
	}
	request("PUT", "/view-draft", layout(99), original, "", 409)
	request("DELETE", "/view-draft", nil, original, "stale", 409)
	request("DELETE", "/view-draft", nil, original, draft, 204)
	request("GET", "/view-draft", nil, "", "", 404)
	request("PUT", "/view-draft", moved, original, "", 204)
	published := request("PUT", "/views", moved, original, "", 200)
	request("GET", "/view-draft", nil, "", "", 404)
	request("PUT", "/view-draft", saved, original, "", 409)
	if !bytes.Equal(request("GET", "/views", nil, "", "", 200).Body.Bytes(), moved) || published.Header().Get("ETag") == original {
		t.Fatal("explicit save failed to publish the draft")
	}
}
