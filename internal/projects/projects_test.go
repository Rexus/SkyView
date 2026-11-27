package projects

import (
	"archive/zip"
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func zipFixture(t *testing.T, names []string, mode os.FileMode, content []byte) []byte {
	t.Helper()
	var b bytes.Buffer
	w := zip.NewWriter(&b)
	for _, name := range names {
		h := &zip.FileHeader{Name: name, Method: zip.Deflate}
		h.SetMode(mode)
		f, err := w.CreateHeader(h)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.Write(content); err != nil {
			t.Fatal(err)
		}
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// PW-01: byte-preserving portable projects, including binary assets and nested layouts.
func TestPortableProjectRoundTrip(t *testing.T) {
	original := map[string][]byte{
		"models/Plant.sysml":                        []byte("// blåbär\r\npackage Plant { part cart; }\r\n"),
		"models/Plant.views.json":                   []byte("{\"version\":1,\"views\":[]}\n"),
		".skyview/layouts/models/Plant.layout.json": []byte(`{"nodes":{"cart":{"x":12,"y":34}}}`),
		"assets/binary.dat":                         {0, 128, 255, 10},
		"README.md":                                 []byte("Project instructions\n"),
	}
	root := t.TempDir()
	first, err := Create(root, Manifest{Name: "Cart"}, original)
	if err != nil {
		t.Fatal(err)
	}
	data, err := Export(filepath.Join(root, first.ID), first, true)
	if err != nil {
		t.Fatal(err)
	}
	unpacked, err := Unpack(data, ".")
	if err != nil {
		t.Fatal(err)
	}
	second, err := Create(root, Manifest{Name: "Cart copy"}, unpacked)
	if err != nil {
		t.Fatal(err)
	}
	if first.ID == second.ID {
		t.Fatal("import reused a project")
	}
	for name, want := range original {
		got, err := os.ReadFile(filepath.Join(root, second.ID, filepath.FromSlash(name)))
		if err != nil || !bytes.Equal(got, want) {
			t.Errorf("changed %s: %v", name, err)
		}
	}
}

// PW-02/PW-03: invalid imports leave no selectable or partially staged project.
func TestRejectedImportsPublishNothing(t *testing.T) {
	cases := []struct {
		name  string
		files map[string][]byte
	}{
		{"traversal", map[string][]byte{"../escape.sysml": []byte("package P;")}},
		{"empty", map[string][]byte{"README.md": []byte("no model")}},
		{"case", map[string][]byte{"P.sysml": {}, "p.sysml": {}}},
		{"manifest case", map[string][]byte{"P.sysml": {}, "SkyView.Project.json": {}}},
		{"file directory collision", map[string][]byte{"a": {}, "a/P.sysml": {}}},
		{"utf8", map[string][]byte{"P.sysml": {255}}},
		{"large", map[string][]byte{"P.sysml": make([]byte, MaxFile+1)}},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			if _, err := Create(root, Manifest{Name: "bad"}, test.files); err == nil {
				t.Fatal("accepted invalid project")
			}
			entries, err := os.ReadDir(root)
			if err != nil || len(entries) != 0 {
				t.Fatalf("partial import left behind: %v %v", entries, err)
			}
		})
	}
}
func TestArchiveBoundaries(t *testing.T) {
	for _, names := range [][]string{{"../P.sysml"}, {"/P.sysml"}, {`C:\P.sysml`}, {`x\P.sysml`}, {"a/../../P.sysml"}, {"CON.sysml"}, {"P.sysml", "p.sysml"}, {"a/P.sysml", "A/Q.sysml"}} {
		t.Run(strings.Join(names, ","), func(t *testing.T) {
			if _, err := Unpack(zipFixture(t, names, 0644, []byte("package P;")), "."); err == nil {
				t.Fatal("accepted unsafe archive")
			}
		})
	}
	if _, err := Unpack(zipFixture(t, []string{"P.sysml"}, os.ModeSymlink|0777, []byte("/etc/passwd")), "."); err == nil {
		t.Fatal("accepted symlink")
	}
	if _, err := Unpack(zipFixture(t, []string{"P.sysml"}, 0644, make([]byte, MaxFile+1)), "."); err == nil {
		t.Fatal("accepted inflated oversized entry")
	}
	if _, err := Unpack([]byte("not zip"), "."); err == nil {
		t.Fatal("accepted invalid zip")
	}
	archive, _ := Pack(map[string][]byte{"repo-sha/models/P.sysml": []byte("package P;"), "repo-sha/other/Q.sysml": {}, "repo-sha/models/.git/config": []byte("ignored")})
	selected, err := Unpack(archive, "models")
	if err != nil {
		t.Fatal(err)
	}
	if len(selected) != 1 || string(selected["P.sysml"]) != "package P;" {
		t.Fatalf("wrong directory selected: %v", selected)
	}
	if _, err := Unpack(archive, "../models"); err == nil {
		t.Fatal("accepted directory traversal")
	}
	if _, err := Unpack(archive, "missing"); err == nil {
		t.Fatal("accepted absent folder")
	}
}
func TestResolveRejectsSymlinks(t *testing.T) {
	root, outside := t.TempDir(), t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "outside")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, err := Resolve(root, "outside/P.sysml"); err == nil {
		t.Fatal("resolved outside project")
	}
}

type transportFunc func(*http.Request) (*http.Response, error)

func (f transportFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// PW-04: both provider adapters resolve a ref, then retrieve only that commit.
func TestRepositorySnapshot(t *testing.T) {
	sha := strings.Repeat("a", 40)
	archive, _ := Pack(map[string][]byte{"repo-sha/models/P.sysml": []byte("package P;"), "repo-sha/ignore.txt": {}})
	for _, host := range []string{"github.com", "gitlab.com"} {
		t.Run(host, func(t *testing.T) {
			calls := []string{}
			client := SnapshotClient()
			client.Transport = transportFunc(func(r *http.Request) (*http.Response, error) {
				if r.Method != "GET" || r.Header.Get("Authorization") != "" {
					t.Fatal("snapshot attempted a write or credentials")
				}
				calls = append(calls, r.URL.String())
				body := archive
				if len(calls) == 1 {
					body = []byte(fmt.Sprintf(`{"sha":%q,"id":%q}`, sha, sha))
					if !strings.HasSuffix(r.URL.EscapedPath(), "/commits/feature%2Fcart") {
						t.Fatalf("wrong ref: %s", r.URL)
					}
				} else if !strings.Contains(r.URL.String(), sha) {
					t.Fatal("archive not pinned")
				}
				return &http.Response{StatusCode: 200, Body: io.NopCloser(bytes.NewReader(body)), Header: make(http.Header)}, nil
			})
			files, origin, err := FetchSnapshot(context.Background(), client, GitRequest{Repository: "https://" + host + "/owner/repo.git", Ref: "feature/cart", Directory: "models"})
			if err != nil {
				t.Fatal(err)
			}
			if len(calls) != 2 || len(files) != 1 || origin.Commit != sha || origin.Directory != "models" || origin.Ref != "feature/cart" {
				t.Fatalf("bad snapshot: %v %v", calls, origin)
			}
		})
	}
	client := SnapshotClient()
	client.Transport = transportFunc(func(r *http.Request) (*http.Response, error) { t.Fatal("untrusted request sent"); return nil, nil })
	for _, url := range []string{"http://github.com/a/b", "https://localhost/a/b", "https://github.com:443/a/b", "https://token@github.com/a/b", "https://github.com/a/b/tree/main"} {
		if _, _, err := FetchSnapshot(context.Background(), client, GitRequest{Repository: url}); err == nil {
			t.Errorf("accepted %s", url)
		}
	}
	req, _ := http.NewRequest("GET", "https://localhost/archive.zip", nil)
	if err := client.CheckRedirect(req, nil); err == nil {
		t.Fatal("allowed untrusted redirect")
	}
}
