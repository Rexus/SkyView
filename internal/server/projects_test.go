package server

import (
	"bytes"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Rexus/SkyView/examples"
	"github.com/Rexus/SkyView/internal/projects"
)

func projectCall(t *testing.T, h http.Handler, method, path string, body any, status int) *httptest.ResponseRecorder {
	t.Helper()
	var input io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		input = bytes.NewReader(data)
	}
	r := httptest.NewRequest(method, path, input)
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != status {
		t.Fatalf("%s %s: %d, want %d: %s", method, path, w.Code, status, w.Body)
	}
	return w
}
func projectUpload(t *testing.T, h http.Handler, data []byte, name string, status int) projects.Info {
	t.Helper()
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	file, err := form.CreateFormFile("file", "project.zip")
	if err != nil {
		t.Fatal(err)
	}
	file.Write(data)
	form.WriteField("name", name)
	form.WriteField("directory", ".")
	form.Close()
	r := httptest.NewRequest("POST", "/api/projects/upload", &body)
	r.Header.Set("Content-Type", form.FormDataContentType())
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != status {
		t.Fatalf("upload: %d, want %d: %s", w.Code, status, w.Body)
	}
	var info projects.Info
	if status == 201 {
		if err := json.Unmarshal(w.Body.Bytes(), &info); err != nil {
			t.Fatal(err)
		}
	}
	return info
}

// PW-01/PW-02: exercise real routes, encoded nested paths, persistence and project isolation.
func TestProjectLifecycle(t *testing.T) {
	root := t.TempDir()
	s := New(root)
	h := s.Handler()
	const model = "models/Plant.sysml"
	const source = "// keep CRLF\r\npackage Plant { part cart; }\r\n"
	const changed = "package Plant { part cart; part controller; }"
	original := map[string][]byte{projects.ManifestName: []byte(`{"version":1,"name":"Plant","origin":{"kind":"upload"}}`), model: []byte(source), "models/Plant.views.json": []byte(`{"version":1,"views":[]}`), "assets/raw.bin": {0, 128, 255}}
	data, err := projects.Pack(original)
	if err != nil {
		t.Fatal(err)
	}
	a := projectUpload(t, h, data, "Plant A", 201)
	b := projectUpload(t, h, data, "Plant B", 201)
	baseA := "/api/projects/" + a.ID + "/files/" + url.PathEscape(model)
	baseB := "/api/projects/" + b.ID + "/files/" + url.PathEscape(model)
	list := projectCall(t, h, "GET", "/api/projects/"+a.ID+"/files", nil, 200)
	if !strings.Contains(list.Body.String(), model) {
		t.Fatal("nested model not listed")
	}
	projectCall(t, h, "PUT", baseA, map[string]string{"content": changed}, 200)
	layout := map[string]any{"nodes": map[string]any{"cart": map[string]int{"x": 12, "y": 34}}}
	projectCall(t, h, "PUT", baseA+"/layout", layout, 200)
	history := projectCall(t, h, "GET", baseA+"/history", nil, 200)
	if !strings.Contains(history.Body.String(), ".sysml") {
		t.Fatal("history not saved")
	}
	got := projectCall(t, h, "GET", baseB+"/download", nil, 200).Body.String()
	if got != source {
		t.Fatal("editing A changed B")
	}
	if projectCall(t, h, "GET", baseB+"/layout", nil, 200).Body.String() != "{}" {
		t.Fatal("layout leaked")
	}
	projectCall(t, h, "GET", baseA+"/views", nil, 200)
	exported := projectCall(t, h, "GET", "/api/projects/"+a.ID+"/export", nil, 200).Body.Bytes()
	c := projectUpload(t, h, exported, "", 201)
	baseC := "/api/projects/" + c.ID + "/files/" + url.PathEscape(model)
	if projectCall(t, h, "GET", baseC+"/download", nil, 200).Body.String() != changed {
		t.Fatal("export lost edits")
	}
	files, err := projects.Unpack(exported, ".")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(files["assets/raw.bin"], original["assets/raw.bin"]) || !bytes.Equal(files["models/Plant.views.json"], original["models/Plant.views.json"]) {
		t.Fatal("export changed assets/views")
	}
	if len(files[".skyview/layouts/models/Plant.layout.json"]) == 0 {
		t.Fatal("layout missing from export")
	}
	for path := range files {
		if strings.Contains(path, ".skyview/history/") {
			t.Fatal("private revision history exported")
		}
	}
	projectCall(t, h, "POST", "/api/projects/"+a.ID+"/files", map[string]string{"name": "another/New.sysml"}, 201)
	projectCall(t, h, "POST", "/api/projects/"+a.ID+"/files", map[string]string{"name": "../escape.sysml"}, 400)
	projectCall(t, h, "GET", "/api/projects/"+a.ID+"/files/"+url.PathEscape("../"+b.ID+"/"+model), nil, 404)
	projectCall(t, h, "DELETE", baseA, nil, 200)
	if projectCall(t, h, "GET", baseB+"/download", nil, 200).Body.String() != source {
		t.Fatal("deleting A changed B")
	}
	// A restart retains all projects, and the old file API remains available.
	h = New(root).Handler()
	projectCall(t, h, "GET", baseC+"/download", nil, 200)
	projectCall(t, h, "GET", "/api/files/example-model.sysml/download", nil, 200)
	projectUpload(t, h, []byte("broken zip"), "broken", 400)
	entries, err := projects.List(filepath.Join(root, "projects"))
	if err != nil || len(entries) != 3 {
		t.Fatalf("unexpected published projects: %v %v", entries, err)
	}
}
func TestBundledExamplesAreIndependent(t *testing.T) {
	s := New(t.TempDir())
	h := s.Handler()
	for _, example := range examples.List() {
		w := projectCall(t, h, "POST", "/api/projects", map[string]string{"name": example.Name, "example": example.ID}, 201)
		var info projects.Info
		json.Unmarshal(w.Body.Bytes(), &info)
		child, _, err := s.project(info.ID)
		if err != nil {
			t.Fatal(err)
		}
		before, err := examples.Files(example.ID)
		if err != nil {
			t.Fatal(err)
		}
		for name, content := range before {
			if projects.ModelPath(name) {
				if got, err := child.readFile(name); err != nil || got != string(content) {
					t.Fatal("example copy changed")
				}
				if err := child.writeFile(name, "package Edited;"); err != nil {
					t.Fatal(err)
				}
				after, _ := examples.Files(example.ID)
				if !bytes.Equal(after[name], content) {
					t.Fatal("template mutated")
				}
			}
		}
	}
}
func TestLocalFolderAndStateConfinement(t *testing.T) {
	local, outside := t.TempDir(), t.TempDir()
	s := New(t.TempDir())
	if err := os.WriteFile(filepath.Join(local, "P.sysml"), []byte("package P;"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := s.ConfigureProject("cart", local); err != nil {
		t.Fatal(err)
	}
	child, _, err := s.project("local-cart")
	if err != nil {
		t.Fatal(err)
	}
	projectCall(t, s.Handler(), "GET", "/api/projects/local-cart/files/P.sysml", nil, 200)
	if err := os.Symlink(outside, filepath.Join(local, ".skyview")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if err := child.writeLayout("P.sysml", []byte("{}")); err == nil {
		t.Fatal("layout escaped")
	}
	if _, err := child.readLayout("P.sysml"); err == nil {
		t.Fatal("layout read escaped")
	}
	if err := child.writeFile("P.sysml", "package Changed;"); err == nil {
		t.Fatal("history escaped")
	}
	if _, err := child.listHistory("P.sysml"); err == nil {
		t.Fatal("history list escaped")
	}
	if _, err := child.readRevision("P.sysml", "revision.sysml"); err == nil {
		t.Fatal("history read escaped")
	}
	if err := child.deleteFile("P.sysml"); err == nil {
		t.Fatal("delete accepted unconfined state")
	}
	entries, err := os.ReadDir(outside)
	if err != nil || len(entries) != 0 {
		t.Fatal("outside folder modified")
	}
	if err := os.Symlink(filepath.Join(outside, "P.sysml"), filepath.Join(local, "Q.sysml")); err != nil {
		t.Fatal(err)
	}
	if _, err := child.readFile("Q.sysml"); err == nil {
		t.Fatal("model link followed")
	}
}

func TestNestedHistoryIsolation(t *testing.T) {
	s := &Server{workspace: t.TempDir(), recursive: true}
	for _, name := range []string{"A.sysml", "A/B.sysml"} {
		if err := s.writeFile(name, "package Original;"); err != nil {
			t.Fatal(err)
		}
		if err := s.writeFile(name, "package Edited;"); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.deleteFile("A.sysml"); err != nil {
		t.Fatal(err)
	}
	history, err := s.listHistory("A/B.sysml")
	if err != nil || len(history) != 1 {
		t.Fatalf("deleting a parent-named model removed another model's history: %v %v", history, err)
	}
	source, err := s.readRevision("A/B.sysml", history[0].ID)
	if err != nil || source != "package Original;" {
		t.Fatal("nested history changed")
	}
}
