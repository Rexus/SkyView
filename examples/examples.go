// Package examples embeds immutable first-party project templates in every build.
package examples

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"

	"github.com/Rexus/SkyView/internal/projects"
)

//go:embed */skyview.project.json */README.md */models
var content embed.FS

func List() []projects.Info {
	result := []projects.Info{}
	for _, id := range []string{"inspection-drone", "inverted-pendulum", "starter"} {
		raw, _ := content.ReadFile(id + "/" + projects.ManifestName)
		var manifest projects.Manifest
		if err := json.Unmarshal(raw, &manifest); err != nil {
			panic(err)
		}
		result = append(result, projects.Info{ID: id, Manifest: manifest})
	}
	return result
}
func Files(id string) (map[string][]byte, error) {
	found := false
	for _, example := range List() {
		if example.ID == id {
			found = true
		}
	}
	if !found {
		return nil, fmt.Errorf("example not found")
	}
	root, err := fs.Sub(content, id)
	if err != nil {
		return nil, err
	}
	result := map[string][]byte{}
	err = fs.WalkDir(root, ".", func(name string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			return nil
		}
		data, err := fs.ReadFile(root, name)
		if err != nil {
			return err
		}
		result[name] = data
		return nil
	})
	return result, err
}

func Starter() []byte {
	data, err := content.ReadFile("starter/models/example-model.sysml")
	if err != nil {
		panic(err)
	}
	return data
}
