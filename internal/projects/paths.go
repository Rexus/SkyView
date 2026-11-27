// Package projects owns portable project directories and snapshot imports.
package projects

import (
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Relative accepts portable slash-separated paths, never a machine-local path.
func Relative(name string) bool {
	if !utf8.ValidString(name) || name == "" || len(name) > 1024 || strings.ContainsAny(name, "\\:\x00") || path.Clean(name) != name || strings.HasPrefix(name, "/") {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		if part == "." || part == ".." || part == "" || strings.TrimRight(part, " .") != part {
			return false
		}
		stem := strings.ToUpper(strings.SplitN(part, ".", 2)[0])
		if stem == "CON" || stem == "PRN" || stem == "AUX" || stem == "NUL" ||
			(len(stem) == 4 && (strings.HasPrefix(stem, "COM") || strings.HasPrefix(stem, "LPT")) && stem[3] >= '1' && stem[3] <= '9') {
			return false
		}
		for _, r := range part {
			if unicode.IsControl(r) || strings.ContainsRune(`<>"|?*`, r) {
				return false
			}
		}
	}
	return true
}

// Resolve rejects symlinks, including existing parent components. Local roots
// are explicitly configured by a trusted operator; uploads cannot create links.
func Resolve(root, name string) (string, error) {
	if !Relative(name) {
		return "", fmt.Errorf("invalid project-relative path %q", name)
	}
	current := root
	for _, part := range strings.Split(name, "/") {
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return "", err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return "", fmt.Errorf("symbolic links are not supported in project paths")
		}
	}
	return current, nil
}

func ModelPath(name string) bool {
	if !Relative(name) || !strings.HasSuffix(name, ".sysml") {
		return false
	}
	for _, part := range strings.Split(name, "/") {
		if strings.HasPrefix(part, ".") {
			return false
		}
	}
	return true
}

func Included(name string) bool {
	for _, part := range strings.Split(name, "/") {
		if strings.EqualFold(part, ".git") {
			return false
		}
	}
	return !strings.HasPrefix(strings.ToLower(name), ".skyview/") || strings.HasPrefix(name, ".skyview/layouts/")
}

// Record every parent spelling as well as the leaf: A/x and a/y must not
// silently merge when the same project is opened on Windows.
func recordPath(spellings map[string]string, name string) error {
	parts := strings.Split(name, "/")
	for i := range parts {
		prefix := strings.Join(parts[:i+1], "/")
		key := strings.ToLower(prefix)
		if previous, ok := spellings[key]; ok && previous != prefix {
			return fmt.Errorf("case-colliding project paths %q and %q", previous, prefix)
		}
		spellings[key] = prefix
	}
	return nil
}
