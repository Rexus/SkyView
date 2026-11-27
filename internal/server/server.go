package server

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"github.com/Rexus/SkyView/examples"
	"io/fs"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"
)

//go:embed dist
var distFS embed.FS

// The legacy workspace seed uses the same authoritative starter as the picker.
var sampleModel = examples.Starter()

// Server is the SkyView HTTP application.
type Server struct {
	workspace      string
	mu             sync.Mutex
	catalogMu      sync.Mutex
	projectServers map[string]*Server
	localProjects  map[string]localProject
	recursive      bool
}

// New creates a server rooted at the given workspace directory. If the
// workspace has no SysML files, the bundled example sample is seeded.
func New(workspace string) *Server {
	s := &Server{workspace: workspace, projectServers: map[string]*Server{}, localProjects: map[string]localProject{}}
	if err := s.ensureWorkspace(); err != nil {
		log.Printf("workspace: %v", err)
	}
	return s
}

// Handler returns the application's HTTP handler.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /api/health", s.handleHealth)
	s.registerFileRoutes(mux)
	s.registerProjectRoutes(mux)

	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "unknown API endpoint", nil)
	})

	// Static single-page application.
	static, _ := fs.Sub(distFS, "dist")
	fileServer := http.FileServer(http.FS(static))
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			writeError(w, http.StatusMethodNotAllowed, "method not allowed", nil)
			return
		}
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p == "" {
			p = "index.html"
		}
		if f, err := static.Open(p); err == nil {
			_ = f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}
		// SPA fallback.
		r.URL.Path = "/"
		fileServer.ServeHTTP(w, r)
	})

	return s.withMiddleware(mux)
}

func (s *Server) withMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		defer func() {
			if rec := recover(); rec != nil {
				log.Printf("panic: %v", rec)
				writeError(w, http.StatusInternalServerError, "internal server error", nil)
			}
			if !strings.HasPrefix(r.URL.Path, "/api/health") {
				log.Printf("%s %s (%s)", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":    "ok",
		"service":   "skyview",
		"workspace": s.workspace,
		"time":      time.Now().UTC().Format(time.RFC3339),
	})
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("encode response: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, msg string, diags any) {
	body := map[string]any{"error": msg}
	if diags != nil {
		body["diagnostics"] = diags
	}
	writeJSON(w, status, body)
}

func revisionOf(content string) string {
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:8])
}
