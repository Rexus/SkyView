package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
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
	return append(list, saved...), nil
}

func (s *Server) handleCreateWorkspace(w http.ResponseWriter, r *http.Request) {
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
	if len(list) >= 200 {
		writeError(w, 400, "workspace limit reached", nil)
		return
	}
	for _, entry := range list {
		if strings.EqualFold(name, entry.Name) {
			writeError(w, 409, "a workspace already has that name", nil)
			return
		}
	}
	workspace := workspaceInfo{ID: "workspace-" + randomSuffix(8), Name: name}
	path, err := projects.Resolve(s.workspace, workspaceCatalogPath)
	if err == nil {
		var data []byte
		data, err = json.MarshalIndent(append(list[1:], workspace), "", "  ")
		if err == nil {
			err = atomicWrite(path, append(data, '\n'))
		}
	}
	if err != nil {
		writeError(w, 500, err.Error(), nil)
		return
	}
	writeJSON(w, 201, workspace)
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

func (s *Server) handleMoveProject(w http.ResponseWriter, r *http.Request) {
	var request struct {
		WorkspaceID string `json:"workspaceId"`
	}
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, 400, err.Error(), nil)
		return
	}
	id := r.PathValue("project")
	s.catalogMu.Lock()
	defer s.catalogMu.Unlock()
	if _, local := s.localProjects[id]; local || id == "workspace" {
		writeError(w, 400, "only managed projects can move between workspaces", nil)
		return
	}
	if !s.checkWorkspace(w, request.WorkspaceID) {
		return
	}
	info, err := projects.Read(s.projectRoot(), id)
	if err != nil {
		writeError(w, 404, "project not found", nil)
		return
	}
	path, err := projects.Resolve(s.projectRoot(), id+"/"+projects.ManifestName)
	if err == nil {
		info.WorkspaceID = request.WorkspaceID
		var data []byte
		data, err = json.MarshalIndent(info.Manifest, "", "  ")
		if err == nil {
			err = atomicWrite(path, append(data, '\n'))
		}
	}
	if err != nil {
		writeError(w, 500, err.Error(), nil)
		return
	}
	writeJSON(w, 200, info)
}
