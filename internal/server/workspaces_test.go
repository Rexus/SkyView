package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/Rexus/SkyView/internal/projects"
)

func TestWorkspaceCatalogPreservesProjectIdentityAndPortability(t *testing.T) {
	root := t.TempDir()
	api := New(root).Handler()
	workspaces := func(h http.Handler) ([]workspaceInfo, map[string]string) {
		t.Helper()
		var catalog struct {
			Workspaces []workspaceInfo `json:"workspaces"`
			Projects   []projects.Info `json:"projects"`
		}
		response := projectCall(t, h, "GET", "/api/projects", nil, 200)
		if err := json.Unmarshal(response.Body.Bytes(), &catalog); err != nil {
			t.Fatal(err)
		}
		membership := make(map[string]string)
		for _, project := range catalog.Projects {
			membership[project.ID] = project.WorkspaceID
		}
		return catalog.Workspaces, membership
	}
	groups, initial := workspaces(api)
	if len(groups) != 1 || groups[0].ID != defaultWorkspace || len(initial) != 1 || initial["workspace"] != "" {
		t.Fatalf("old store: %+v %+v", groups, initial)
	}
	createWorkspace := func(name string) workspaceInfo {
		t.Helper()
		var info workspaceInfo
		response := projectCall(t, api, "POST", "/api/workspaces", map[string]string{"name": name}, 201)
		if err := json.Unmarshal(response.Body.Bytes(), &info); err != nil {
			t.Fatal(err)
		}
		return info
	}
	design, lab := createWorkspace("Design"), createWorkspace("Lab")
	projectCall(t, api, "POST", "/api/workspaces", map[string]string{"name": "design"}, 409)
	createProject := func(name, workspaceID string) projects.Info {
		t.Helper()
		var info projects.Info
		response := projectCall(t, api, "POST", "/api/projects", map[string]string{"name": name, "workspaceId": workspaceID}, 201)
		if err := json.Unmarshal(response.Body.Bytes(), &info); err != nil {
			t.Fatal(err)
		}
		return info
	}
	drone, cart, legacy := createProject("Drone", design.ID), createProject("Cart", design.ID), createProject("Previous project", "")
	dronePath := filepath.Join(root, "projects", drone.ID, "System.sysml")
	before, err := os.ReadFile(dronePath)
	if err != nil {
		t.Fatal(err)
	}
	projectCall(t, api, "POST", "/api/projects", map[string]string{"name": "Invalid", "workspaceId": "../wrong"}, 404)
	projectCall(t, api, "POST", "/api/projects/git", map[string]string{"repository": "invalid", "workspaceId": "missing"}, 404)
	projectCall(t, api, "PATCH", "/api/projects/workspace/workspace", map[string]string{"workspaceId": lab.ID}, 400)
	projectCall(t, api, "PATCH", "/api/projects/"+drone.ID+"/workspace", map[string]string{"workspaceId": lab.ID}, 200)
	projectCall(t, api, "GET", "/api/projects/"+drone.ID+"/files/System.sysml", nil, 200)
	after, err := os.ReadFile(dronePath)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("move changed source: %v", err)
	}

	api = New(root).Handler()
	groups, membership := workspaces(api)
	if len(groups) != 3 || len(membership) != 4 || membership[drone.ID] != lab.ID || membership[cart.ID] != design.ID || membership[legacy.ID] != "" {
		t.Fatalf("unexpected persisted membership: %+v %+v", groups, membership)
	}
	archive := projectCall(t, api, "GET", "/api/projects/"+drone.ID+"/export", nil, 200).Body.Bytes()
	files, err := projects.Unpack(archive, ".")
	if err != nil || !bytes.Equal(files["System.sysml"], before) || bytes.Contains(files[projects.ManifestName], []byte("workspaceId")) {
		t.Fatalf("export changed source or contains server-local workspace metadata: %v", err)
	}
	copy := projectUpload(t, api, archive, "Independent copy", 201)
	if copy.WorkspaceID != "" || copy.ID == drone.ID {
		t.Fatalf("import inherited workspace assignment: %+v", copy)
	}
}
