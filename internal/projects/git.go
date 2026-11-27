package projects

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

type GitRequest struct {
	Name       string `json:"name"`
	Repository string `json:"repository"`
	Ref        string `json:"ref"`
	Directory  string `json:"directory"`
}

var repoComponent = regexp.MustCompile(`^[A-Za-z0-9_.-]+$`)
var commitID = regexp.MustCompile(`^([a-fA-F0-9]{40}|[a-fA-F0-9]{64})$`)
var archiveHosts = map[string]bool{"api.github.com": true, "codeload.github.com": true, "gitlab.com": true}

func SnapshotClient() *http.Client {
	return &http.Client{Timeout: 45 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) > 5 || req.URL.Scheme != "https" || !archiveHosts[req.URL.Host] || req.URL.User != nil {
			return fmt.Errorf("repository archive redirected to an unsupported destination")
		}
		return nil
	}}
}

// FetchSnapshot uses read-only public APIs, pins the ref before archive retrieval,
// and never invokes Git, credentials, hooks, scripts, submodules or a shell.
func FetchSnapshot(ctx context.Context, client *http.Client, request GitRequest) (map[string][]byte, Origin, error) {
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	u, err := url.Parse(request.Repository)
	if err != nil || u.Scheme != "https" || u.User != nil || u.RawQuery != "" || u.Fragment != "" ||
		(u.Host != "github.com" && u.Host != "gitlab.com") {
		return nil, Origin{}, fmt.Errorf("use a public https://github.com/owner/repository or https://gitlab.com/group/repository URL")
	}
	repo := strings.TrimSuffix(strings.Trim(u.Path, "/"), ".git")
	parts := strings.Split(repo, "/")
	if len(parts) < 2 || (u.Host == "github.com" && len(parts) != 2) {
		return nil, Origin{}, fmt.Errorf("use the repository URL, without a branch or file path")
	}
	for _, part := range parts {
		if !repoComponent.MatchString(part) || part == "." || part == ".." {
			return nil, Origin{}, fmt.Errorf("invalid repository path")
		}
	}
	ref := request.Ref
	if ref == "" {
		ref = "HEAD"
	}
	if len(ref) > 256 || strings.ContainsAny(ref, "\x00\r\n") {
		return nil, Origin{}, fmt.Errorf("invalid Git ref")
	}
	directory := request.Directory
	if directory == "" {
		directory = "."
	}
	if directory != "." && !Relative(directory) {
		return nil, Origin{}, fmt.Errorf("invalid repository directory")
	}
	origin := Origin{Kind: "git", Repository: "https://" + u.Host + "/" + repo, Ref: ref, Directory: directory}
	base := "https://api.github.com/repos/" + repo
	metadata := base + "/commits/" + url.PathEscape(ref)
	if u.Host == "gitlab.com" {
		base = "https://gitlab.com/api/v4/projects/" + url.PathEscape(repo) + "/repository"
		metadata = base + "/commits/" + url.PathEscape(ref)
	}
	raw, err := download(ctx, client, metadata, 1<<20)
	if err != nil {
		return nil, origin, err
	}
	var commit struct {
		SHA string `json:"sha"`
		ID  string `json:"id"`
	}
	if json.Unmarshal(raw, &commit) != nil {
		return nil, origin, fmt.Errorf("repository returned invalid revision metadata")
	}
	origin.Commit = commit.SHA
	if u.Host == "gitlab.com" {
		origin.Commit = commit.ID
	}
	if !commitID.MatchString(origin.Commit) {
		return nil, origin, fmt.Errorf("repository did not return a full commit ID")
	}
	archiveURL := base + "/zipball/" + origin.Commit
	if u.Host == "gitlab.com" {
		archiveURL = base + "/archive.zip?sha=" + origin.Commit
	}
	archive, err := download(ctx, client, archiveURL, MaxArchive)
	if err != nil {
		return nil, origin, err
	}
	files, err := Unpack(archive, directory)
	return files, origin, err
}

func download(ctx context.Context, client *http.Client, endpoint string, limit int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "SkyView-project-import")
	req.Header.Set("Accept", "application/json")
	response, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("repository request failed: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return nil, fmt.Errorf("repository returned HTTP %d; check the public repository and ref, or upload its ZIP archive", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, fmt.Errorf("repository response exceeds the import limit")
	}
	return data, nil
}
