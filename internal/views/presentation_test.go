package views

import (
	"bytes"
	"encoding/json"
	"github.com/Rexus/SkyView/internal/sysml"
	"strings"
	"testing"
)

const presentationSource = `package System {
 item def Payload;
 port def Transfer { inout item value : Payload; }
 part def Component { port io : Transfer; }
 part <'SYS'> system {
  part <'A'> a : Component;
  part <'B'> b : Component { item <'DATA'> content : Payload; }
  flow <'FLOW'> transfer from a.io.value to b.io.value;
 }
}`

func presentationFixture() Config {
	return Config{Version: 2, Styles: map[string]Style{"zone": {Fill: "#faf7f8", Stroke: "#ad969e", Dash: "7 4"}}, Views: []View{{
		ID: "design", Title: "Design", Owner: "subsystem", Subject: "SYS", Presentation: true, Width: 800, Height: 500,
		Boundaries: []Boundary{{ID: "tier", Label: "Tier", X: 20, Y: 20, Width: 760, Height: 440, Layout: &Arrangement{Pattern: "horizontal", Locked: true}}, {ID: "zone", Label: "Zone", Parent: "tier", X: 40, Y: 70, Width: 720, Height: 360, Style: "zone", Layout: &Arrangement{Pattern: "grid", Columns: 2}}},
		Nodes:      []Node{{Element: "A", Parent: "zone", X: 70, Y: 130, Width: 200, Height: 100}, {Element: "B", Parent: "zone", X: 430, Y: 130, Width: 280, Height: 230}, {Element: "DATA", Parent: "B", X: 460, Y: 230, Width: 200, Height: 80}},
		Edges:      []Edge{{Element: "FLOW", From: "A", To: "B", Points: [][2]float64{{270, 180}, {430, 180}}, Label: [2]float64{350, 170}}},
	}}}
}
func TestPresentationPreservesNativeContentAndPortableSettings(t *testing.T) {
	c := presentationFixture()
	raw, _ := json.Marshal(c)
	config, err := Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	v := config.Views[0]
	a, err := Render(presentationSource, v)
	if err != nil {
		t.Fatal(err)
	}
	b, err := Render(presentationSource, v)
	if err != nil || !bytes.Equal(a, b) {
		t.Fatal("rendering is not deterministic")
	}
	for _, want := range []string{`data-boundary="tier"`, `data-model="DATA"`, `data-kind="flow"`, `stroke="#a5adb5"`, `data-parent="B"`} {
		if !strings.Contains(string(a), want) {
			t.Fatal("missing", want)
		}
	}
	if strings.Contains(string(a), "#ad969e") {
		t.Fatal("a legacy view-specific border changed the shared design")
	}
	if strings.Contains(string(a), `data-model="tier"`) {
		t.Fatal("annotation became a model element")
	}
	if !v.Boundaries[0].Layout.Locked || v.Boundaries[1].Layout.Pattern != "grid" {
		t.Fatal("local settings lost")
	}
}
func TestPresentationRejectsFalseMeaningAndInvalidGeometry(t *testing.T) {
	cases := map[string]func(*View){
		"reversed flow":           func(v *View) { v.Edges[0].From, v.Edges[0].To = "B", "A" },
		"invented composition":    func(v *View) { v.Nodes[0].Parent = "B"; v.Nodes[0].X = 450; v.Nodes[0].Y = 170 },
		"cycle":                   func(v *View) { v.Boundaries[0].Parent = "zone" },
		"overlap":                 func(v *View) { v.Nodes[0].X = 450 },
		"missing frame":           func(v *View) { v.Nodes[0].Parent = "missing" },
		"unsupported arrangement": func(v *View) { v.Boundaries[0].Layout.Pattern = "unknown" },
		"bad style":               func(v *View) { v.Styles["zone"] = Style{Fill: `red\" onload=\"alert(1)`} },
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			c := presentationFixture()
			raw, _ := json.Marshal(c)
			p, _ := Parse(raw)
			change(&p.Views[0])
			if _, err := Render(presentationSource, p.Views[0]); err == nil {
				t.Fatal("invalid view accepted")
			}
		})
	}
}
func TestPresentationEscapesAnnotationText(t *testing.T) {
	c := presentationFixture()
	raw, _ := json.Marshal(c)
	p, _ := Parse(raw)
	p.Views[0].Boundaries[0].Label = `<script>alert("x")</script>`
	b, err := Render(presentationSource, p.Views[0])
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "<script>") {
		t.Fatal("unsafe annotation")
	}
}
func TestNativeFlowAndRedefinedMemberProjection(t *testing.T) {
	source := `package P { item def Payload; port def Port { inout item data : Payload; } part def Proxy { port access : Port; } part def Host { part proxy : Proxy; } part <'HOST'> host : Host { part <'RUN'> proxy :>> Host::proxy; } part <'CLIENT'> client : Proxy; flow <'F'> request from client.access.data to host.proxy.access.data; }`
	m := sysml.Parse(source)
	flow, err := m.Select("F")
	if err != nil {
		t.Fatal(err)
	}
	if flow.Kind != "flow" || flow.SourceID == "" || flow.TargetID == "" {
		t.Fatalf("flow endpoints unresolved: %+v", flow)
	}
	run, _ := m.Select("RUN")
	if run.RedefinedID == "" {
		t.Fatal("redefined usage identity not preserved")
	}
	// The displayed endpoint is the top-level host for this lexical feature chain,
	// not a guessed similarly named proxy from a different instance.
	host, _ := m.Select("HOST")
	if flow.TargetNodeID != host.ID {
		t.Fatal("incorrect flow owner")
	}
}

func TestPresentationRejectsNativeOwnershipBypass(t *testing.T) {
	v := View{ID: "test", Title: "Test", Subject: "SYS", Owner: ".", Presentation: true, Width: 700, Height: 600,
		Nodes:      []Node{{Element: "B", X: 20, Y: 20, Width: 600, Height: 500}, {Element: "A", Parent: "frame", X: 100, Y: 140, Width: 100, Height: 60}},
		Boundaries: []Boundary{{ID: "frame", Label: "Frame", Parent: "B", X: 60, Y: 70, Width: 500, Height: 400}},
	}
	if _, err := Render(presentationSource, v); err == nil || !strings.Contains(err.Error(), "not owned") {
		t.Fatal("annotation bypassed native ownership", err)
	}
}
func TestPresentationSettingsCannotBeSilentlyIgnored(t *testing.T) {
	c := presentationFixture()
	c.Views[0].Presentation = false
	raw, _ := json.Marshal(c)
	if _, err := Parse(raw); err == nil {
		t.Fatal("classic view silently ignored presentation settings")
	}
}
func TestStorageCapAttachmentHasBoundedTolerance(t *testing.T) {
	n := Node{X: 100, Y: 100, Width: 200, Height: 100, Shape: "cylinder"}
	if !onPresentationBoundary([2]float64{200, 101.25}, n) {
		t.Fatal("curved cap stroke attachment rejected")
	}
	if onPresentationBoundary([2]float64{200, 106}, n) {
		t.Fatal("detached route accepted")
	}
	n.Shape = "rectangle"
	if onPresentationBoundary([2]float64{200, 101.25}, n) {
		t.Fatal("curved-cap tolerance leaked to rectangles")
	}
}
