package standards

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

type upstreamRelease struct {
	Tag        string `json:"tag_name"`
	Body       string `json:"body"`
	Draft      bool   `json:"draft"`
	Prerelease bool   `json:"prerelease"`
	Published  string `json:"published_at"`
	Assets     []struct {
		Name   string `json:"name"`
		URL    string `json:"browser_download_url"`
		Digest string `json:"digest"`
	} `json:"assets"`
}

// A GitHub release's prerelease flag does not describe the OMG specification status.
// Require an affirmative declaration of the included specification documents.
func specificationProfile(body string) (string, string, error) {
	start := strings.Index(strings.ToLower(body), "this release includes")
	if start < 0 {
		return "", "", fmt.Errorf("release has no specification declaration")
	}
	section := body[start:]
	if end := strings.Index(section, "\n\n"); end >= 0 {
		section = section[:end]
	}
	if !strings.Contains(strings.ToLower(section), "specification documents") {
		return "", "", fmt.Errorf("release has no specification declaration")
	}
	versions := regexp.MustCompile(`(?i)KerML\s+(\d+\.\d+),?\s+SysML\s+(\d+\.\d+)`).FindStringSubmatch(section)
	if versions == nil {
		return "", "", fmt.Errorf("release has no recognizable language versions")
	}
	status := ""
	lower := strings.ToLower(section)
	if strings.Contains(lower, "includes the beta") || strings.Contains(lower, "includes beta") {
		status = "preview"
	} else if strings.Contains(lower, "includes formal versions") && !strings.Contains(lower, "these resolutions must be considered preliminary") {
		status = "published"
	}
	if status == "" {
		return "", "", fmt.Errorf("release specification status is ambiguous")
	}
	return "SysML " + versions[2] + " / KerML " + versions[1], status, nil
}

func selectRelease(releases []upstreamRelease, channel string) (upstreamRelease, string, string, error) {
	if channel != "published" && channel != "latest" {
		return upstreamRelease{}, "", "", fmt.Errorf("channel must be published, latest or locked")
	}
	sort.SliceStable(releases, func(i, j int) bool { return releases[i].Published > releases[j].Published })
	for _, r := range releases {
		if r.Draft || (r.Prerelease && channel == "published") || !regexp.MustCompile(`^\d{4}-\d{2}(\.\d+)?$`).MatchString(r.Tag) {
			continue
		}
		spec, status, err := specificationProfile(r.Body)
		if err != nil {
			if channel == "latest" {
				return r, "", "", err
			}
			continue
		}
		if channel == "latest" || status == "published" {
			return r, spec, status, nil
		}
	}
	return upstreamRelease{}, "", "", fmt.Errorf("no explicitly published OMG release found")
}

func githubJSON(ctx context.Context, path string, target any) error {
	req, err := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/repos/Systems-Modeling/"+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "SkyView-standards-build")
	client := &http.Client{Timeout: 60 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("upstream release discovery: HTTP %d", res.StatusCode)
	}
	return json.NewDecoder(io.LimitReader(res.Body, 8<<20)).Decode(target)
}

// RefreshLock fetches build dependencies into an ignored cache. Only the small identity
// lock is written to the source tree. Download failures never silently select another release.
func RefreshLock(ctx context.Context, channel, lock, cache string, out io.Writer) error {
	if channel == "locked" {
		data, err := os.ReadFile(lock)
		if err != nil {
			return err
		}
		var r Release
		if err = json.Unmarshal(data, &r); err != nil {
			return err
		}
		if r.Version == "" || r.JarSHA256 == "" {
			return fmt.Errorf("invalid release lock")
		}
		fmt.Fprintf(out, "Using locked %s, official release %s (%s)\n", r.Specification, r.Version, r.Status)
		return nil
	}
	var releases []upstreamRelease
	if err := githubJSON(ctx, "SysML-v2-Release/releases?per_page=100", &releases); err != nil {
		return err
	}
	selected, spec, status, err := selectRelease(releases, channel)
	if err != nil {
		return err
	}
	if old, e := os.ReadFile(lock); e == nil {
		var r Release
		if json.Unmarshal(old, &r) == nil && r.Version == selected.Tag && r.Status == status && r.Specification == spec && r.KernelEntry != "" {
			fmt.Fprintf(out, "Current %s: official release %s (%s); lock unchanged\n", spec, r.Version, status)
			return nil
		}
	}
	fmt.Fprintf(out, "Selected %s, official release %s (%s)\n", spec, selected.Tag, status)
	var pilot upstreamRelease
	if err = githubJSON(ctx, "SysML-v2-Pilot-Implementation/releases/tags/"+selected.Tag, &pilot); err != nil {
		return err
	}
	r := Release{Version: selected.Tag, Specification: spec, Status: status, Published: selected.Published, Corpus: map[string]string{}}
	r.Contents = "Published OMG language baseline; official implementation has known validation gaps."
	if status == "preview" {
		r.Contents = "Preliminary language revisions; not a published OMG conformance baseline."
	}
	for _, repo := range []string{"SysML-v2-Release", "SysML-v2-Pilot-Implementation"} {
		var c struct {
			SHA string `json:"sha"`
		}
		if err = githubJSON(ctx, repo+"/commits/"+selected.Tag, &c); err != nil {
			return err
		}
		if !regexp.MustCompile(`^[0-9a-f]{40}$`).MatchString(c.SHA) {
			return fmt.Errorf("invalid upstream commit")
		}
		if repo == "SysML-v2-Release" {
			r.ReleaseCommit = c.SHA
		} else {
			r.PilotCommit = c.SHA
		}
	}
	for _, a := range pilot.Assets {
		if strings.HasPrefix(a.Name, "jupyter-sysml-kernel-") && strings.HasSuffix(a.Name, ".zip") {
			if !strings.HasPrefix(a.URL, "https://github.com/Systems-Modeling/SysML-v2-Pilot-Implementation/releases/download/") {
				return fmt.Errorf("unexpected artifact host")
			}
			r.KernelURL = a.URL
			r.KernelSHA256 = strings.TrimPrefix(a.Digest, "sha256:")
			r.KernelEntry = strings.TrimSuffix(a.Name, ".zip") + "-all.jar"
		}
	}
	if !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(r.KernelSHA256) {
		return fmt.Errorf("official checker has no publisher SHA-256")
	}
	r.LibraryURL = "https://codeload.github.com/Systems-Modeling/SysML-v2-Release/zip/" + r.ReleaseCommit
	cache = filepath.Join(cache, r.Version)
	if err = os.MkdirAll(cache, 0755); err != nil {
		return err
	}
	for _, a := range []struct{ name, url string }{{"kernel.zip", r.KernelURL}, {"release.zip", r.LibraryURL}} {
		dest := filepath.Join(cache, a.name)
		if _, e := os.Stat(dest); os.IsNotExist(e) {
			if err = download(ctx, a.url, dest); err != nil {
				return err
			}
		}
	}
	if err = checkHash(filepath.Join(cache, "kernel.zip"), r.KernelSHA256); err != nil {
		return err
	}
	r.LibrarySHA256, err = fileHash(filepath.Join(cache, "release.zip"))
	if err != nil {
		return err
	}
	stage, err := os.MkdirTemp(cache, "inspect-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	if err = extractSelected(filepath.Join(cache, "kernel.zip"), stage, func(n string) string {
		if strings.HasSuffix(n, "/"+r.KernelEntry) {
			return "kernel.jar"
		}
		return ""
	}); err != nil {
		return err
	}
	r.JarSHA256, err = fileHash(filepath.Join(stage, "kernel.jar"))
	if err != nil {
		return err
	}
	prefix := "SysML-v2-Release-" + r.ReleaseCommit + "/"
	if err = extractSelected(filepath.Join(cache, "release.zip"), stage, func(n string) string {
		n = strings.TrimPrefix(n, prefix)
		if strings.HasPrefix(n, "sysml.library/") {
			return n
		}
		return ""
	}); err != nil {
		return err
	}
	r.LibraryTreeSHA256, err = treeHash(filepath.Join(stage, "sysml.library"))
	if err != nil {
		return err
	}
	z, err := zip.OpenReader(filepath.Join(cache, "release.zip"))
	if err != nil {
		return err
	}
	defer z.Close()
	for _, f := range z.File {
		n := strings.TrimPrefix(f.Name, prefix)
		if strings.HasPrefix(n, "sysml/src/examples/") && strings.HasSuffix(n, ".sysml") {
			reader, e := f.Open()
			if e != nil {
				return e
			}
			h := sha256.New()
			_, e = io.Copy(h, reader)
			reader.Close()
			if e != nil {
				return e
			}
			r.Corpus[n] = fmt.Sprintf("%x", h.Sum(nil))
		}
	}
	if len(r.Corpus) == 0 {
		return fmt.Errorf("official release has no examples")
	}
	data, err := json.MarshalIndent(r, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	temp, err := os.CreateTemp(filepath.Dir(lock), ".release-lock-")
	if err != nil {
		return err
	}
	name := temp.Name()
	defer os.Remove(name)
	if _, err = temp.Write(data); err != nil {
		temp.Close()
		return err
	}
	if err = temp.Close(); err != nil {
		return err
	}
	if err = os.Rename(name, lock); err != nil {
		return err
	}
	fmt.Fprintln(out, "Updated release lock. Rebuild SkyView to use it; downloaded dependencies remain in the build cache.")
	return nil
}
