package standards

import (
	"context"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestBuildChannelUsesSpecificationStatus(t *testing.T) {
	releases := []upstreamRelease{
		{Tag: "2026-09.1", Published: "2026-10-30", Body: "This release includes the Beta 2 versions of the KerML 1.1, SysML 2.1 and Systems Modeling API 1.1 specification documents."},
		{Tag: "2026-04", Published: "2026-05-14", Body: "This release includes formal versions of the KerML 1.0, SysML 2.0 and Systems Modeling API 1.0 specification documents. Task forces will include corresponding beta versions in future releases."},
	}
	for _, c := range []struct{ channel, want, status string }{{"published", "2026-04", "published"}, {"latest", "2026-09.1", "preview"}} {
		got, _, status, err := selectRelease(releases, c.channel)
		if err != nil || got.Tag != c.want || status != c.status {
			t.Fatalf("%s selected %+v %s %v", c.channel, got, status, err)
		}
	}
	if _, _, _, err := selectRelease(releases, "arbitrary"); err == nil {
		t.Fatal("unknown channel accepted")
	}
	if _, _, err := specificationProfile("Version 2.0 released. No language declaration."); err == nil {
		t.Fatal("ambiguous release classified as published")
	}
	if _, _, _, err := selectRelease([]upstreamRelease{releases[0]}, "published"); err == nil {
		t.Fatal("preview selected for published build")
	}
}

func TestInstalledVersionMustMatchCompiledLock(t *testing.T) {
	home := t.TempDir()
	wrong := Pinned()
	wrong.Version = "another-release"
	b, _ := json.Marshal(wrong)
	os.WriteFile(filepath.Join(home, "release.json"), b, 0644)
	err := Verify(home)
	if err == nil {
		t.Fatal("accepted mismatched local release")
	}
	runner := NewRunner(home, "java")
	if info := runner.Identity(); info.State != "unavailable" || info.Release.Version != Pinned().Version {
		t.Fatalf("false version identity: %+v", info)
	}
}

func TestLockedBuildNeverNeedsNetworkOrRewritesLock(t *testing.T) {
	path := filepath.Join(t.TempDir(), "release.json")
	os.WriteFile(path, releaseJSON, 0644)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := RefreshLock(ctx, "locked", path, t.TempDir(), io.Discard); err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(path)
	if string(got) != string(releaseJSON) {
		t.Fatal("locked build changed the version lock")
	}
	if err := RefreshLock(ctx, "published", path, t.TempDir(), io.Discard); err == nil {
		t.Fatal("cancelled update silently fell back")
	}
	after, _ := os.ReadFile(path)
	if string(after) != string(got) {
		t.Fatal("failed discovery damaged the lock")
	}
}

func TestLatestIncludesIdentifiableGitHubPrerelease(t *testing.T) {
	releases := []upstreamRelease{
		{Tag: "2026-10", Prerelease: true, Published: "2026-11-20", Body: "This release includes the Beta 3 versions of the KerML 1.1, SysML 2.1 and Systems Modeling API 1.1 specification documents."},
		{Tag: "2026-04", Published: "2026-05-14", Body: "This release includes formal versions of the KerML 1.0, SysML 2.0 and Systems Modeling API 1.0 specification documents."},
	}
	got, _, status, err := selectRelease(releases, "latest")
	if err != nil || got.Tag != "2026-10" || status != "preview" {
		t.Fatalf("latest skipped identifiable preview: %+v %s %v", got, status, err)
	}
	got, _, status, err = selectRelease(releases, "published")
	if err != nil || got.Tag != "2026-04" || status != "published" {
		t.Fatalf("published admitted preview: %+v %s %v", got, status, err)
	}
}
