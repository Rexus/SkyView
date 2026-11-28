package sysml

import (
	"os"
	"strings"
	"testing"
)

func TestInvertedPendulumProjection(t *testing.T) {
	data, err := os.ReadFile("../../examples/inverted-pendulum/models/InvertedPendulum.sysml")
	if err != nil {
		t.Fatal(err)
	}
	m := Parse(string(data))
	requireClean(t, m)
	counts := map[string]int{}
	for _, e := range m.Elements {
		counts[e.Kind]++
		if e.Kind == "connection" && (e.SourceID == "" || e.TargetID == "") {
			t.Errorf("unresolved connection %s", e.QName)
		}
		if e.Kind == "verify" && !strings.HasPrefix(e.RequirementID, "InvertedPendulum::Intent::") {
			t.Errorf("unresolved verification %s", e.QName)
		}
	}
	for kind, want := range map[string]int{"connection": 13, "requirement": 4, "verify": 5, "analysis": 1} {
		if counts[kind] != want {
			t.Errorf("%s = %d, want %d", kind, counts[kind], want)
		}
	}
	broken := Parse(strings.Replace(string(data), "SI::m/SI::s^2", "SI::m/SI::missing^2", 1))
	if len(broken.Diagnostics) == 0 {
		t.Fatal("unknown compound unit was hidden")
	}
}

func TestQuantityComparisons(t *testing.T) {
	requireClean(t, Parse(`package P { attribute mass : ISQ::MassValue = 1[SI::kg]; constraint c { mass > -2[SI::kg] } }`))
	m := Parse(`package P { attribute mass : ISQ::MassValue; constraint c { mass > 2[SI::s] } }`)
	if len(m.Diagnostics) == 0 {
		t.Fatal("mass/time mismatch was hidden")
	}
}

func TestGenericQuantityDoesNotHideBooleanMismatch(t *testing.T) {
	m := Parse(`package P { attribute damping : Quantities::ScalarQuantityValue; constraint c { damping > true } }`)
	found := false
	for _, d := range m.Diagnostics {
		if strings.Contains(d.Message, "Incompatible comparison") {
			found = true
		}
	}
	if !found {
		t.Fatal("generic quantity accepted a Boolean comparison")
	}
}
