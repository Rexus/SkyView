package sysml

import (
	"os"
	"strings"
	"testing"
)

func loadDrone(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile("../../workspace/InspectionDrone.sysml")
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

func requireClean(t *testing.T, m *Model) {
	t.Helper()
	for _, d := range m.Diagnostics {
		t.Errorf("%s %d:%d %s", d.Severity, d.Line, d.Column, d.Message)
	}
	if len(m.Unsupported) != 0 {
		t.Errorf("unprojected source: %+v", m.Unsupported)
	}
}

func TestInspectionDroneProjection(t *testing.T) {
	src := loadDrone(t)
	m := Parse(src)
	requireClean(t, m)
	if m.Content != src {
		t.Fatal("parser changed source")
	}
	counts := map[string]int{}
	for _, e := range m.Elements {
		counts[e.Kind]++
		switch e.Kind {
		case "message", "succession", "connection":
			if e.SourceID == "" || e.TargetID == "" {
				t.Errorf("unresolved %s: %+v", e.Kind, e)
			}
		case "verify", "satisfy":
			if !strings.HasPrefix(e.RequirementID, "InspectionDrone::Requirements::") {
				t.Errorf("bad requirement: %+v", e)
			}
		case "constraint":
			if e.Expression == "" || e.ConstraintRole != "require" || len(e.Children) != 0 {
				t.Errorf("constraint not projected as expression: %+v", e)
			}
		}
	}
	for kind, want := range map[string]int{"requirement": 4, "constraint": 4, "message": 6, "event occurrence": 12, "verify": 4, "satisfy": 4, "connection": 5, "use case": 1, "succession": 31} {
		if counts[kind] != want {
			t.Errorf("%s count = %d, want %d", kind, counts[kind], want)
		}
	}
	message := m.Element("InspectionDrone::Mission::nominalSequence::capture")
	if message == nil || message.TypeID != "InspectionDrone::Components::CameraCommand" || message.SourceID != "InspectionDrone::Mission::nominalSequence::controller::captureSent" || message.TargetID != "InspectionDrone::Mission::nominalSequence::camera::captureReceived" {
		t.Fatalf("message lost payload or event endpoints: %+v", message)
	}
	station := m.Element("InspectionDrone::Mission::nominalSequence::station")
	if station.ValueID != "InspectionDrone::InspectionSystem::groundStation" {
		t.Errorf("participant binding = %q", station.ValueID)
	}
	if m.Element("InspectionDrone::Mission::nominalMission::uploadPlan") == nil {
		t.Fatal("ordered action missing")
	}
}

func TestDroneBrokenReferencesRemainVisible(t *testing.T) {
	src := loadDrone(t)
	for _, tc := range []struct{ name, from, to, diagnostic string }{
		{"message endpoint", "from station.planSent", "from station.missing", "Unresolved message endpoint"},
		{"payload", "of Components::MissionPlan", "of Components::Missing", "Unresolved type"},
		{"order", "first upload then ready;", "first upload then missing;", "Unresolved succession endpoint"},
		{"verify", "verify Requirements::preflightInterlock;", "verify Requirements::missing;", "Unresolved verification requirement"},
		{"constraint member", "not vehicle.armed", "not vehicle.missing", "Unresolved expression reference"},
		{"constraint operand", "not vehicle.armed", "not", "Expected an expression operand"},
		{"quantity unit", "3[SI::s]", "3[SI::missing]", "unit"},
		{"library typo", "ISQ::DurationValue", "ISQ::MissingValue", "Unresolved type"},
		{"binding", "= inspectionSystem.groundStation", "= inspectionSystem.missing", "Unresolved expression reference"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			broken := strings.Replace(src, tc.from, tc.to, 1)
			m := Parse(broken)
			found := false
			for _, d := range m.Diagnostics {
				if strings.Contains(d.Message, tc.diagnostic) {
					found = true
					if d.Line < 80 {
						t.Errorf("wrong diagnostic location: %+v", d)
					}
				}
			}
			if !found {
				t.Fatalf("missing %q in %+v", tc.diagnostic, m.Diagnostics)
			}
		})
	}
}

func TestBehaviorRenamePreservesReferences(t *testing.T) {
	for _, tc := range []struct{ id, name string }{
		{"InspectionDrone::Drone::armed", "isArmed"},
		{"InspectionDrone::Mission::nominalSequence::controller::captureSent", "captureRequested"},
		{"InspectionDrone::Mission::nominalSequence::capture", "captureImage"},
		{"InspectionDrone::Mission::nominalSequence::station", "ground"},
		{"InspectionDrone::Components", "Parts"},
		{"InspectionDrone::Requirements::preflightInterlock", "armingInterlock"},
	} {
		t.Run(tc.id, func(t *testing.T) {
			src := loadDrone(t)
			out, err := RenameElement(src, Parse(src), tc.id, tc.name)
			if err != nil {
				t.Fatal(err)
			}
			requireClean(t, Parse(out))
		})
	}
}

func TestScopedResolutionAndRename(t *testing.T) {
	src := `package P { package A { part def Same; part x : Same; } package B { part def Same; part y : Same; } dependency from A::x to B::y; }`
	m := Parse(src)
	requireClean(t, m)
	out, err := RenameElement(src, m, "P::A::Same", "Renamed")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "part y : Same;") || !strings.Contains(out, "part x : Renamed;") {
		t.Fatal("rename crossed scope")
	}
	bad := Parse(`package P { package A { part hidden; } package B { dependency from hidden to A::hidden; } }`)
	if len(bad.Diagnostics) == 0 {
		t.Fatal("unimported suffix resolved")
	}
	imported := Parse(`package P { package A { part def T; } package B { private import A::*; part x : T; } }`)
	requireClean(t, imported)
}

func TestBehaviorStructuredEditGuards(t *testing.T) {
	src := loadDrone(t)
	m := Parse(src)
	for _, e := range m.Elements {
		if e.Kind == "message" || e.Kind == "succession" || e.Kind == "verify" || e.Kind == "constraint" {
			if _, err := SetType(src, m, e.ID, "Integer"); err == nil {
				t.Errorf("unsafe type edit: %s", e.Kind)
			}
			if _, err := SetValue(src, m, e.ID, "1"); err == nil {
				t.Errorf("unsafe value edit: %s", e.Kind)
			}
		}
		if e.Implicit {
			if _, err := DeleteElement(src, m, e.ID); err == nil {
				t.Fatal("implicit relation deleted its action")
			}
		}
	}
}
