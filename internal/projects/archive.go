package projects

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"unicode/utf8"
)

// Unpack reads regular files only and retains selected relative paths. One
// enclosing archive folder is stripped, matching GitHub/GitLab ZIP archives.
func Unpack(data []byte, directory string) (map[string][]byte, error) {
	if len(data) > MaxArchive {
		return nil, fmt.Errorf("ZIP exceeds 64 MiB")
	}
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, fmt.Errorf("invalid ZIP archive: %w", err)
	}
	if len(archive.File) > MaxEntries {
		return nil, fmt.Errorf("ZIP contains too many entries")
	}
	directory = strings.Trim(directory, " ")
	if directory == "" {
		directory = "."
	}
	if directory != "." && !Relative(directory) {
		return nil, fmt.Errorf("invalid selected directory")
	}
	prefix := ""
	common := true
	seen := map[string]bool{}
	spellings := map[string]string{}
	for _, f := range archive.File {
		name := strings.TrimSuffix(f.Name, "/")
		if !Relative(name) || !utf8.ValidString(name) {
			return nil, fmt.Errorf("unsafe ZIP path %q", f.Name)
		}
		if f.Mode()&os.ModeSymlink != 0 || (!f.FileInfo().IsDir() && !f.Mode().IsRegular()) {
			return nil, fmt.Errorf("ZIP links and special files are not supported")
		}
		if err := recordPath(spellings, name); err != nil {
			return nil, err
		}
		if f.FileInfo().IsDir() {
			continue
		}
		key := strings.ToLower(name)
		if seen[key] {
			return nil, fmt.Errorf("duplicate or case-colliding ZIP path %q", name)
		}
		seen[key] = true
		first, _, hasSlash := strings.Cut(name, "/")
		if !hasSlash {
			common = false
		}
		if prefix == "" {
			prefix = first
		} else if prefix != first {
			common = false
		}
	}
	// A root-level manifest identifies our own ZIP format, so never remove a
	// meaningful model subdirectory from a project export containing one folder.
	if seen[ManifestName] {
		common = false
	}
	files := map[string][]byte{}
	total := 0
	for _, f := range archive.File {
		if f.FileInfo().IsDir() {
			continue
		}
		name := f.Name
		if common {
			name = strings.TrimPrefix(name, prefix+"/")
		}
		if directory != "." {
			if !strings.HasPrefix(name, directory+"/") {
				continue
			}
			name = strings.TrimPrefix(name, directory+"/")
		}
		if !Included(name) {
			continue
		}
		if f.UncompressedSize64 > MaxFile {
			return nil, fmt.Errorf("ZIP member exceeds 16 MiB")
		}
		stream, err := f.Open()
		if err != nil {
			return nil, err
		}
		content, readErr := io.ReadAll(io.LimitReader(stream, MaxFile+1))
		closeErr := stream.Close()
		if readErr != nil {
			return nil, readErr
		}
		if closeErr != nil {
			return nil, closeErr
		}
		if len(content) > MaxFile {
			return nil, fmt.Errorf("ZIP member exceeds 16 MiB")
		}
		total += len(content)
		if total > MaxArchive {
			return nil, fmt.Errorf("expanded project exceeds 64 MiB")
		}
		if strings.HasSuffix(name, ".sysml") && !utf8.Valid(content) {
			return nil, fmt.Errorf("SysML source must be UTF-8")
		}
		files[name] = content
	}
	if len(files) == 0 {
		return nil, fmt.Errorf("selected directory is missing or empty")
	}
	return files, nil
}

func Export(root string, info Info, recursive bool) ([]byte, error) {
	files := map[string][]byte{}
	total := 0
	err := filepath.WalkDir(root, func(full string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if full == root {
			return nil
		}
		rel, err := filepath.Rel(root, full)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		if entry.IsDir() {
			if entry.Name() == ".git" || (rel == ".skyview/history") ||
				(strings.HasPrefix(rel, ".skyview/") && rel != ".skyview/layouts" && !strings.HasPrefix(rel, ".skyview/layouts/")) ||
				(!recursive && rel != ".skyview" && rel != ".skyview/layouts" && !strings.HasPrefix(rel, ".skyview/layouts/")) {
				return filepath.SkipDir
			}
			return nil
		}
		if !Included(rel) {
			return nil
		}
		if !entry.Type().IsRegular() {
			return fmt.Errorf("project export does not include links or special files: %s", rel)
		}
		file, err := Resolve(root, rel)
		if err != nil {
			return err
		}
		input, err := os.Open(file)
		if err != nil {
			return err
		}
		data, readErr := io.ReadAll(io.LimitReader(input, MaxFile+1))
		input.Close()
		if readErr != nil {
			return readErr
		}
		if len(data) > MaxFile {
			return fmt.Errorf("file exceeds export size limit")
		}
		total += len(data)
		if total > MaxArchive || len(files) >= MaxEntries {
			return fmt.Errorf("project exceeds export limits")
		}
		files[rel] = data
		return nil
	})
	if err != nil {
		return nil, err
	}
	// Workspace membership belongs to this server, not the portable project.
	manifest := info.Manifest
	manifest.WorkspaceID = ""
	files[ManifestName], err = json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return nil, err
	}
	return Pack(files)
}

func Pack(files map[string][]byte) ([]byte, error) {
	var buffer bytes.Buffer
	archive := zip.NewWriter(&buffer)
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		if !Relative(name) {
			return nil, fmt.Errorf("invalid archive path")
		}
		file, err := archive.Create(path.Clean(name))
		if err != nil {
			return nil, err
		}
		if _, err = file.Write(files[name]); err != nil {
			return nil, err
		}
	}
	if err := archive.Close(); err != nil {
		return nil, err
	}
	if buffer.Len() > MaxArchive {
		return nil, fmt.Errorf("compressed archive exceeds 64 MiB")
	}
	return buffer.Bytes(), nil
}
