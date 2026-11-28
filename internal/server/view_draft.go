package server

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/Rexus/SkyView/internal/sysml"
	"github.com/Rexus/SkyView/internal/views"
)

type viewDraft struct {
	Base   string          `json:"base"`
	Config json.RawMessage `json:"config"`
}

func (s *Server) viewDraftPath(name string) (string, error) {
	if _, err := s.filePath(name); err != nil {
		return "", err
	}
	return s.statePath(filepath.Join(s.workspace, ".skyview", "view-drafts", strings.TrimSuffix(name, ".sysml")+".json"))
}

func viewRevision(path string) (string, error) {
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return revisionOf(string(raw)), nil
}

func readViewDraft(path, base string) (*viewDraft, string, error) {
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, "", nil
	}
	if err != nil {
		return nil, "", err
	}
	var draft viewDraft
	if err = json.Unmarshal(raw, &draft); err != nil {
		return nil, "", err
	}
	if draft.Base != base {
		return nil, "", nil
	}
	return &draft, revisionOf(string(raw)), nil
}

func (s *Server) handleViewDraft(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	savedPath, err := s.viewsPath(name)
	if err != nil {
		writeError(w, 400, err.Error(), nil)
		return
	}
	path, err := s.viewDraftPath(name)
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
	base, err := viewRevision(savedPath)
	if err != nil {
		writeError(w, 500, "could not read the saved view revision", nil)
		return
	}
	draft, revision, err := readViewDraft(path, base)
	if err != nil {
		writeError(w, 500, "could not read the diagram autosave", nil)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	if r.Method == http.MethodGet {
		if draft == nil {
			writeError(w, 404, "no current diagram autosave", nil)
			return
		}
		w.Header().Set("ETag", revision)
		writeJSON(w, 200, draft)
		return
	}
	if r.Header.Get("If-View-Match") != base || r.Header.Get("If-Draft-Match") != revision {
		writeError(w, 409, "the saved view or its autosave changed in another session", nil)
		return
	}
	if r.Method == http.MethodDelete {
		if err = os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			writeError(w, 500, "could not remove the diagram autosave", nil)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Header.Get("If-Match") != revisionOf(source) {
		writeError(w, 409, "the model changed before the diagram autosave", nil)
		return
	}
	body, err := readLimited(r.Body, maxLayoutSize)
	if err != nil {
		writeError(w, 400, "invalid or oversized diagram autosave", nil)
		return
	}
	config, err := views.Parse(body)
	if err != nil {
		writeError(w, 422, err.Error(), nil)
		return
	}
	model := sysml.Parse(source)
	for _, view := range config.Views {
		if err = view.Validate(model); err != nil {
			writeError(w, 422, err.Error(), nil)
			return
		}
	}
	raw, err := json.Marshal(viewDraft{Base: base, Config: body})
	if err == nil {
		err = atomicWrite(path, raw)
	}
	if err != nil {
		writeError(w, 500, "could not write the diagram autosave", nil)
		return
	}
	w.Header().Set("ETag", revisionOf(string(raw)))
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) clearPublishedViewDraft(name, base string, body []byte) {
	path, err := s.viewDraftPath(name)
	if err != nil {
		return
	}
	draft, _, err := readViewDraft(path, base)
	if err != nil || draft == nil {
		return
	}
	var compact bytes.Buffer
	if json.Compact(&compact, body) == nil && bytes.Equal(compact.Bytes(), draft.Config) {
		_ = os.Remove(path)
	}
}
