package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"

	"github.com/Rexus/SkyView/examples"
	"github.com/Rexus/SkyView/internal/projects"
)

type localProject struct {
	root string
	info projects.Info
}

func (s *Server) ConfigureProject(name, root string) error {
	if !projects.ValidID(name) || len(name) > 84 {
		return fmt.Errorf("local project name must use 1–84 letters, digits, dashes or underscores")
	}
	absolute, err := filepath.Abs(root)
	if err != nil {
		return err
	}
	absolute, err = filepath.EvalSymlinks(absolute)
	if err != nil {
		return err
	}
	info, err := os.Stat(absolute)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("local project must be a directory")
	}
	id := "local-" + name
	s.catalogMu.Lock()
	defer s.catalogMu.Unlock()
	if _, exists := s.localProjects[id]; exists {
		return fmt.Errorf("duplicate local project name")
	}
	s.localProjects[id] = localProject{absolute, projects.Info{ID: id, Manifest: projects.Manifest{Version: 1, Name: name, Origin: projects.Origin{Kind: "local"}}}}
	return nil
}
func (s *Server) projectRoot() string { return filepath.Join(s.workspace, "projects") }
func (s *Server) project(id string) (*Server, projects.Info, error) {
	if id == "workspace" {
		return s, projects.Info{ID: id, Manifest: projects.Manifest{Version: 1, Name: "Workspace files", Origin: projects.Origin{Kind: "legacy"}}}, nil
	}
	s.catalogMu.Lock()
	defer s.catalogMu.Unlock()
	root := ""
	var info projects.Info
	var err error
	if local, ok := s.localProjects[id]; ok {
		root, info = local.root, local.info
	} else {
		info, err = projects.Read(s.projectRoot(), id)
		if err != nil {
			return nil, info, fmt.Errorf("project not found: %s", id)
		}
		root = filepath.Join(s.projectRoot(), id)
	}
	child := s.projectServers[id]
	if child == nil {
		child = &Server{workspace: root, recursive: true}
		s.projectServers[id] = child
	}
	return child, info, nil
}
func (s *Server) registerProjectRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/projects", s.handleProjects)
	mux.HandleFunc("POST /api/projects", s.handleCreateProject)
	mux.HandleFunc("POST /api/projects/upload", s.handleUploadProject)
	mux.HandleFunc("POST /api/projects/git", s.handleGitProject)
	mux.HandleFunc("GET /api/projects/{project}/export", s.handleExportProject)
	mux.HandleFunc("GET /api/examples", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"examples": examples.List()})
	})
}
func (s *Server) handleProjects(w http.ResponseWriter, r *http.Request) {
	s.catalogMu.Lock()
	defer s.catalogMu.Unlock()
	list, err := projects.List(s.projectRoot())
	if err != nil {
		writeError(w, 500, err.Error(), nil)
		return
	}
	for _, local := range s.localProjects {
		list = append(list, local.info)
	}
	list = append(list, projects.Info{ID: "workspace", Manifest: projects.Manifest{Version: 1, Name: "Workspace files", Origin: projects.Origin{Kind: "legacy"}}})
	writeJSON(w, 200, map[string]any{"projects": list})
}
func (s *Server) publishProject(w http.ResponseWriter, manifest projects.Manifest, files map[string][]byte) {
	s.catalogMu.Lock()
	defer s.catalogMu.Unlock()
	info, err := projects.Create(s.projectRoot(), manifest, files)
	if err != nil {
		writeError(w, 400, err.Error(), nil)
		return
	}
	writeJSON(w, 201, info)
}
func (s *Server) handleCreateProject(w http.ResponseWriter, r *http.Request) {
	var request struct {
		Name    string `json:"name"`
		Example string `json:"example"`
	}
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, 400, err.Error(), nil)
		return
	}
	files := map[string][]byte{"System.sysml": []byte(starterModel("System.sysml"))}
	origin := projects.Origin{Kind: "new"}
	if request.Example != "" {
		var err error
		files, err = examples.Files(request.Example)
		if err != nil {
			writeError(w, 400, err.Error(), nil)
			return
		}
		origin = projects.Origin{Kind: "example", Example: request.Example}
	}
	s.publishProject(w, projects.Manifest{Name: request.Name, Origin: origin}, files)
}
func (s *Server) handleUploadProject(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, projects.MaxArchive+(1<<20))
	if err := r.ParseMultipartForm(1 << 20); err != nil {
		writeError(w, 400, "upload a ZIP archive up to 64 MiB", nil)
		return
	}
	defer r.MultipartForm.RemoveAll()
	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, 400, "ZIP file is required", nil)
		return
	}
	defer file.Close()
	data, err := readLimited(file, projects.MaxArchive)
	if err != nil {
		writeError(w, 400, err.Error(), nil)
		return
	}
	files, err := projects.Unpack(data, r.FormValue("directory"))
	if err != nil {
		writeError(w, 400, err.Error(), nil)
		return
	}
	manifest := projects.Manifest{Name: r.FormValue("name"), Origin: projects.Origin{Kind: "upload", Directory: r.FormValue("directory")}}
	if raw, exists := files[projects.ManifestName]; exists {
		var previous projects.Manifest
		if len(raw) > 16<<10 || json.Unmarshal(raw, &previous) != nil || previous.Version != 1 {
			writeError(w, 400, "invalid project manifest", nil)
			return
		}
		if manifest.Name == "" {
			manifest.Name = previous.Name
		}
		// Provenance travels as data only; it never grants paths or credentials.
		manifest.Origin = previous.Origin
	}
	s.publishProject(w, manifest, files)
}
func (s *Server) handleGitProject(w http.ResponseWriter, r *http.Request) {
	var request projects.GitRequest
	if err := decodeJSON(r, &request); err != nil {
		writeError(w, 400, err.Error(), nil)
		return
	}
	files, origin, err := projects.FetchSnapshot(r.Context(), projects.SnapshotClient(), request)
	if err != nil {
		writeError(w, 400, err.Error(), nil)
		return
	}
	s.publishProject(w, projects.Manifest{Name: request.Name, Origin: origin}, files)
}
func (s *Server) handleExportProject(w http.ResponseWriter, r *http.Request) {
	project, info, err := s.project(r.PathValue("project"))
	if err != nil {
		writeError(w, 404, err.Error(), nil)
		return
	}
	project.mu.Lock()
	defer project.mu.Unlock()
	data, err := projects.Export(project.workspace, info, project.recursive)
	if err != nil {
		writeError(w, 400, err.Error(), nil)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.zip"`, info.ID))
	w.Write(data)
}
