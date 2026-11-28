package skyview

import (
	"strings"
	"testing"
)

func TestBuildIdentityDistinguishesVersionFromPublication(t *testing.T) {
	rev := strings.Repeat("a", 40)
	for _, tc := range []struct {
		name, base, revision, state, tag, wantVersion, channel, wantState string
		official                                                          bool
	}{
		{"source archive", "v0.1.0\n", "", "", "", "v0.1.0", "stable", "unknown", false},
		{"ordinary clean checkout", "v0.1.0", rev, "clean", "", "v0.1.0", "stable", "clean", false},
		{"official", "v0.1.0", rev, "clean", "v0.1.0", "v0.1.0", "stable", "clean", true},
		{"beta", "v0.2.0-beta.1", rev, "clean", "v0.2.0-beta.1", "v0.2.0-beta.1", "beta", "clean", true},
		{"release candidate checkout", "v0.2.0-rc.1", rev, "modified", "", "v0.2.0-rc.1", "rc", "modified", false},
		{"modified checkout", "v0.1.0", rev, "modified", "v0.1.0", "v0.1.0", "stable", "modified", false},
		{"mismatched tag", "v0.1.0", rev, "clean", "v0.1.1", "v0.1.0", "stable", "clean", false},
		{"invalid revision", "v0.1.0", "unknown", "clean", "v0.1.0", "v0.1.0", "stable", "unknown", false},
		{"invalid version", "v0.2.0-beta.01", rev, "clean", "v0.2.0-beta.01", "unknown", "unknown", "clean", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			build := identify(tc.base, nil, tc.revision, tc.state, "", tc.tag)
			if build.Version != tc.wantVersion || build.Official != tc.official ||
				build.Channel != tc.channel || build.SourceState != tc.wantState {
				t.Fatalf("unexpected build identity: %+v", build)
			}
		})
	}
	if identify("v0.1.0", map[string]string{"vcs.revision": rev, "vcs.modified": "false"}, "", "", "", "v0.1.0").Official {
		t.Fatal("a tag string without a release stamp must remain unofficial")
	}
	build := identify("v0.1.0", map[string]string{
		"vcs.revision": rev, "vcs.time": "2026-01-01T00:00:00Z", "vcs.modified": "true",
	}, "", "", "", "")
	if build.Revision != rev || build.SourceState != "modified" || build.SourceTime == "" {
		t.Fatalf("Go VCS fallback lost metadata: %+v", build)
	}
}
