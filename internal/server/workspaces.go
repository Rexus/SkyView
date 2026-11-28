package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"slices"
	"strings"

	"github.com/Rexus/SkyView/internal/projects"
)

const defaultWorkspace = "default"
const workspaceCatalogPath = ".skyview/workspaces.json"

type workspaceInfo struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// The caller holds catalogMu. Older stores have an implicit default workspace.
func (s *Server) listWorkspaces() ([]workspaceInfo, error) {
	list := []workspaceInfo{{ID: defaultWorkspace, Name: "Default workspace"}}
	path, err := projects.Resolve(s.workspace, workspaceCatalogPath)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return list, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := readLimited(f, 128<<10)
	if err != nil {
		return nil, err
	}
	var saved []workspaceInfo
	if err := json.Unmarshal(data, &saved); err != nil {
		return nil, fmt.Errorf("invalid workspace catalog: %w", err)
	}
	for _, workspace := range saved {
		if workspace.ID == defaultWorkspace {
			list[0] = workspace
		} else {
			list = append(list, workspace)
		}
	}
	return list, nil
}

func (s *Server) saveWorkspaces(list []workspaceInfo) error {
	path, err := projects.Resolve(s.workspace, workspaceCatalogPath)
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	return atomicWrite(path, append(data, '\n'))
}

func (s *Server) handleWorkspaceSettings(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Name string `json:"name"`
	}
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, 400, err.Error(), nil)
		return
	}
	name := strings.TrimSpace(request.Name)
	if name == "" || len(name) > 120 {
		writeError(w, 400, "workspace name must contain 1–120 characters", nil)
		return
	}
	s.catalogMu.Lock()
	defer s.catalogMu.Unlock()
	list, err := s.listWorkspaces()
	if err != nil {
		writeError(w, 500, err.Error(), nil)
		return
	}
	id := r.PathValue("workspace")
	index := slices.IndexFunc(list, func(entry workspaceInfo) bool { return entry.ID == id })
	status := http.StatusOK
	if r.Method == http.MethodPost {
		if len(list) >= 200 {
			writeError(w, 400, "workspace limit reached", nil)
			return
		}
		id = "workspace-" + randomSuffix(8)
		status = http.StatusCreated
	} else if index < 0 {
		writeError(w, 404, "workspace not found", nil)
		return
	}
	for _, entry := range list {
		if entry.ID != id && strings.EqualFold(name, entry.Name) {
			writeError(w, 409, "a workspace already has that name", nil)
			return
		}
	}
	workspace := workspaceInfo{ID: id, Name: name}
	if status == http.StatusCreated {
		list = append(list, workspace)
	} else {
		list[index] = workspace
	}
	if err := s.saveWorkspaces(list); err != nil {
		writeError(w, 500, err.Error(), nil)
		return
	}
	writeJSON(w, status, workspace)
}

func (s *Server) handleRemoveWorkspace(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("workspace")
	if id == defaultWorkspace {
		writeError(w, 400, "the default workspace is required for server folders and workspace files", nil)
		return
	}
	s.catalogMu.Lock()
	defer s.catalogMu.Unlock()
	list, err := s.listWorkspaces()
	if err != nil {
		writeError(w, 500, err.Error(), nil)
		return
	}
	index := slices.IndexFunc(list, func(entry workspaceInfo) bool { return entry.ID == id })
	if index < 0 {
		writeError(w, 404, "workspace not found", nil)
		return
	}
	managed, err := projects.List(s.projectRoot())
	if err != nil {
		writeError(w, 500, err.Error(), nil)
		return
	}
	for _, project := range managed {
		if project.WorkspaceID == id {
			writeError(w, 409, "move or remove the workspace's projects before removing the workspace", nil)
			return
		}
	}
	if err := s.saveWorkspaces(slices.Delete(list, index, index+1)); err != nil {
		writeError(w, 500, err.Error(), nil)
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

// The caller holds catalogMu. The zero value is used by existing clients.
func (s *Server) checkWorkspace(w http.ResponseWriter, id string) bool {
	if id == "" || id == defaultWorkspace {
		return true
	}
	list, err := s.listWorkspaces()
	if err != nil {
		writeError(w, 500, err.Error(), nil)
		return false
	}
	for _, entry := range list {
		if entry.ID == id {
			return true
		}
	}
	writeError(w, 404, "workspace not found", nil)
	return false
}
