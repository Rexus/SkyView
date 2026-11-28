package server

import "net/http"

// The same handlers serve legacy files and project-scoped files. Project identity
// is resolved once per request; each project retains one shared write lock.
func (s *Server) registerFileRoutes(mux *http.ServeMux) {
	routes := []struct {
		method, path string
		handle       func(*Server, http.ResponseWriter, *http.Request)
	}{
		{"GET", "/files", (*Server).handleListFiles},
		{"POST", "/files", (*Server).handleCreateFile},
		{"GET", "/files/{name}", (*Server).handleGetFile},
		{"PUT", "/files/{name}", (*Server).handleSaveFile},
		{"DELETE", "/files/{name}", (*Server).handleDeleteFile},
		{"GET", "/files/{name}/download", (*Server).handleDownloadFile},
		{"POST", "/files/{name}/validate", (*Server).handleValidate},
		{"POST", "/files/{name}/validate-native", (*Server).handleValidateNative},
		{"POST", "/files/{name}/element", (*Server).handleAddElement},
		{"PATCH", "/files/{name}/element", (*Server).handlePatchElement},
		{"DELETE", "/files/{name}/element", (*Server).handleDeleteElement},
		{"POST", "/files/{name}/connection", (*Server).handleAddConnection},
		{"POST", "/files/{name}/satisfy", (*Server).handleAddSatisfy},
		{"GET", "/files/{name}/diagram/nodes", (*Server).handleDiagramNodes},
		{"GET", "/files/{name}/layout", (*Server).handleGetLayout},
		{"PUT", "/files/{name}/layout", (*Server).handlePutLayout},
		{"GET", "/files/{name}/history", (*Server).handleHistory},
		{"POST", "/files/{name}/restore", (*Server).handleRestore},
		{"GET", "/files/{name}/views", (*Server).handleViews},
		{"PUT", "/files/{name}/views", (*Server).handlePutViews},
		{"GET", "/files/{name}/view-draft", (*Server).handleViewDraft},
		{"PUT", "/files/{name}/view-draft", (*Server).handleViewDraft},
		{"DELETE", "/files/{name}/view-draft", (*Server).handleViewDraft},
		{"POST", "/files/{name}/views/preview", (*Server).handlePreviewView},
		{"GET", "/files/{name}/views/{view}", (*Server).handleViewSVG},
	}
	for _, route := range routes {
		mux.HandleFunc(route.method+" /api"+route.path, func(w http.ResponseWriter, r *http.Request) { route.handle(s, w, r) })
		mux.HandleFunc(route.method+" /api/projects/{project}"+route.path, func(w http.ResponseWriter, r *http.Request) {
			project, _, err := s.project(r.PathValue("project"))
			if err != nil {
				writeError(w, 404, err.Error(), nil)
				return
			}
			route.handle(project, w, r)
		})
	}
}
