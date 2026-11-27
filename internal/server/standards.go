package server

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/Rexus/SkyView/internal/standards"
)

func (s *Server) nativeSnapshot(name string, draft *string) (map[string]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	// Resolve the active source through the same project boundary as all editing routes.
	if _, err := s.readFile(name); err != nil {
		return nil, err
	}
	var files map[string]string
	if s.recursive {
		var err error
		files, err = standards.Collect(s.workspace)
		if err != nil {
			return nil, err
		}
	} else {
		files = map[string]string{}
		entries, err := os.ReadDir(s.workspace)
		if err != nil {
			return nil, err
		}
		for _, entry := range entries {
			if entry.IsDir() || (!strings.HasSuffix(entry.Name(), ".sysml") && !strings.HasSuffix(entry.Name(), ".kerml")) {
				continue
			}
			if entry.Type()&os.ModeSymlink != 0 {
				return nil, fmt.Errorf("source symlinks are not supported")
			}
			info, err := entry.Info()
			if err != nil {
				return nil, err
			}
			if !info.Mode().IsRegular() || info.Size() > 16<<20 {
				return nil, fmt.Errorf("model exceeds size limit")
			}
			data, err := os.ReadFile(filepath.Join(s.workspace, entry.Name()))
			if err != nil {
				return nil, err
			}
			files[entry.Name()] = string(data)
			if err = standards.ValidateSnapshot(files); err != nil {
				return nil, err
			}
		}
	}
	if draft != nil {
		files[name] = *draft
	}
	return files, standards.ValidateSnapshot(files)
}
func (s *Server) handleValidateNative(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Content *string `json:"content"`
	}
	if r.ContentLength != 0 {
		if err := decodeJSON(r, &req); err != nil {
			writeError(w, 400, err.Error(), nil)
			return
		}
	}
	files, err := s.nativeSnapshot(r.PathValue("name"), req.Content)
	if err != nil {
		writeError(w, 400, err.Error(), nil)
		return
	}
	if s.native == nil {
		writeError(w, 503, "Native checker is not configured", nil)
		return
	}
	result, _ := s.native.Check(r.Context(), files)
	// Availability is part of this typed result, never an empty successful lint response.
	writeJSON(w, 200, result)
}

func (s *Server) handleStandardsIdentity(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if s.native == nil {
		info := standards.BuildIdentity()
		info.State = "unavailable"
		info.Error = "Native checker is not configured"
		writeJSON(w, 200, info)
		return
	}
	writeJSON(w, 200, s.native.Identity())
}
