package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"

	"example.com/skyview/internal/sysml"
)

// FileResponse is the complete document state returned to the client.
type FileResponse struct {
	Name        string             `json:"name"`
	Content     string             `json:"content"`
	Model       *sysml.Model       `json:"model"`
	Diagnostics []sysml.Diagnostic `json:"diagnostics"`
	Revision    string             `json:"revision"`
}

func makeFileResponse(name, content string) FileResponse {
	m := sysml.Parse(content)
	return FileResponse{
		Name:        name,
		Content:     content,
		Model:       m,
		Diagnostics: m.Diagnostics,
		Revision:    revisionOf(content),
	}
}

func (s *Server) handleListFiles(w http.ResponseWriter, r *http.Request) {
	files, err := s.listFiles()
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error(), nil)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"files": files})
}

type createFileRequest struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

func (s *Server) handleCreateFile(w http.ResponseWriter, r *http.Request) {
	var req createFileRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), nil)
		return
	}
	if !validFileName(req.Name) {
		writeError(w, http.StatusBadRequest, "invalid file name; use letters, digits, dots, dashes and underscores, ending in .sysml", nil)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	path, _ := s.filePath(req.Name)
	if _, err := os.Stat(path); err == nil {
		writeError(w, http.StatusConflict, "a file with that name already exists", nil)
		return
	}
	content := req.Content
	if strings.TrimSpace(content) == "" {
		content = starterModel(req.Name)
	}
	if err := s.writeFile(req.Name, content); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error(), nil)
		return
	}
	writeJSON(w, http.StatusCreated, makeFileResponse(req.Name, content))
}

func (s *Server) handleGetFile(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	content, err := s.readFile(name)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error(), nil)
		return
	}
	writeJSON(w, http.StatusOK, makeFileResponse(name, content))
}

type saveFileRequest struct {
	Content string `json:"content"`
}

func (s *Server) handleSaveFile(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	var req saveFileRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), nil)
		return
	}
	if len(req.Content) > maxFileSize {
		writeError(w, http.StatusRequestEntityTooLarge, "file is too large", nil)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.readFile(name); err != nil {
		writeError(w, http.StatusNotFound, err.Error(), nil)
		return
	}
	if err := s.writeFile(name, req.Content); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error(), nil)
		return
	}
	writeJSON(w, http.StatusOK, makeFileResponse(name, req.Content))
}

func (s *Server) handleDeleteFile(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.deleteFile(name); err != nil {
		writeError(w, http.StatusNotFound, err.Error(), nil)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleDownloadFile(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	content, err := s.readFile(name)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error(), nil)
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", name))
	_, _ = w.Write([]byte(content))
}

func (s *Server) handleValidate(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	content, err := s.readFile(name)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error(), nil)
		return
	}
	var req struct {
		Content *string `json:"content"`
	}
	if r.ContentLength != 0 {
		if err := decodeJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, err.Error(), nil)
			return
		}
		if req.Content != nil {
			content = *req.Content
		}
	}
	resp := makeFileResponse(name, content)
	writeJSON(w, http.StatusOK, map[string]any{
		"diagnostics": resp.Diagnostics,
		"revision":    resp.Revision,
	})
}

type addElementRequest struct {
	Parent string `json:"parent"`
	Kind   string `json:"kind"`
	IsDef  bool   `json:"isDef"`
	Name   string `json:"name"`
	Type   string `json:"type"`
	Doc    string `json:"doc"`
	Value  string `json:"value"`
}

func (s *Server) handleAddElement(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	var req addElementRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), nil)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	src, err := s.readFile(name)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error(), nil)
		return
	}
	m := sysml.Parse(src)
	out, err := sysml.AddElement(src, m, req.Parent, req.Kind, req.IsDef, req.Name, req.Type, req.Doc, req.Value)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error(), m.Diagnostics)
		return
	}
	outModel, err := sysml.ValidateEdit(m, out)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error(), outModel.Diagnostics)
		return
	}
	if err := s.writeFile(name, out); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error(), nil)
		return
	}
	writeJSON(w, http.StatusOK, makeFileResponse(name, out))
}

type patchElementRequest struct {
	ID    string  `json:"id"`
	Name  *string `json:"name"`
	Type  *string `json:"type"`
	Doc   *string `json:"doc"`
	Value *string `json:"value"`
}

func (s *Server) handlePatchElement(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	var req patchElementRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), nil)
		return
	}
	if req.ID == "" {
		writeError(w, http.StatusBadRequest, "element id is required", nil)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	src, err := s.readFile(name)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error(), nil)
		return
	}
	m := sysml.Parse(src)
	e := m.Element(req.ID)
	if e == nil {
		writeError(w, http.StatusNotFound, "element not found", nil)
		return
	}

	apply := func(fn func(string, *sysml.Model) (string, error)) error {
		out, err := fn(src, m)
		if err != nil {
			return err
		}
		next, err := sysml.ValidateEdit(m, out)
		if err != nil {
			return err
		}
		src, m = out, next
		return nil
	}

	// Apply non-identity edits first: renaming changes the element id, so it
	// must come last.
	if req.Type != nil && *req.Type != e.Type {
		if err := apply(func(s string, mm *sysml.Model) (string, error) {
			return sysml.SetType(s, mm, req.ID, *req.Type)
		}); err != nil {
			writeError(w, http.StatusUnprocessableEntity, err.Error(), m.Diagnostics)
			return
		}
	}
	if req.Doc != nil && *req.Doc != e.Doc {
		if err := apply(func(s string, mm *sysml.Model) (string, error) {
			return sysml.SetDoc(s, mm, req.ID, *req.Doc)
		}); err != nil {
			writeError(w, http.StatusUnprocessableEntity, err.Error(), m.Diagnostics)
			return
		}
	}
	if req.Value != nil && *req.Value != e.Value {
		if err := apply(func(s string, mm *sysml.Model) (string, error) {
			return sysml.SetValue(s, mm, req.ID, *req.Value)
		}); err != nil {
			writeError(w, http.StatusUnprocessableEntity, err.Error(), m.Diagnostics)
			return
		}
	}
	if req.Name != nil && *req.Name != e.Name {
		if err := apply(func(s string, mm *sysml.Model) (string, error) {
			return sysml.RenameElement(s, mm, req.ID, *req.Name)
		}); err != nil {
			writeError(w, http.StatusUnprocessableEntity, err.Error(), m.Diagnostics)
			return
		}
	}
	if err := s.writeFile(name, src); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error(), nil)
		return
	}
	writeJSON(w, http.StatusOK, makeFileResponse(name, src))
}

func (s *Server) handleDeleteElement(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	id := r.URL.Query().Get("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "element id is required", nil)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	src, err := s.readFile(name)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error(), nil)
		return
	}
	m := sysml.Parse(src)
	out, err := sysml.DeleteElement(src, m, id)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error(), m.Diagnostics)
		return
	}
	outModel, err := sysml.ValidateEdit(m, out)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error(), outModel.Diagnostics)
		return
	}
	if err := s.writeFile(name, out); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error(), nil)
		return
	}
	writeJSON(w, http.StatusOK, makeFileResponse(name, out))
}

type addConnectionRequest struct {
	Parent string `json:"parent"`
	Name   string `json:"name"`
	Source string `json:"source"`
	Target string `json:"target"`
}

func (s *Server) handleAddConnection(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	var req addConnectionRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), nil)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	src, err := s.readFile(name)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error(), nil)
		return
	}
	m := sysml.Parse(src)
	out, err := sysml.AddConnection(src, m, req.Parent, req.Name, req.Source, req.Target)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error(), m.Diagnostics)
		return
	}
	outModel, err := sysml.ValidateEdit(m, out)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error(), outModel.Diagnostics)
		return
	}
	if err := s.writeFile(name, out); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error(), nil)
		return
	}
	writeJSON(w, http.StatusOK, makeFileResponse(name, out))
}

type addSatisfyRequest struct {
	Parent      string `json:"parent"`
	Requirement string `json:"requirement"`
	Satisfier   string `json:"satisfier"`
}

func (s *Server) handleAddSatisfy(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	var req addSatisfyRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), nil)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	src, err := s.readFile(name)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error(), nil)
		return
	}
	m := sysml.Parse(src)
	out, err := sysml.AddSatisfy(src, m, req.Parent, req.Requirement, req.Satisfier)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error(), m.Diagnostics)
		return
	}
	outModel, err := sysml.ValidateEdit(m, out)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error(), outModel.Diagnostics)
		return
	}
	if err := s.writeFile(name, out); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error(), nil)
		return
	}
	writeJSON(w, http.StatusOK, makeFileResponse(name, out))
}

func (s *Server) handleGetLayout(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if _, err := s.filePath(name); err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), nil)
		return
	}
	b, err := s.readLayout(name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error(), nil)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(b)
}

func (s *Server) handlePutLayout(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if _, err := s.filePath(name); err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), nil)
		return
	}
	body, err := readLimited(r.Body, maxLayoutSize)
	if err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, err.Error(), nil)
		return
	}
	if !json.Valid(body) {
		writeError(w, http.StatusBadRequest, "layout must be valid JSON", nil)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.writeLayout(name, body); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error(), nil)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) handleHistory(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if _, err := s.filePath(name); err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), nil)
		return
	}
	revs, err := s.listHistory(name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error(), nil)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"revisions": revs})
}

func (s *Server) handleRestore(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	var req struct {
		Revision string `json:"revision"`
	}
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error(), nil)
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.readFile(name); err != nil {
		writeError(w, http.StatusNotFound, err.Error(), nil)
		return
	}
	content, err := s.readRevision(name, req.Revision)
	if err != nil {
		writeError(w, http.StatusNotFound, err.Error(), nil)
		return
	}
	if err := s.writeFile(name, content); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error(), nil)
		return
	}
	writeJSON(w, http.StatusOK, makeFileResponse(name, content))
}

func starterModel(fileName string) string {
	pkg := strings.TrimSuffix(fileName, ".sysml")
	var b strings.Builder
	for _, r := range pkg {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' {
			b.WriteRune(r)
		}
	}
	name := b.String()
	if name == "" || !((name[0] >= 'a' && name[0] <= 'z') || (name[0] >= 'A' && name[0] <= 'Z') || name[0] == '_') {
		name = "MyModel"
	}
	return fmt.Sprintf(`package %s {
    private import ScalarValues::*;

    doc /* A new SysML v2 model. Use the grid, diagram and requirements views to
           shape the system, or edit the source directly. */

    part def System {
        doc /* The top-level system. */
    }

    part system : System;
}
`, name)
}

func decodeJSON(r *http.Request, v any) error {
	body, err := readLimited(r.Body, maxFileSize)
	if err != nil {
		return err
	}
	if len(strings.TrimSpace(string(body))) == 0 {
		return fmt.Errorf("empty request body")
	}
	if err := json.Unmarshal(body, v); err != nil {
		return fmt.Errorf("invalid JSON: %w", err)
	}
	return nil
}
