package server

import (
	"bytes"
	"encoding/json"
	"github.com/Rexus/SkyView/internal/views"
	"net/http"
	"net/http/httptest"
	"os"
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
