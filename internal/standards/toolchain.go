// Package standards integrates the official SysML pilot without treating the rendering parser as a language validator.
package standards

import (
	"archive/zip"
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

//go:embed release.json
var releaseJSON []byte

//go:embed SkyViewValidator.java
var bridge []byte

//go:embed licenses/*.html
var licenseFiles embed.FS

type Release struct {
	Version           string            `json:"release"`
	Status            string            `json:"specificationStatus"`
	Published         string            `json:"publishedAt"`
	KernelEntry       string            `json:"kernelEntry"`
	Specification     string            `json:"specification"`
	Contents          string            `json:"releaseContents"`
	ReleaseCommit     string            `json:"releaseCommit"`
	PilotCommit       string            `json:"pilotCommit"`
	KernelURL         string            `json:"kernelURL"`
	KernelSHA256      string            `json:"kernelSHA256"`
	LibraryURL        string            `json:"libraryURL"`
	LibrarySHA256     string            `json:"librarySHA256"`
	JarSHA256         string            `json:"jarSHA256"`
	LibraryTreeSHA256 string            `json:"libraryTreeSHA256"`
	Corpus            map[string]string `json:"corpus"`
}

func Pinned() Release {
	var r Release
	if err := json.Unmarshal(releaseJSON, &r); err != nil {
		panic(err)
	}
	return r
}
func DefaultHome() string {
	if v := os.Getenv("SKYVIEW_SYSML_HOME"); v != "" {
		return v
	}
	// A local release bundle keeps the checked toolchain beside the executable.
	if exe, err := os.Executable(); err == nil {
		home := filepath.Join(filepath.Dir(exe), "sysml-"+Pinned().Version)
		if _, err := os.Stat(filepath.Join(home, "release.json")); err == nil {
			return home
		}
	}
	base, err := os.UserCacheDir()
	if err != nil {
		base = "bin"
	}
	return filepath.Join(base, "skyview", "sysml", Pinned().Version)
}
func fileHash(path string) (string, error) {
	f, e := os.Open(path)
	if e != nil {
		return "", e
	}
	defer f.Close()
	h := sha256.New()
	_, e = io.CopyBuffer(h, struct{ io.Reader }{f}, make([]byte, 1<<20))
	return fmt.Sprintf("%x", h.Sum(nil)), e
}
func checkHash(path, want string) error {
	got, e := fileHash(path)
	if e != nil {
		return e
	}
	if got != want {
		return fmt.Errorf("checksum mismatch: %s", path)
	}
	return nil
}
func treeHash(root string) (string, error) {
	var paths []string
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if d.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink in toolchain: %s", path)
		}
		if !d.IsDir() {
			rel, err := filepath.Rel(root, path)
			if err != nil {
				return err
			}
			paths = append(paths, filepath.ToSlash(rel))
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	sort.Strings(paths)
	h := sha256.New()
	for _, rel := range paths {
		fmt.Fprint(h, rel, "\x00")
		f, e := os.Open(filepath.Join(root, filepath.FromSlash(rel)))
		if e != nil {
			return "", e
		}
		_, e = io.CopyBuffer(h, struct{ io.Reader }{f}, make([]byte, 1<<20))
		f.Close()
		if e != nil {
			return "", e
		}
		h.Write([]byte{0})
	}
	return fmt.Sprintf("%x", h.Sum(nil)), nil
}
func Verify(home string) error {
	r := Pinned()
	data, e := os.ReadFile(filepath.Join(home, "release.json"))
	if e != nil {
		return fmt.Errorf("official release manifest unavailable: %w (run skyview standards-setup)", e)
	}
	var installed Release
	if json.Unmarshal(data, &installed) != nil || releaseIdentity(installed) != releaseIdentity(r) {
		return fmt.Errorf("installed SysML release does not match this SkyView build; run standards-setup for the compiled release")
	}
	if e := checkHash(filepath.Join(home, "kernel.jar"), r.JarSHA256); e != nil {
		return fmt.Errorf("official validator unavailable: %w (run skyview standards-setup)", e)
	}
	got, e := treeHash(filepath.Join(home, "sysml.library"))
	if e != nil {
		return e
	}
	if got != r.LibraryTreeSHA256 {
		return fmt.Errorf("official library checksum mismatch; reinstall the pinned toolchain")
	}
	return nil
}

// Install downloads immutable, checksum-pinned archives. It never runs upstream setup scripts.
func Install(ctx context.Context, home, cache string, log io.Writer) error {
	if _, e := os.Stat(home); e == nil {
		if err := Verify(home); err != nil {
			return err
		}
		return installNotices(home)
	} else if !os.IsNotExist(e) {
		return e
	}
	cache = filepath.Join(cache, Pinned().Version)
	if e := os.MkdirAll(cache, 0755); e != nil {
		return e
	}
	r := Pinned()
	for _, a := range []struct{ name, url, hash string }{{"kernel.zip", r.KernelURL, r.KernelSHA256}, {"release.zip", r.LibraryURL, r.LibrarySHA256}} {
		path := filepath.Join(cache, a.name)
		if _, e := os.Stat(path); os.IsNotExist(e) {
			fmt.Fprintf(log, "Downloading official %s %s\n", r.Version, a.name)
			if e := download(ctx, a.url, path); e != nil {
				return e
			}
		}
		if e := checkHash(path, a.hash); e != nil {
			return e
		}
	}
	if e := os.MkdirAll(filepath.Dir(home), 0755); e != nil {
		return e
	}
	stage, e := os.MkdirTemp(filepath.Dir(home), ".sysml-install-")
	if e != nil {
		return e
	}
	defer os.RemoveAll(stage)
	// Preserve the upstream JAR unchanged, including its bundled license/notice metadata.
	if e = extractSelected(filepath.Join(cache, "kernel.zip"), stage, func(n string) string {
		if strings.HasSuffix(n, "/"+r.KernelEntry) {
			return "kernel.jar"
		}
		return ""
	}); e != nil {
		return e
	}
	prefix := "SysML-v2-Release-" + r.ReleaseCommit + "/"
	if e = extractSelected(filepath.Join(cache, "release.zip"), stage, func(n string) string {
		n = strings.TrimPrefix(n, prefix)
		if strings.HasPrefix(n, "sysml.library/") {
			return n
		}
		if _, ok := r.Corpus[n]; ok {
			return "corpus/" + n
		}
		if n == "LICENSE" {
			return "licenses/SysML-Release-EPL-2.0.txt"
		}
		return ""
	}); e != nil {
		return e
	}
	if e = os.WriteFile(filepath.Join(stage, "release.json"), releaseJSON, 0644); e != nil {
		return e
	}
	if e = Verify(stage); e != nil {
		return e
	}
	notice := "Official unmodified SysML pilot and release libraries: Eclipse Public License 2.0.\nSource: https://github.com/Systems-Modeling/SysML-v2-Pilot-Implementation/tree/" + r.PilotCommit + "\nLibrary source: https://github.com/Systems-Modeling/SysML-v2-Release/tree/" + r.ReleaseCommit + "\nKeep the JAR's bundled third-party licenses and the release license with redistribution.\nBundled PlantUML 1.2022.7 uses EPL-1.0; source: https://github.com/plantuml/plantuml/tree/v1.2022.7\nSkyView's original adapter remains MIT licensed.\n"
	if e = os.WriteFile(filepath.Join(stage, "licenses", "NOTICE.txt"), []byte(notice), 0644); e != nil {
		return e
	}
	if e = installNotices(stage); e != nil {
		return e
	}
	if e = os.Rename(stage, home); e != nil {
		return e
	}
	fmt.Fprintf(log, "Verified official SysML release %s in %s\n", r.Version, home)
	return nil
}
func download(ctx context.Context, url, dest string) error {
	req, e := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if e != nil {
		return e
	}
	client := &http.Client{Timeout: 10 * time.Minute}
	res, e := client.Do(req)
	if e != nil {
		return e
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("download: HTTP %d", res.StatusCode)
	}
	f, e := os.CreateTemp(filepath.Dir(dest), ".download-")
	if e != nil {
		return e
	}
	name := f.Name()
	defer os.Remove(name)
	n, e := io.Copy(f, io.LimitReader(res.Body, 256<<20))
	closeErr := f.Close()
	if e != nil {
		return e
	}
	if closeErr != nil {
		return closeErr
	}
	if n >= 256<<20 {
		return fmt.Errorf("release archive exceeds limit")
	}
	return os.Rename(name, dest)
}
func extractSelected(archive, root string, selectPath func(string) string) error {
	data, e := os.ReadFile(archive)
	if e != nil {
		return e
	}
	z, e := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if e != nil {
		return e
	}
	var total int64
	for _, f := range z.File {
		if f.FileInfo().IsDir() {
			continue
		}
		rel := selectPath(f.Name)
		if rel == "" {
			continue
		}
		rel = filepath.FromSlash(rel)
		if !filepath.IsLocal(rel) || strings.Contains(rel, "\\") && filepath.Separator != '\\' || f.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("unsafe release archive entry")
		}
		path := filepath.Join(root, rel)
		if e = os.MkdirAll(filepath.Dir(path), 0755); e != nil {
			return e
		}
		src, e := f.Open()
		if e != nil {
			return e
		}
		dst, e := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
		if e != nil {
			src.Close()
			return e
		}
		buffered := bufio.NewWriterSize(dst, 1<<20)
		n, err := io.Copy(buffered, io.LimitReader(src, (256<<20)+1))
		if flushErr := buffered.Flush(); err == nil {
			err = flushErr
		}
		src.Close()
		ce := dst.Close()
		total += n
		if err != nil {
			return err
		}
		if ce != nil {
			return ce
		}
		if total > 512<<20 || n > 256<<20 {
			return fmt.Errorf("extracted release exceeds limit")
		}
	}
	return nil
}

func ReadCorpus(home, name string) (string, error) {
	hash, ok := Pinned().Corpus[name]
	if !ok {
		return "", fmt.Errorf("unlisted official corpus file")
	}
	path := filepath.Join(home, "corpus", filepath.FromSlash(name))
	if e := checkHash(path, hash); e != nil {
		return "", e
	}
	b, e := os.ReadFile(path)
	return string(b), e
}

func installNotices(home string) error {
	entries, err := licenseFiles.ReadDir("licenses")
	if err != nil {
		return err
	}
	if err = os.MkdirAll(filepath.Join(home, "licenses"), 0755); err != nil {
		return err
	}
	for _, entry := range entries {
		data, err := licenseFiles.ReadFile("licenses/" + entry.Name())
		if err != nil {
			return err
		}
		target := filepath.Join(home, "licenses", entry.Name())
		if existing, readErr := os.ReadFile(target); readErr == nil && bytes.Equal(existing, data) {
			continue
		}
		if err = os.WriteFile(target, data, 0644); err != nil {
			return err
		}
	}
	return nil
}
