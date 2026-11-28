package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/Rexus/SkyView"
)

func TestAboutShowsAuthenticatedDeploymentAndSharedBuild(t *testing.T) {
	local := New(t.TempDir()).Handler()
	secret := writeTestAccounts(t, "[{\"name\":\"root\",\"password\":\""+testRootPassword+
		"\"},{\"name\":\"alice\",\"password\":\""+testUserPassword+"\"}]")
	hosted, err := NewHosted(t.TempDir(), secret, testPublicURL)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		h                    http.Handler
		name, password, mode string
		account              string
		status               int
	}{
		{local, "", "", "single-user", "local", 200},
		{hosted, "", "", "", "", 401},
		{hosted, "root", testRootPassword, "multi-user", "root", 200},
		{hosted, "alice", testUserPassword, "multi-user", "alice", 200},
	} {
		req := httptest.NewRequest(http.MethodGet, "/api/about", nil)
		if tc.name != "" {
			req.SetBasicAuth(tc.name, tc.password)
		}
		w := httptest.NewRecorder()
		tc.h.ServeHTTP(w, req)
		if w.Code != tc.status || w.Header().Get("Cache-Control") != "no-store" {
			t.Fatalf("about status or caching was wrong for %q: %d", tc.name, w.Code)
		}
		if w.Code != http.StatusOK {
			continue
		}
		var out struct {
			Account string
			Mode    string
			Build   skyview.Build
		}
		if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil ||
			out.Account != tc.account || out.Mode != tc.mode || out.Build != skyview.Current() {
			t.Fatalf("unexpected about data for %q: %+v %v", tc.name, out, err)
		}
	}
}
