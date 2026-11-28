package projects

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"
)

const ManifestName = "skyview.project.json"
const MaxFile = 16 << 20
const MaxArchive = 64 << 20
const MaxEntries = 4000

var errRemoved = errors.New("project removed")

type Origin struct {
	Kind       string `json:"kind"`
	Repository string `json:"repository,omitempty"`
	Ref        string `json:"ref,omitempty"`
	Commit     string `json:"commit,omitempty"`
	Directory  string `json:"directory,omitempty"`
	Example    string `json:"example,omitempty"`
}
type Manifest struct {
	Version     int    `json:"version"`
	Name        string `json:"name"`
	Origin      Origin `json:"origin"`
	WorkspaceID string `json:"workspaceId,omitempty"`
	Removed     bool   `json:"removed,omitempty"`
}
type Info struct {
	ID string `json:"id"`
	Manifest
}

func ValidID(id string) bool {
	if id == "" || len(id) > 90 || strings.HasPrefix(id, ".") {
		return false
	}
	for _, r := range id {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_') {
			return false
		}
	}
	return true
}
func Read(root, id string) (Info, error) {
	if !ValidID(id) {
		return Info{}, fmt.Errorf("invalid project ID")
	}
	file, err := Resolve(root, id+"/"+ManifestName)
	if err != nil {
		return Info{}, err
	}
	data, err := os.ReadFile(file)
	if err != nil {
		return Info{}, err
	}
	if len(data) > 16<<10 {
		return Info{}, fmt.Errorf("project manifest too large")
	}
	var m Manifest
	if json.Unmarshal(data, &m) != nil || m.Version != 1 || strings.TrimSpace(m.Name) == "" {
		return Info{}, fmt.Errorf("invalid project manifest")
	}
	if m.Removed {
		return Info{}, errRemoved
	}
	return Info{ID: id, Manifest: m}, nil
}
func List(root string) ([]Info, error) {
	entries, err := os.ReadDir(root)
	if os.IsNotExist(err) {
		return []Info{}, nil
	}
	if err != nil {
		return nil, err
	}
	result := []Info{}
	for _, entry := range entries {
		if !entry.IsDir() || !ValidID(entry.Name()) {
			continue
		}
		info, err := Read(root, entry.Name())
		if errors.Is(err, errRemoved) {
			continue
		}
		if err != nil {
			return nil, err
		}
		result = append(result, info)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].Name < result[j].Name })
	return result, nil
}

// Create publishes one complete directory. Caller owns catalog serialization.
func Create(root string, manifest Manifest, files map[string][]byte) (Info, error) {
	manifest.Name = strings.TrimSpace(manifest.Name)
	if manifest.Name == "" || len(manifest.Name) > 120 {
		return Info{}, fmt.Errorf("project name must be 1–120 characters")
	}
	manifest.Version = 1
	manifest.Removed = false
	if err := os.MkdirAll(root, 0755); err != nil {
		return Info{}, err
	}
	stage, err := os.MkdirTemp(root, ".import-")
	if err != nil {
		return Info{}, err
	}
	defer os.RemoveAll(stage)
	modelCount, total := 0, 0
	names := map[string]bool{}
	spellings := map[string]string{}
	if len(files) > MaxEntries {
		return Info{}, fmt.Errorf("too many project files")
	}
	for name, data := range files {
		if !Relative(name) || !Included(name) {
			return Info{}, fmt.Errorf("unsupported project path %q", name)
		}
		if strings.EqualFold(name, ManifestName) {
			if name != ManifestName {
				return Info{}, fmt.Errorf("manifest filename must be %s", ManifestName)
			}
			continue
		}
		if err := recordPath(spellings, name); err != nil {
			return Info{}, err
		}
		if names[strings.ToLower(name)] {
			return Info{}, fmt.Errorf("case-colliding project paths")
		}
		names[strings.ToLower(name)] = true
		if len(data) > MaxFile {
			return Info{}, fmt.Errorf("project file exceeds 16 MiB")
		}
		total += len(data)
		if total > MaxArchive {
			return Info{}, fmt.Errorf("project exceeds 64 MiB")
		}
		if ModelPath(name) {
			if !utf8.Valid(data) {
				return Info{}, fmt.Errorf("SysML source must be UTF-8")
			}
			modelCount++
		}
		file := filepath.Join(stage, filepath.FromSlash(name))
		if err = os.MkdirAll(filepath.Dir(file), 0755); err != nil {
			return Info{}, err
		}
		if err = os.WriteFile(file, data, 0644); err != nil {
			return Info{}, err
		}
	}
	if modelCount == 0 {
		return Info{}, fmt.Errorf("selected directory contains no .sysml models")
	}
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return Info{}, err
	}
	if err = os.WriteFile(filepath.Join(stage, ManifestName), append(data, '\n'), 0644); err != nil {
		return Info{}, err
	}
	suffix := make([]byte, 8)
	if _, err = rand.Read(suffix); err != nil {
		return Info{}, err
	}
	id := "project-" + hex.EncodeToString(suffix)
	if err = os.Rename(stage, filepath.Join(root, id)); err != nil {
		return Info{}, err
	}
	return Info{ID: id, Manifest: manifest}, nil
}
