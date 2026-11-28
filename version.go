// Package skyview owns the application version embedded in every SkyView binary.
package skyview

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"io"
	"os"
	"regexp"
	"runtime"
	"runtime/debug"
	"strings"
	"sync"
)

const Repository = "https://github.com/Rexus/SkyView"
const Copyright = "© 2026 Carl Maier and Viktor Ingre"

//go:embed .version
var versionFile string

// The packaging workflow sets these with linker flags. Runtime environment
// variables are deliberately outside the build identity.
var stampedRevision string
var stampedSourceState string
var stampedSourceTime string
var stampedReleaseTag string

var versionPattern = regexp.MustCompile("^v(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$")
var revisionPattern = regexp.MustCompile("^([0-9a-f]{40}|[0-9a-f]{64})$")
var digits = regexp.MustCompile("^[0-9]+$")

type Build struct {
	Version          string `json:"version"`
	Tag              string `json:"tag,omitempty"`
	Official         bool   `json:"official"`
	Channel          string `json:"channel"`
	Revision         string `json:"revision,omitempty"`
	SourceState      string `json:"sourceState"`
	SourceTime       string `json:"sourceTime,omitempty"`
	ExecutableSHA256 string `json:"executableSHA256,omitempty"`
	Platform         string `json:"platform"`
	GoVersion        string `json:"goVersion"`
	Repository       string `json:"repository"`
	License          string `json:"license"`
	Copyright        string `json:"copyright"`
}

// Current returns the same immutable identity to the CLI and HTTP interface.
var Current = sync.OnceValue(func() Build {
	buildInfo, _ := debug.ReadBuildInfo()
	settings := map[string]string{}
	if buildInfo != nil {
		for _, setting := range buildInfo.Settings {
			settings[setting.Key] = setting.Value
		}
	}
	build := identify(versionFile, settings, stampedRevision, stampedSourceState, stampedSourceTime, stampedReleaseTag)
	build.Platform = runtime.GOOS + "/" + runtime.GOARCH
	build.GoVersion = runtime.Version()
	build.ExecutableSHA256 = executableSHA256()
	return build
})

func identify(base string, vcs map[string]string, revision, state, sourceTime, tag string) Build {
	version := strings.TrimSpace(base)
	out := Build{Version: version, Channel: "stable", SourceState: "unknown",
		Repository: Repository, Copyright: Copyright, License: "MIT"}
	if !validVersion(version) {
		out.Version, out.Channel = "unknown", "unknown"
	}
	releaseStamp := revisionPattern.MatchString(revision) && state == "clean"
	if revision == "" {
		revision, sourceTime = vcs["vcs.revision"], vcs["vcs.time"]
		switch vcs["vcs.modified"] {
		case "true":
			state = "modified"
		case "false":
			state = "clean"
		}
	}
	if revisionPattern.MatchString(revision) {
		out.Revision, out.SourceTime = revision, sourceTime
		if state == "clean" || state == "modified" {
			out.SourceState = state
		}
	}
	if _, prerelease, ok := strings.Cut(version, "-"); ok && out.Version != "unknown" {
		out.Channel = "prerelease"
		switch first := strings.SplitN(prerelease, ".", 2)[0]; first {
		case "alpha", "beta", "rc":
			out.Channel = first
		}
	}
	if releaseStamp && tag == out.Version && out.Version != "unknown" {
		out.Tag, out.Official = tag, true
	}
	return out
}

func validVersion(version string) bool {
	if len(version) > 120 || !versionPattern.MatchString(version) {
		return false
	}
	_, pre, _ := strings.Cut(version, "-")
	for _, part := range strings.Split(pre, ".") {
		if len(part) > 1 && part[0] == '0' && digits.MatchString(part) {
			return false
		}
	}
	return true
}

func executableSHA256() string {
	name, err := os.Executable()
	if err != nil {
		return ""
	}
	if runtime.GOOS == "linux" {
		name = "/proc/self/exe"
	}
	file, err := os.Open(name)
	if err != nil {
		return ""
	}
	defer file.Close()
	h := sha256.New()
	if _, err := io.Copy(h, file); err != nil {
		return ""
	}
	return hex.EncodeToString(h.Sum(nil))
}
