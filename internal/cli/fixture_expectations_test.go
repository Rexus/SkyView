package cli

import (
	"github.com/Rexus/SkyView/internal/standards"
	"io"
	"strings"
	"testing"
)

func TestOfficialFixtureFindingsAreExactAndReleaseScoped(t *testing.T) {
	release := standards.Release{Version: "2026-04", ReleaseCommit: "9baca5908ca28b53da085de69336fde48420ea8f"}
	group := "sysml/src/examples/Geometry Examples"
	expected := officialFindings(release, group)
	if len(expected) != 3 {
		t.Fatal("expected the three published example defects")
	}
	var actual []standards.Diagnostic
	for _, f := range expected {
		actual = append(actual, standards.Diagnostic{File: f.File, Code: f.Code, Line: f.Line, Severity: "error"})
	}
	if !matchesFindings(actual, expected) {
		t.Fatal("known findings rejected")
	}
	if matchesFindings(actual[:2], expected) {
		t.Fatal("missing finding accepted")
	}
	actual[0].Code = "someNewFailure"
	if matchesFindings(actual, expected) {
		t.Fatal("different failure accepted")
	}
	actual[0].Code = expected[0].Code
	actual = append(actual, actual[0])
	if matchesFindings(actual, expected) {
		t.Fatal("additional failure accepted")
	}
	release.ReleaseCommit = "changed"
	if len(officialFindings(release, group)) != 0 {
		t.Fatal("expectations leaked to another release")
	}
	if len(officialFindings(standards.Pinned(), "examples/inspection-drone")) != 0 {
		t.Fatal("upstream expectations leaked into project validation")
	}
}

func TestNativeCheckTimeoutMustBePositive(t *testing.T) {
	for _, value := range []string{"0s", "-1s"} {
		err := runStandards([]string{"lint", "-repository", "-timeout", value}, io.Discard, io.Discard)
		if err == nil || !strings.Contains(err.Error(), "timeout must be positive") {
			t.Fatalf("invalid timeout accepted: %s %v", value, err)
		}
	}
}
