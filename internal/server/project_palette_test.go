package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Rexus/SkyView/internal/projects"
	"github.com/Rexus/SkyView/internal/views"
)

func TestProjectColoursReachAutomaticSavedAndOfflineRenderers(t *testing.T) {
	s := New(t.TempDir())
	const source = "package S { part <'A'> a; }"
	const prefix = "/api/projects/workspace"
	const model = prefix + "/files/Model.sysml"
	const chosen = "#d4e9f7"
	if err := s.writeFile("Model.sysml", source); err != nil {
		t.Fatal(err)
	}
	h := s.Handler()
	request := func(method, path string, body []byte, revision string, expected int) []byte {
		t.Helper()
		r := httptest.NewRequest(method, path, bytes.NewReader(body))
		r.Header.Set("If-Match", revision)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != expected {
			t.Fatalf("%s %s: %d, want %d: %s", method, path, w.Code, expected, w.Body)
		}
		return w.Body.Bytes()
	}
	paletteRaw := []byte(`{"version":1,"colours":{"part":"#d4e9f7"}}`)
	request("PUT", prefix+"/palette", []byte(`{"version":1,"colours":{"part":"red"}}`), "default", 400)
	request("PUT", prefix+"/palette", paletteRaw, "default", 200)
	request("PUT", prefix+"/palette", paletteRaw, "default", 409)
	automatic := request("GET", model+"/diagram/nodes", nil, revisionOf(source), 200)
	if !bytes.Contains(automatic, []byte(chosen)) {
		t.Fatal("automatic model ignored project palette")
	}
	config := views.Config{Version: 2, Views: []views.View{{ID: "design", Title: "Design", Owner: ".", Subject: "A", Presentation: true, Width: 400, Height: 250,
		Nodes: []views.Node{{Element: "A", Detail: true, X: 40, Y: 60, Width: 200, Height: 110}}}}}
	raw, err := json.Marshal(config)
	if err != nil {
		t.Fatal(err)
	}
	request("PUT", model+"/views", raw, revisionOf(source), 200)
	saved := request("GET", model+"/views/design", nil, "", 200)
	var scene views.Scene
	if err := json.Unmarshal(request("POST", model+"/views/preview?format=scene&view=design", raw, revisionOf(source), 200), &scene); err != nil {
		t.Fatal(err)
	}
	palette, err := views.ParsePalette(paletteRaw)
	if err != nil {
		t.Fatal(err)
	}
	view := config.Views[0]
	view.Palette = palette
	offline, err := views.Render(source, view)
	if err != nil || !bytes.Equal(offline, saved) || scene.SVG != string(saved) || !bytes.Contains(saved, []byte(chosen)) || len(scene.Nodes) != 1 || !bytes.Contains([]byte(scene.Nodes[0].SVG), []byte(chosen)) {
		t.Fatalf("automatic/saved/export settings diverged: %v", err)
	}
	archive := projectCall(t, h, "GET", prefix+"/export", nil, 200).Body.Bytes()
	files, err := projects.Unpack(archive, ".")
	if err != nil || !bytes.Contains(files[views.PaletteName], []byte(chosen)) || string(files["Model.sysml"]) != source || !bytes.Equal(files["Model.views.json"], raw) {
		t.Fatalf("palette or project bytes not portable: %v", err)
	}
}

func TestProjectPaletteIsolatedFromSiblingProjects(t *testing.T) {
	s := New(t.TempDir())
	h := s.Handler()
	create := func(name string) string {
		var p projects.Info
		res := projectCall(t, h, "POST", "/api/projects", map[string]string{"name": name}, 201)
		if err := json.Unmarshal(res.Body.Bytes(), &p); err != nil {
			t.Fatal(err)
		}
		return "/api/projects/" + p.ID + "/palette"
	}
	a, b := create("A"), create("B")
	payload := []byte(`{"version":1,"colours":{"part":"#d4e9f7"}}`)
	r := httptest.NewRequest(http.MethodPut, a, bytes.NewReader(payload))
	r.Header.Set("If-Match", "default")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	if bytes.Contains(projectCall(t, h, "GET", b, nil, 200).Body.Bytes(), []byte("#d4e9f7")) {
		t.Fatal("palette leaked to sibling project")
	}
}
