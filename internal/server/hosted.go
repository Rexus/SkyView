package server

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"

	"github.com/Rexus/SkyView/internal/projects"
	"github.com/Rexus/SkyView/internal/standards"
)

var accountName = regexp.MustCompile("^[a-z][a-z0-9-]{0,31}$")

type hostedAccount struct {
	digest  [sha256.Size]byte
	handler http.Handler
}

// NewHosted protects every application route and gives each authenticated user
// a separate catalog and storage root. The initial root account adopts the
// previous deployment's workspace in place.
func NewHosted(workspace, accountsFile, publicURL string) (http.Handler, error) {
	origin, err := url.Parse(publicURL)
	if err != nil || origin.Scheme != "https" || origin.Hostname() == "" || origin.User != nil ||
		origin.Path != "" || origin.RawQuery != "" || origin.ForceQuery || origin.Fragment != "" ||
		publicURL != "https://"+origin.Host {
		return nil, fmt.Errorf("SKYVIEW_PUBLIC_URL must be an HTTPS origin without a trailing slash")
	}
	if accountsFile == "" {
		return nil, fmt.Errorf("SKYVIEW_ACCOUNTS_FILE is required in multi-user mode")
	}
	raw, err := os.ReadFile(accountsFile)
	if err != nil {
		return nil, fmt.Errorf("read account secret: %w", err)
	}
	var entries []struct{ Name, Password string }
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil, fmt.Errorf("account secret must be a JSON array of name and password entries")
	}
	accounts := make(map[string]hostedAccount, len(entries))
	for _, entry := range entries {
		if !accountName.MatchString(entry.Name) || !projects.Relative(entry.Name) {
			return nil, fmt.Errorf("account names must be portable lowercase usernames")
		}
		if len(entry.Password) < 24 || len(entry.Password) > 256 || strings.TrimSpace(entry.Password) != entry.Password {
			return nil, fmt.Errorf("account %q requires a generated password of 24–256 characters", entry.Name)
		}
		if _, exists := accounts[entry.Name]; exists {
			return nil, fmt.Errorf("duplicate account %q", entry.Name)
		}
		accounts[entry.Name] = hostedAccount{digest: sha256.Sum256([]byte(entry.Password))}
	}
	if _, ok := accounts["root"]; !ok {
		return nil, fmt.Errorf("multi-user mode requires the root account")
	}
	// Share the process-wide limit on concurrent native Java checks across accounts.
	native := standards.NewRunner(standards.DefaultHome(), os.Getenv("SKYVIEW_SYSML_JAVA"))
	for name, account := range accounts {
		root := workspace
		if name != "root" {
			root, err = projects.Resolve(workspace, ".skyview/users/"+name)
			if err != nil {
				return nil, fmt.Errorf("account workspace %q: %w", name, err)
			}
		}
		app := newServer(root, native)
		if err := app.ensureWorkspace(); err != nil {
			return nil, fmt.Errorf("initialize workspace for %q: %w", name, err)
		}
		account.handler = app.handler(false, "multi-user", name)
		accounts[name] = account
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.URL.Path == "/api/health" && (r.Method == http.MethodGet || r.Method == http.MethodHead) {
			writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "service": "skyview"})
			return
		}
		if requestOrigin := r.Header.Get("Origin"); requestOrigin != "" && requestOrigin != publicURL {
			writeError(w, http.StatusForbidden, "cross-origin request", nil)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			fetchSite := r.Header.Get("Sec-Fetch-Site")
			if fetchSite != "" && fetchSite != "same-origin" {
				writeError(w, http.StatusForbidden, "cross-origin request", nil)
				return
			}
		}
		name, password, supplied := r.BasicAuth()
		digest := sha256.Sum256([]byte(password))
		account, exists := accounts[name]
		valid := subtle.ConstantTimeCompare(digest[:], account.digest[:]) == 1
		if !supplied || !exists || !valid {
			w.Header().Set("WWW-Authenticate", "Basic realm=\"SkyView\", charset=\"UTF-8\"")
			writeError(w, http.StatusUnauthorized, "sign in to SkyView", nil)
			return
		}
		account.handler.ServeHTTP(w, r)
	}), nil
}
