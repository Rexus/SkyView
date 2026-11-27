package server

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	maxFileSize    = 16 << 20 // 16 MiB
	maxLayoutSize  = 4 << 20  // 4 MiB
	maxHistoryKeep = 80
)

// ensureWorkspace creates the workspace and seeds the sample model if it is
// empty.
func (s *Server) ensureWorkspace() error {
	if err := os.MkdirAll(s.workspace, 0o755); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(s.workspace, ".skyview", "history"), 0o755); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(s.workspace, ".skyview", "layouts"), 0o755); err != nil {
		return err
	}
	entries, err := os.ReadDir(s.workspace)
	if err != nil {
		return err
	}
	hasModel := false
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sysml") {
			hasModel = true
			break
		}
	}
	if !hasModel && len(sampleModel) > 0 {
		name := "example-model.sysml"
		if _, err := os.Stat(filepath.Join(s.workspace, name)); errors.Is(err, os.ErrNotExist) {
			if err := os.WriteFile(filepath.Join(s.workspace, name), sampleModel, 0o644); err != nil {
				return err
			}
		}
	}
	return nil
}

// FileInfo is a workspace file summary.
type FileInfo struct {
	Name     string    `json:"name"`
	Size     int64     `json:"size"`
	Modified time.Time `json:"modified"`
}

func (s *Server) listFiles() ([]FileInfo, error) {
	entries, err := os.ReadDir(s.workspace)
	if err != nil {
		return nil, err
	}
	files := make([]FileInfo, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sysml") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		files = append(files, FileInfo{Name: e.Name(), Size: info.Size(), Modified: info.ModTime()})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Name < files[j].Name })
	return files, nil
}

func validFileName(name string) bool {
	if name == "" || len(name) > 120 {
		return false
	}
	if name != filepath.Base(name) || strings.ContainsAny(name, `/\`) {
		return false
	}
	if !strings.HasSuffix(name, ".sysml") || strings.HasPrefix(name, ".") {
		return false
	}
	for _, r := range name {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '.' || r == '-' || r == '_' {
			continue
		}
		return false
	}
	return true
}

func (s *Server) filePath(name string) (string, error) {
	if !validFileName(name) {
		return "", fmt.Errorf("invalid file name %q (use letters, digits, dots, dashes and underscores, ending in .sysml)", name)
	}
	return filepath.Join(s.workspace, name), nil
}

func (s *Server) readFile(name string) (string, error) {
	path, err := s.filePath(name)
	if err != nil {
		return "", err
	}
	b, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", fmt.Errorf("file %q not found", name)
		}
		return "", err
	}
	if len(b) > maxFileSize {
		return "", fmt.Errorf("file is too large")
	}
	return string(b), nil
}

// writeFile atomically replaces a file, keeping a revision snapshot of the
// previous content.
func (s *Server) writeFile(name, content string) error {
	if len(content) > maxFileSize {
		return fmt.Errorf("file is too large (max %d MiB)", maxFileSize>>20)
	}
	path, err := s.filePath(name)
	if err != nil {
		return err
	}
	if old, err := os.ReadFile(path); err == nil {
		_ = s.snapshot(name, string(old))
	}
	return atomicWrite(path, []byte(content))
}

func atomicWrite(path string, data []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, ".skyview-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp)
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func (s *Server) historyDir(name string) string {
	return filepath.Join(s.workspace, ".skyview", "history", strings.TrimSuffix(name, ".sysml"))
}

func (s *Server) snapshot(name, content string) error {
	dir := s.historyDir(name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	ts := time.Now().UTC().Format("20060102T150405.000000000")
	rev := ts + "-" + randomSuffix(3) + ".sysml"
	if err := os.WriteFile(filepath.Join(dir, rev), []byte(content), 0o644); err != nil {
		return err
	}
	return pruneHistory(dir, maxHistoryKeep)
}

func pruneHistory(dir string, keep int) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	var names []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sysml") {
			names = append(names, e.Name())
		}
	}
	if len(names) <= keep {
		return nil
	}
	sort.Strings(names)
	for _, n := range names[:len(names)-keep] {
		_ = os.Remove(filepath.Join(dir, n))
	}
	return nil
}

func randomSuffix(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// Revision is a saved snapshot.
type Revision struct {
	ID      string    `json:"id"`
	Size    int64     `json:"size"`
	SavedAt time.Time `json:"savedAt"`
}

func (s *Server) listHistory(name string) ([]Revision, error) {
	dir := s.historyDir(name)
	entries, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []Revision{}, nil
		}
		return nil, err
	}
	revs := make([]Revision, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".sysml") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		revs = append(revs, Revision{ID: e.Name(), Size: info.Size(), SavedAt: info.ModTime()})
	}
	sort.Slice(revs, func(i, j int) bool { return revs[i].SavedAt.After(revs[j].SavedAt) })
	return revs, nil
}

func (s *Server) readRevision(name, id string) (string, error) {
	if id == "" || id != filepath.Base(id) || strings.ContainsAny(id, `/\`) || !strings.HasSuffix(id, ".sysml") {
		return "", fmt.Errorf("invalid revision")
	}
	b, err := os.ReadFile(filepath.Join(s.historyDir(name), id))
	if err != nil {
		return "", fmt.Errorf("revision not found")
	}
	return string(b), nil
}

func (s *Server) layoutPath(name string) string {
	return filepath.Join(s.workspace, ".skyview", "layouts", strings.TrimSuffix(name, ".sysml")+".layout.json")
}

func (s *Server) readLayout(name string) ([]byte, error) {
	b, err := os.ReadFile(s.layoutPath(name))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []byte("{}"), nil
		}
		return nil, err
	}
	if len(b) > maxLayoutSize {
		return nil, fmt.Errorf("layout is too large")
	}
	return b, nil
}

func (s *Server) writeLayout(name string, body []byte) error {
	if len(body) > maxLayoutSize {
		return fmt.Errorf("layout is too large")
	}
	return atomicWrite(s.layoutPath(name), body)
}

func (s *Server) deleteFile(name string) error {
	path, err := s.filePath(name)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil {
		return err
	}
	_ = os.Remove(s.layoutPath(name))
	_ = os.RemoveAll(s.historyDir(name))
	return nil
}

func readLimited(r io.Reader, limit int64) ([]byte, error) {
	lr := io.LimitReader(r, limit+1)
	b, err := io.ReadAll(lr)
	if err != nil {
		return nil, err
	}
	if int64(len(b)) > limit {
		return nil, fmt.Errorf("request body is too large")
	}
	return b, nil
}
