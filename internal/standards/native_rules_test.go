package standards

import (
	"context"
	"os"
	"testing"
)

func TestNativePublishedRuleControls(t *testing.T) {
	if os.Getenv("SKYVIEW_NATIVE_TESTS") != "1" {
		t.Skip("requires installed pinned native checker")
	}
	cases := []struct{ name, source, code string }{
		{"valid attributes and control flow", `package Good {
    attribute def Record { ref part payload; attribute count : ScalarValues::Integer; }
    action def Flow { action a; action b; fork f; join j; first a then f; first f then b; first b then j; }
  }`, ""},
		{"attribute definition composition", `package Bad { attribute def Record { part payload; } }`, "validateAttributeDefinitionFeatures"},
		{"attribute usage composition", `package Bad { attribute record { part payload; } }`, "validateAttributeUsageFeatures"},
		{"decision incoming", `package Bad { action def Flow { action a; action b; decide d; first a then d; first b then d; } }`, "validateDecisionNodeIncomingSuccessions"},
		{"fork incoming", `package Bad { action def Flow { action a; action b; fork f; first a then f; first b then f; } }`, "validateForkNodeIncomingSuccessions"},
		{"join outgoing", `package Bad { action def Flow { action a; action b; join j; first j then a; first j then b; } }`, "validateJoinNodeOutgoingSuccessions"},
		{"merge outgoing", `package Bad { action def Flow { action a; action b; merge m; first m then a; first m then b; } }`, "validateMergeNodeOutgoingSuccessions"},
	}
	runner := NewRunner(DefaultHome(), "java")
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := runner.Check(context.Background(), map[string]string{"Rules.sysml": c.source})
			if err != nil {
				t.Fatal(err)
			}
			if c.code == "" {
				if got.Status != "passed" {
					t.Fatalf("native-valid control rejected: %+v", got.Diagnostics)
				}
				return
			}
			for _, d := range got.Diagnostics {
				if d.Code == c.code && d.Severity == "error" {
					if d.Range == nil || d.Range.End <= d.Range.Start {
						t.Fatal("missing authored location")
					}
					return
				}
			}
			t.Fatalf("missing specified rule %s, got %+v", c.code, got.Diagnostics)
		})
	}
}

func TestNativeDecisionTargetMultiplicity(t *testing.T) {
	if os.Getenv("SKYVIEW_NATIVE_TESTS") != "1" {
		t.Skip("requires installed pinned native checker")
	}
	files := map[string]string{
		"DecisionGood.sysml": `package DecisionGood {
    attribute one : ScalarValues::Integer = 1;
    action def Flow {
      decide d;
      action a;
      action b;
      action c;
      succession first d then [0..1] a;
      succession first d then b;
      succession first d then [0..DecisionGood::one] c;
    }
  }`,
		"DecisionUpperBound.sysml": `package DecisionUpperBound { action def Flow { decide d; action a; succession first d then [2] a; } }`,
		"DecisionLowerBound.sysml": `package DecisionLowerBound { action def Flow { decide d; action a; succession first d then [1] a; } }`,
	}
	runner := NewRunner(DefaultHome(), "java")
	got, err := runner.Check(context.Background(), files)
	if err != nil || got.Status != "failed" || got.FilesChecked != len(files) {
		t.Fatalf("expected a native decision model with errors: %+v %v", got, err)
	}
	want := map[string]string{"DecisionUpperBound.sysml": "[2]", "DecisionLowerBound.sysml": "[1]"}
	for _, d := range got.Diagnostics {
		bound, ok := want[d.File]
		if !ok || d.Code != "validateDecisionNodeOutgoingSuccessions" || d.Severity != "error" || d.Range == nil {
			t.Fatalf("unexpected decision diagnostic: %+v", d)
		}
		if location := files[d.File][d.Range.Start:d.Range.End]; location != bound {
			t.Fatalf("diagnostic should highlight %s, got %q", bound, location)
		}
		delete(want, d.File)
	}
	if len(want) != 0 {
		t.Fatalf("missing decision diagnostics: %v", want)
	}
}

func TestNativeLibraryFindingsRemainVisibleAndStrict(t *testing.T) {
	if os.Getenv("SKYVIEW_NATIVE_TESTS") != "1" {
		t.Skip("requires installed pinned native checker")
	}
	if Pinned().Version != "2026-04" {
		t.Skip("this upstream defect is specific to the published baseline; review on upgrade")
	}
	files := map[string]string{"Duration.sysml": "package Duration { attribute elapsed : ISQ::DurationValue; }"}
	runner := NewRunner(DefaultHome(), "java")
	result, err := runner.Check(context.Background(), files)
	if err != nil || result.Status != "passed" || len(result.Diagnostics) != 0 || len(result.LibraryDiagnostics) == 0 {
		t.Fatalf("dependency finding lost or blamed on project: %+v %v", result, err)
	}
	for _, d := range result.LibraryDiagnostics {
		if d.Origin != "standard-library" || d.Code != "validateAttributeUsageFeatures" {
			t.Fatalf("unattributed library finding: %+v", d)
		}
	}
	runner.StrictLibrary = true
	strict, err := runner.Check(context.Background(), files)
	if err != nil || strict.Status != "failed" || strict.SourceSHA256 != result.SourceSHA256 || len(strict.LibraryDiagnostics) != len(result.LibraryDiagnostics) {
		t.Fatalf("strict library gate did not fail: %+v %v", strict, err)
	}
}
