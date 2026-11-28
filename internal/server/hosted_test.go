package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const (
	testPublicURL    = "https://skyview.example.com"
	testRootPassword = "root-test-generated-credential"
	testUserPassword = "alice-test-generated-credential"
)

func writeTestAccounts(t *testing.T, accounts string) string {
	t.Helper()
	file := filepath.Join(t.TempDir(), "accounts.json")
	if err := os.WriteFile(file, []byte(accounts), 0o600); err != nil {
		t.Fatal(err)
	}
	return file
}

func TestHostedModeSeparatesAccountWorkspaces(t *testing.T) {
	workspace := t.TempDir()
	legacy := "package ExistingRootProject { part def Legacy; }"
	if err := os.WriteFile(filepath.Join(workspace, "legacy.sysml"), []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}
	accounts := writeTestAccounts(t, "[{\"name\":\"root\",\"password\":\""+testRootPassword+
		"\"},{\"name\":\"alice\",\"password\":\""+testUserPassword+"\"}]")
	handler, err := NewHosted(workspace, accounts, testPublicURL)
	if err != nil {
		t.Fatal(err)
	}

	call := func(method, path, user, password, origin, body string, status int) *httptest.ResponseRecorder {
		t.Helper()
		request := httptest.NewRequest(method, testPublicURL+path, strings.NewReader(body))
		if user != "" {
			request.SetBasicAuth(user, password)
		}
		if origin != "" {
			request.Header.Set("Origin", origin)
		}
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if response.Code != status {
			t.Fatalf("%s %s as %q returned %d, want %d: %s", method, path, user, response.Code, status, response.Body)
		}
		return response
	}

	health := call("GET", "/api/health", "", "", "", "", http.StatusOK)
	if strings.Contains(health.Body.String(), workspace) {
		t.Fatal("public health returned a workspace path")
	}
	anonymous := call("GET", "/", "", "", "", "", http.StatusUnauthorized)
	if anonymous.Header().Get("WWW-Authenticate") == "" {
		t.Fatal("browser did not receive an authentication challenge")
	}
	call("GET", "/api/projects", "root", "wrong", "", "", http.StatusUnauthorized)
	call("GET", "/api/projects", "unknown", testRootPassword, "", "", http.StatusUnauthorized)
	call("GET", "/api/files/legacy.sysml/download", "", "", "", "", http.StatusUnauthorized)
	call("GET", "/", "root", testRootPassword, "", "", http.StatusOK)
	rootFile := call("GET", "/api/files/legacy.sysml/download", "root", testRootPassword, "", "", http.StatusOK)
	if rootFile.Body.String() != legacy || rootFile.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("root did not retain its workspace with private responses")
	}
	call("GET", "/api/projects/workspace/files/legacy.sysml/download", "alice", testUserPassword, "", "", http.StatusNotFound)

	example := "{\"name\":\"Alice's project\",\"example\":\"inspection-drone\"}"
	call("POST", "/api/projects", "alice", testUserPassword, "https://other.example.com", example, http.StatusForbidden)
	imported := call("POST", "/api/projects", "alice", testUserPassword, testPublicURL, example, http.StatusCreated)
	var created struct{ ID string }
	if err := json.Unmarshal(imported.Body.Bytes(), &created); err != nil || created.ID == "" {
		t.Fatalf("invalid project: %s", imported.Body)
	}
	prefix := "/api/projects/" + created.ID
	file := prefix + "/files/" + url.PathEscape("models/InspectionDrone.sysml") + "/download"
	aliceFile := call("GET", file, "alice", testUserPassword, "", "", http.StatusOK)
	if !bytes.Contains(aliceFile.Body.Bytes(), []byte("package InspectionDrone")) || aliceFile.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("example model or hosted response headers are incorrect")
	}
	call("GET", file, "root", testRootPassword, "", "", http.StatusNotFound)
	call("GET", prefix+"/export", "root", testRootPassword, "", "", http.StatusNotFound)
	call("GET", prefix+"/export", "alice", testUserPassword, "", "", http.StatusOK)

	restarted, err := NewHosted(workspace, accounts, testPublicURL)
	if err != nil {
		t.Fatal(err)
	}
	handler = restarted
	call("GET", file, "alice", testUserPassword, "", "", http.StatusOK)

	rotated := "another-root-test-generated-password"
	handler, err = NewHosted(workspace, writeTestAccounts(t, "[{\"name\":\"root\",\"password\":\""+rotated+"\"}]"), testPublicURL)
	if err != nil {
		t.Fatal(err)
	}
	call("GET", "/api/projects", "alice", testUserPassword, "", "", http.StatusUnauthorized)
	call("GET", "/api/projects", "root", testRootPassword, "", "", http.StatusUnauthorized)
	call("GET", "/api/files/legacy.sysml/download", "root", rotated, "", "", http.StatusOK)
}

func TestHostedModeRejectsInvalidBootstrap(t *testing.T) {
	workspace := t.TempDir()
	valid := "{\"name\":\"root\",\"password\":\"" + testRootPassword + "\"}"
	for _, tc := range []struct {
		name, secret, origin string
	}{
		{"missing root", "[]", testPublicURL},
		{"weak password", "[{\"name\":\"root\",\"password\":\"root\"}]", testPublicURL},
		{"duplicate account", "[" + valid + "," + valid + "]", testPublicURL},
		{"unsafe username", "[" + valid + ",{\"name\":\"../alice\",\"password\":\"" + testUserPassword + "\"}]", testPublicURL},
		{"insecure origin", "[" + valid + "]", "http://skyview.example.com"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := NewHosted(workspace, writeTestAccounts(t, tc.secret), tc.origin); err == nil {
				t.Fatal("invalid hosted configuration was accepted")
			}
		})
	}
}
