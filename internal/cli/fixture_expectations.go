package cli

import "github.com/Rexus/SkyView/internal/standards"

// These are test expectations for unchanged, checksum-pinned upstream examples,
// never exceptions in project validation. The published geometry examples declare
// composite items inside attributes, contrary to SysML 2.0 8.3.7.3.
type fixtureFinding struct {
	File string `json:"file"`
	Code string `json:"code"`
	Line int    `json:"line"`
}

func officialFindings(release standards.Release, group string) []fixtureFinding {
	if release.Version != "2026-04" || release.ReleaseCommit != "9baca5908ca28b53da085de69336fde48420ea8f" || group != "sysml/src/examples/Geometry Examples" {
		return nil
	}
	return []fixtureFinding{
		{"CarWithShapeAndCSG.sysml", "validateAttributeUsageFeatures", 84},
		{"SimpleQuadcopter.sysml", "validateAttributeUsageFeatures", 50},
		{"SimpleQuadcopter.sysml", "validateAttributeUsageFeatures", 156},
	}
}

func matchesFindings(actual []standards.Diagnostic, expected []fixtureFinding) bool {
	if len(expected) == 0 {
		return true
	}
	if len(actual) != len(expected) {
		return false
	}
	remaining := make(map[fixtureFinding]int, len(expected))
	for _, finding := range expected {
		remaining[finding]++
	}
	for _, finding := range actual {
		key := fixtureFinding{finding.File, finding.Code, finding.Line}
		if finding.Severity != "error" || remaining[key] == 0 {
			return false
		}
		remaining[key]--
	}
	return true
}
