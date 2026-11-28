package server

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/Rexus/SkyView/internal/projects"
)

type projectSettings struct {
	Name        *string `json:"name"`
	WorkspaceID *string `json:"workspaceId"`
}

func (s *Server) handleProjectSettings(w http.ResponseWriter, r *http.Request) {
	var request projectSettings
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, 400, err.Error(), nil)
		return
	}
	if request.Name == nil && request.WorkspaceID == nil {
		writeError(w, 400, "provide a project name or workspace", nil)
		return
	}
	s.updateProject(w, r.PathValue("project"), request, false)
}

func (s *Server) handleMoveProject(w http.ResponseWriter, r *http.Request) {
	var request struct {
		WorkspaceID string `json:"workspaceId"`
	}
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, 400, err.Error(), nil)
		return
	}
	s.updateProject(w, r.PathValue("project"), projectSettings{WorkspaceID: &request.WorkspaceID}, false)
}

func (s *Server) handleRemoveProject(w http.ResponseWriter, r *http.Request) {
	s.updateProject(w, r.PathValue("project"), projectSettings{}, true)
}

func (s *Server) updateProject(w http.ResponseWriter, id string, settings projectSettings, remove bool) {
	s.catalogMu.Lock()
	defer s.catalogMu.Unlock()

	if _, local := s.localProjects[id]; local || id == "workspace" {
		writeError(w, 400, "project settings are available for managed projects", nil)
		return
	}
	info, err := projects.Read(s.projectRoot(), id)
	if err != nil {
		writeError(w, 404, "project not found", nil)
		return
	}
	if settings.Name != nil {
		info.Name = strings.TrimSpace(*settings.Name)
		if info.Name == "" || len(info.Name) > 120 {
			writeError(w, 400, "project name must contain 1–120 characters", nil)
			return
		}
	}
	if settings.WorkspaceID != nil {
		if !s.checkWorkspace(w, *settings.WorkspaceID) {
			return
		}
		info.WorkspaceID = *settings.WorkspaceID
	}
	// Retain the project directory so removal is recoverable and cannot
	// invalidate saved history or a file write already in progress.
	info.Removed = remove
	path, err := projects.Resolve(s.projectRoot(), id+"/"+projects.ManifestName)
	if err == nil {
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
	if remove {
		writeJSON(w, 200, map[string]bool{"ok": true})
	} else {
		writeJSON(w, 200, info)
	}
}
