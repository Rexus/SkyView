package server

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"

	"github.com/Rexus/SkyView/internal/projects"
	"github.com/Rexus/SkyView/internal/views"
)

// The caller holds the project write lock so palette reads match a whole saved version.
func (s *Server) readPalette() (views.Palette, string, error) {
	path, err := projects.Resolve(s.workspace, views.PaletteName)
	if err != nil {
		return views.Palette{}, "", err
	}
	file, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return views.DefaultPalette(), "default", nil
	}
	if err != nil {
		return views.Palette{}, "", err
	}
	defer file.Close()
	data, err := readLimited(file, views.PaletteSize)
	if err != nil {
		return views.Palette{}, "", err
	}
	palette, err := views.ParsePalette(data)
	return palette, revisionOf(string(data)), err
}

func writePalette(w http.ResponseWriter, palette views.Palette, revision string) {
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, map[string]any{"revision": revision, "colours": palette.Colours, "keywords": palette.Keywords()})
}

func (s *Server) handlePalette(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		s.mu.Lock()
		palette, revision, err := s.readPalette()
		s.mu.Unlock()
		if err != nil {
			writeError(w, 422, err.Error(), nil)
			return
		}
		writePalette(w, palette, revision)
		return
	}
	body, err := readLimited(r.Body, views.PaletteSize)
	if err != nil {
		writeError(w, 400, err.Error(), nil)
		return
	}
	palette, err := views.ParsePalette(body)
	if err != nil {
		writeError(w, 400, err.Error(), nil)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	_, revision, err := s.readPalette()
	if err != nil {
		writeError(w, 422, err.Error(), nil)
		return
	}
	if revision != r.Header.Get("If-Match") {
		writeError(w, 409, "project colours changed; reload before saving", nil)
		return
	}
	path, err := projects.Resolve(s.workspace, views.PaletteName)
	if err != nil {
		writeError(w, 500, err.Error(), nil)
		return
	}
	data, err := json.MarshalIndent(palette, "", "  ")
	if err != nil {
		writeError(w, 500, err.Error(), nil)
		return
	}
	data = append(data, '\n')
	if err = atomicWrite(path, data); err != nil {
		writeError(w, 500, err.Error(), nil)
		return
	}
	writePalette(w, palette, revisionOf(string(data)))
}
