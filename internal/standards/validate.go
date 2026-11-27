package standards

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

const MaxSourceBytes = 32 << 20
const MaxFiles = 1000

var ErrBusy = errors.New("native checker is busy; retry shortly")

type Diagnostic struct {
	File     string `json:"file"`
	Origin   string `json:"origin,omitempty"`
	Severity string `json:"severity"`
	Message  string `json:"message"`
	Code     string `json:"code,omitempty"`
	Line     int    `json:"line"`
	Column   int    `json:"column"`
	Source   string `json:"source"`
	Range    *struct {
		Start int `json:"start"`
		End   int `json:"end"`
	} `json:"range,omitempty"`
}
type Result struct {
	Status             string       `json:"status"`
	Identity           Identity     `json:"identity"`
	Release            Release      `json:"release"`
	SourceSHA256       string       `json:"sourceSHA256"`
	FilesChecked       int          `json:"filesChecked"`
	Diagnostics        []Diagnostic `json:"diagnostics"`
	LibraryDiagnostics []Diagnostic `json:"libraryDiagnostics"`
	Error              string       `json:"error,omitempty"`
}
type Runner struct {
	Home, Java    string
	StrictLibrary bool
	Timeout       time.Duration
	active        chan struct{}
}

func NewRunner(home, java string) *Runner {
	if java == "" {
		java = "java"
	}
	return &Runner{Home: home, Java: java, Timeout: 120 * time.Second, active: make(chan struct{}, 1)}
}
func ValidateSnapshot(files map[string]string) error {
	if len(files) == 0 || len(files) > MaxFiles {
		return fmt.Errorf("project must contain 1–%d source files", MaxFiles)
	}
	total := 0
	for name, source := range files {
		if !filepath.IsLocal(filepath.FromSlash(name)) || strings.Contains(name, "\\") || strings.Contains(name, ":") || strings.HasPrefix(name, "/") || strings.Contains(name, "//") {
			return fmt.Errorf("invalid project-relative model path: %q", name)
		}
		for _, part := range strings.Split(name, "/") {
			if part == "." || part == ".." || part == "" {
				return fmt.Errorf("invalid project-relative model path: %q", name)
			}
		}
		if !strings.HasSuffix(name, ".sysml") && !strings.HasSuffix(name, ".kerml") {
			return fmt.Errorf("unsupported source extension: %s", name)
		}
		if !utf8.ValidString(source) {
			return fmt.Errorf("source is not UTF-8: %s", name)
		}
		total += len(source)
		if len(source) > 16<<20 || total > MaxSourceBytes {
			return fmt.Errorf("source snapshot exceeds size limit")
		}
	}
	return nil
}
func SnapshotHash(files map[string]string) string {
	names := make([]string, 0, len(files))
	for n := range files {
		names = append(names, n)
	}
	sort.Strings(names)
	h := sha256.New()
	for _, n := range names {
		fmt.Fprint(h, n, "\x00", files[n], "\x00")
	}
	return fmt.Sprintf("%x", h.Sum(nil))
}
func (r *Runner) Check(ctx context.Context, files map[string]string) (result Result, err error) {
	result = Result{Status: "unavailable", Identity: BuildIdentity(), Release: Pinned(), SourceSHA256: SnapshotHash(files), Diagnostics: []Diagnostic{}, LibraryDiagnostics: []Diagnostic{}}
	defer func() {
		if err != nil {
			result.Error = err.Error()
		}
	}()
	if err = ValidateSnapshot(files); err != nil {
		return
	}
	select {
	case r.active <- struct{}{}:
		defer func() { <-r.active }()
	default:
		err = ErrBusy
		return
	}
	if err = Verify(r.Home); err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, r.Timeout)
	defer cancel()
	temp, e := os.MkdirTemp("", "skyview-sysml-")
	if e != nil {
		err = e
		return
	}
	defer os.RemoveAll(temp)
	source := filepath.Join(temp, "SkyViewValidator.java")
	if err = os.WriteFile(source, bridge, 0600); err != nil {
		return
	}
	home, e := filepath.Abs(r.Home)
	if e != nil {
		err = e
		return
	}
	input, _ := json.Marshal(map[string]any{"files": files})
	cmd := exec.CommandContext(ctx, r.Java, "-Xmx1g", "-Dfile.encoding=UTF-8", "-cp", filepath.Join(home, "kernel.jar"), source, filepath.Join(home, "sysml.library"))
	cmd.Dir = temp
	cmd.Stdin = bytes.NewReader(input)
	stdout := &limitedBuffer{limit: 8 << 20}
	stderr := &limitedBuffer{limit: 32 << 10}
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	if e = cmd.Run(); e != nil {
		if ctx.Err() != nil {
			err = fmt.Errorf("native validation cancelled or timed out: %w", ctx.Err())
		} else {
			err = fmt.Errorf("native checker failed (requires JDK 21+): %w: %s", e, stderr.String())
		}
		return
	}
	var response struct {
		Diagnostics  []Diagnostic `json:"diagnostics"`
		FilesChecked int          `json:"filesChecked"`
	}
	if e = json.Unmarshal(stdout.Bytes(), &response); e != nil || response.FilesChecked != len(files) || response.Diagnostics == nil {
		err = fmt.Errorf("incomplete native checker response")
		return
	}
	result.Identity.State = "verified"
	result.Diagnostics = []Diagnostic{}
	result.FilesChecked = response.FilesChecked
	result.Status = "passed"
	for _, d := range response.Diagnostics {
		if _, ok := files[d.File]; !ok {
			err = fmt.Errorf("native checker returned an unknown source file")
			result.Status = "unavailable"
			return
		}
		if d.Severity != "error" && d.Severity != "warning" && d.Severity != "info" {
			err = fmt.Errorf("native checker returned an unknown severity")
			result.Status = "unavailable"
			return
		}
		if d.Range != nil && (d.Range.Start < 0 || d.Range.End < d.Range.Start || d.Range.End > len(files[d.File])) {
			err = fmt.Errorf("native checker returned an invalid source range")
			result.Status = "unavailable"
			return
		}
		if d.Origin == "standard-library" {
			result.LibraryDiagnostics = append(result.LibraryDiagnostics, d)
			if r.StrictLibrary && d.Severity == "error" {
				result.Status = "failed"
			}
		} else {
			result.Diagnostics = append(result.Diagnostics, d)
			if d.Severity == "error" {
				result.Status = "failed"
			}
		}
	}
	return
}

type limitedBuffer struct {
	buffer bytes.Buffer
	limit  int
}

func (b *limitedBuffer) Bytes() []byte  { return b.buffer.Bytes() }
func (b *limitedBuffer) String() string { return b.buffer.String() }
func (b *limitedBuffer) Write(p []byte) (int, error) {
	n := len(p)
	remaining := b.limit - b.buffer.Len()
	if remaining > 0 {
		if len(p) > remaining {
			p = p[:remaining]
		}
		b.buffer.Write(p)
	}
	return n, nil
}

// Collect reads one project only, rejecting source symlinks. No file is modified.
func Collect(root string) (map[string]string, error) {
	files := map[string]string{}
	count := 0
	total := 0
	err := filepath.WalkDir(root, func(path string, d fs.DirEntry, e error) error {
		if e != nil {
			return e
		}
		rel, e := filepath.Rel(root, path)
		if e != nil {
			return e
		}
		if d.IsDir() {
			if rel != "." && (strings.HasPrefix(d.Name(), ".") || d.Name() == "node_modules" || d.Name() == "bin") {
				return filepath.SkipDir
			}
			return nil
		}
		if d.Type()&os.ModeSymlink != 0 {
			return fmt.Errorf("symlink is not a model input: %s", rel)
		}
		if !strings.HasSuffix(path, ".sysml") && !strings.HasSuffix(path, ".kerml") {
			return nil
		}
		info, e := d.Info()
		if e != nil {
			return e
		}
		if !info.Mode().IsRegular() || info.Size() > 16<<20 || total+int(info.Size()) > MaxSourceBytes || count >= MaxFiles {
			return fmt.Errorf("project source exceeds limits: %s", rel)
		}
		b, e := os.ReadFile(path)
		if e != nil {
			return e
		}
		files[filepath.ToSlash(rel)] = string(b)
		total += len(b)
		count++
		return nil
	})
	if err != nil {
		return nil, err
	}
	return files, ValidateSnapshot(files)
}
