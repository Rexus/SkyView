package server

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/Rexus/SkyView/internal/projects"
	"github.com/Rexus/SkyView/internal/views"
)

func (s *Server) viewsPath(name string) (string, error) {
	if _, err := s.filePath(name); err != nil {
		return "", fmt.Errorf("invalid model file name")
	}
	return projects.Resolve(s.workspace, strings.TrimSuffix(name, ".sysml")+".views.json")
}
func (s *Server) handleViews(w http.ResponseWriter, r *http.Request) {
	p, err := s.viewsPath(r.PathValue("name"))
	if err != nil {
		writeError(w, 400, err.Error(), nil)
		return
	}
	b, err := os.ReadFile(p)
	if err != nil {
		writeError(w, 404, "no shared views for this model", nil)
		return
	}
	w.Header().Set("ETag", revisionOf(string(b)))
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(b)
}
func (s *Server) handlePutViews(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	p, err := s.viewsPath(name)
	if err != nil {
		writeError(w, 400, err.Error(), nil)
		return
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, maxLayoutSize+1))
	if err != nil || len(b) > maxLayoutSize {
		writeError(w, 400, "invalid or oversized view configuration", nil)
		return
	}
	c, err := views.Parse(b)
	if err != nil {
		writeError(w, 400, err.Error(), nil)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	source, err := s.readFile(name)
	if err != nil {
		writeError(w, 404, err.Error(), nil)
		return
	}
	// Conditional publication prevents attaching a selection to a changed source.
	if r.Header.Get("If-Match") != revisionOf(source) {
		writeError(w, 409, "model changed; read it again before publishing views", nil)
		return
	}
	if expected := r.Header.Get("If-View-Match"); expected != "" {
		old, readErr := os.ReadFile(p)
		if readErr != nil || expected != revisionOf(string(old)) {
			writeError(w, 409, "view changed; reload before saving", nil)
			return
		}
	}
	for _, v := range c.Views {
		if _, err = views.Render(source, v); err != nil {
			writeError(w, 422, err.Error(), nil)
			return
		}
	}
	if err = atomicWrite(p, b); err != nil {
		writeError(w, 500, err.Error(), nil)
		return
	}
	w.Header().Set("ETag", revisionOf(string(b)))
	writeJSON(w, 200, map[string]bool{"ok": true})
}
func (s *Server) handleViewSVG(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	p, err := s.viewsPath(name)
	if err != nil {
		writeError(w, 400, err.Error(), nil)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	source, err := s.readFile(name)
	if err != nil {
		writeError(w, 404, err.Error(), nil)
		return
	}
	b, err := os.ReadFile(p)
	if err != nil {
		writeError(w, 404, "no shared views for this model", nil)
		return
	}
	c, err := views.Parse(b)
	if err != nil {
		writeError(w, 422, err.Error(), nil)
		return
	}
	v, err := c.Find(r.PathValue("view"))
	if err != nil {
		writeError(w, 404, err.Error(), nil)
		return
	}
	palette, _, err := s.readPalette()
	if err != nil {
		writeError(w, 422, err.Error(), nil)
		return
	}
	v.Palette = palette
	svg, err := views.Render(source, v)
	if err != nil {
		writeError(w, 422, err.Error(), nil)
		return
	}
	w.Header().Set("Content-Type", "image/svg+xml; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(svg)
}

// Preview validates against the exact source revision without publishing layout.
func (s *Server) handlePreviewView(w http.ResponseWriter, r *http.Request) {
	b, err := io.ReadAll(io.LimitReader(r.Body, maxLayoutSize+1))
	if err != nil || len(b) > maxLayoutSize {
		writeError(w, 400, "invalid view configuration", nil)
		return
	}
	config, err := views.Parse(b)
	if err != nil {
		writeError(w, 400, err.Error(), nil)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	source, err := s.readFile(r.PathValue("name"))
	if err != nil {
		writeError(w, 404, err.Error(), nil)
		return
	}
	if r.Header.Get("If-Match") != revisionOf(source) {
		writeError(w, 409, "model changed; reload before previewing", nil)
		return
	}
	view, err := config.Find(r.URL.Query().Get("view"))
	if err != nil {
		writeError(w, 404, err.Error(), nil)
		return
	}
	palette, _, err := s.readPalette()
	if err != nil {
		writeError(w, 422, err.Error(), nil)
		return
	}
	view.Palette = palette
	if r.URL.Query().Get("format") == "scene" {
		scene, sceneErr := views.BuildScene(source, view)
		if sceneErr != nil {
			writeError(w, 422, sceneErr.Error(), nil)
			return
		}
		writeJSON(w, 200, scene)
		return
	}
	svg, err := views.Render(source, view)
	if err != nil {
		writeError(w, 422, err.Error(), nil)
		return
	}
	w.Header().Set("Content-Type", "image/svg+xml; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(svg)
}

// Interactive node glyphs use the same backend and source revision as file edits.
func (s *Server) handleDiagramNodes(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	source, err := s.readFile(r.PathValue("name"))
	if err != nil {
		writeError(w, 404, err.Error(), nil)
		return
	}
	if r.Header.Get("If-Match") != revisionOf(source) {
		writeError(w, 409, "model changed; reload diagram", nil)
		return
	}
	palette, _, err := s.readPalette()
	if err != nil {
		writeError(w, 422, err.Error(), nil)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, views.DetailedNodesWithPalette(source, palette))
}
