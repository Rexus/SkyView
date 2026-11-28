package views

import (
	"bytes"
	"encoding/json"
	"github.com/Rexus/SkyView/internal/sysml"
	"strings"
	"testing"
)

func TestInteractiveSceneAndExportShareDrawing(t *testing.T) {
	c := presentationFixture()
	raw, _ := json.Marshal(c)
	p, _ := Parse(raw)
	v := p.Views[0]
	scene, err := BuildScene(presentationSource, v)
	if err != nil {
		t.Fatal(err)
	}
	exported, err := Render(presentationSource, v)
	if err != nil || !bytes.Equal(exported, []byte(scene.SVG)) {
		t.Fatal("interactive/export disagreement", err)
	}
	if !bytes.Contains(exported, []byte(RelationshipCSS())) || !strings.Contains(scene.Edges[0].SVG, "relationship-line") {
		t.Fatal("export does not use the shared relationship stylesheet")
	}
	_, groups, err := drawingGroups(exported)
	if err != nil {
		t.Fatal(err)
	}
	m := sysml.Parse(presentationSource)
	if len(scene.Nodes) != 5 || len(scene.Edges) != 1 {
		t.Fatal("missing interactive objects")
	}
	for _, n := range scene.Nodes {
		kind := "model:"
		if n.Annotation {
			kind = "boundary:"
			if n.ElementID != "" {
				t.Fatal("annotation acquired native identity")
			}
		} else {
			e, _ := m.Select(n.Key)
			if e.ID != n.ElementID {
				t.Fatal("wrong native identity")
			}
		}
		if !strings.Contains(n.SVG, groups[kind+n.Key]) {
			t.Fatal("glyph differs from export")
		}
	}
	if !strings.Contains(scene.Edges[0].SVG, `data-kind="flow"`) {
		t.Fatal("lost native relation kind")
	}
	if len(scene.Nodes[2].Ports) != 1 {
		t.Fatal("native port handles missing")
	}
}
func TestDetailedNativeNodeIsSharedWithSavedView(t *testing.T) {
	defaults := DetailedNodes(presentationSource)
	m := sysml.Parse(presentationSource)
	a, _ := m.Select("A")
	glyph := defaults[a.ID]
	if len(glyph.Ports) != 1 || !strings.Contains(glyph.SVG, "io : Transfer") {
		t.Fatal("missing native compartment")
	}
	c := Config{Version: 2, Styles: map[string]Style{"legacy": {Fill: "#ff0000"}}, Views: []View{{
		ID: "comparison", Title: "Comparison", Owner: ".", Subject: "A", Width: 500, Height: 300, Presentation: true,
		Nodes: []Node{{Element: "A", X: 30, Y: 40, Width: glyph.Width, Height: glyph.Height,
			Shape: "cylinder", Style: "legacy", Labels: []Label{{Text: "Imported artwork", X: 40, Y: 40, Size: 13}}}},
	}}}

	raw, _ := json.Marshal(c)
	p, _ := Parse(raw)
	scene, err := BuildScene(presentationSource, p.Views[0])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(scene.SVG, glyph.SVG) {
		t.Fatal("saved view used another native node template")
	}
	if strings.Contains(scene.SVG, "Imported artwork") || strings.Contains(scene.SVG, "#ff0000") {
		t.Fatal("saved presentation bypassed native notation")
	}
	if strings.Contains(glyph.SVG, "<script>") {
		t.Fatal("unsafe glyph")
	}
}
func TestSceneRejectsReversedRelationship(t *testing.T) {
	c := presentationFixture()
	raw, _ := json.Marshal(c)
	p, _ := Parse(raw)
	p.Views[0].Edges[0].From = "B"
	if _, err := BuildScene(presentationSource, p.Views[0]); err == nil {
		t.Fatal("scene bypassed source relationship validation")
	}
}

func TestSavedConnectionsMeetTheNativePort(t *testing.T) {
	source := strings.Replace(presentationSource, "port io : Transfer;", "port io : Transfer; port feedback : Transfer;", 1)
	source = strings.Replace(source, "flow <'FLOW'>", "connection wiring connect a.feedback to b.io; flow <'FLOW'>", 1)
	config := presentationFixture()
	v := config.Views[0]
	v.Styles = config.Styles
	v.Edges[0].Element = "System::system::wiring"
	original := v.Edges[0].Points[0]
	scene, err := BuildScene(source, v)
	if err != nil {
		t.Fatal(err)
	}
	edge := scene.Edges[0]
	if edge.Label != "wiring" || !strings.Contains(edge.SVG, `data-kind="connection"`) || strings.Contains(edge.SVG, `marker-end=`) {
		t.Fatalf("ordinary connection drew as a flow: %s", edge.SVG)
	}
	var sourcePort, targetPort float64
	for _, node := range scene.Nodes {
		for _, port := range node.Ports {
			if node.Key == "A" && port.Name == "feedback" {
				sourcePort = node.Y + port.Y
			}
			if node.Key == "B" && port.Name == "io" {
				targetPort = node.Y + port.Y
			}
		}
	}
	first, last := edge.Points[0], edge.Points[len(edge.Points)-1]
	if first != [2]float64{270, sourcePort} || last != [2]float64{430, targetPort} || first == original {
		t.Fatalf("wrong native port anchors: %v to %v, expected %g to %g", first, last, sourcePort, targetPort)
	}
	for i := 1; i < len(edge.Points); i++ {
		a, b := edge.Points[i-1], edge.Points[i]
		if a[0] != b[0] && a[1] != b[1] {
			t.Fatalf("non-orthogonal port path: %v", edge.Points)
		}
	}
	if v.Edges[0].Points[0] != original {
		t.Fatal("rendering changed the stored layout")
	}
	exported, err := Render(source, v)
	if err != nil || string(exported) != scene.SVG {
		t.Fatal("browser and exported routes differ", err)
	}
}

func TestSceneAndSVGAcceptSignedCanvasPastTenThousand(t *testing.T) {
	cfg := presentationFixture()
	v := &cfg.Views[0]
	dx, dy := float64(-18000), float64(-15000)
	v.Origin = &[2]float64{dx, dy}
	v.Width += -dx
	v.Height += -dy
	for i := range v.Nodes {
		v.Nodes[i].X += dx
		v.Nodes[i].Y += dy
	}
	for i := range v.Boundaries {
		v.Boundaries[i].X += dx
		v.Boundaries[i].Y += dy
	}
	for i := range v.Edges {
		e := &v.Edges[i]
		e.Label[0] += dx
		e.Label[1] += dy
		for j := range e.Points {
			e.Points[j][0] += dx
			e.Points[j][1] += dy
		}
	}
	raw, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	reopened, err := Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	scene, err := BuildScene(presentationSource, reopened.Views[0])
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(scene.SVG, `viewBox="-18000 -15000 18800 15500"`) {
		t.Fatal("SVG bounds do not match the signed coordinate space")
	}
	for _, node := range scene.Nodes {
		if node.X >= 0 || node.Y >= 0 {
			t.Fatalf("expected signed positions, got %g, %g", node.X, node.Y)
		}
	}
}

func TestMovedConnectorLabelRoundTripsAndUsesTheRenderedPath(t *testing.T) {
	cfg := presentationFixture()
	cfg.Views[0].Edges[0].LabelMoved = true
	cfg.Views[0].Edges[0].Label = [2]float64{350, 225}
	raw, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	v := parsed.Views[0]
	if !v.Edges[0].LabelMoved {
		t.Fatal("layout lost the manual label flag")
	}
	scene, err := BuildScene(presentationSource, v)
	if err != nil {
		t.Fatal(err)
	}
	leader := scene.Edges[0].LabelLeader
	if leader == nil || (*leader)[0][0] != 350 || (*leader)[0][1] != 180 ||
		!strings.Contains(scene.Edges[0].SVG, `class="relationship-label-leader"`) {
		t.Fatalf("label did not lead back to the rendered connector: %v", leader)
	}
	svg, err := Render(presentationSource, v)
	if err != nil || string(svg) != scene.SVG {
		t.Fatal("SVG and preview use different drawings", err)
	}
}

func TestSavedDependencyArrowApproachesTheCardPerpendicularly(t *testing.T) {
	source := strings.Replace(presentationSource, "flow <'FLOW'> transfer from a.io.value to b.io.value;", "dependency <'FLOW'> trace from a to b;", 1)
	config := presentationFixture()
	view := config.Views[0]
	view.Styles = config.Styles
	edge := &view.Edges[0]
	edge.Points = [][2]float64{{270, 180}, {430, 180}, {430, 265}}
	scene, err := BuildScene(source, view)
	if err != nil {
		t.Fatal(err)
	}
	points := scene.Edges[0].Points
	if points[len(points)-1] != [2]float64{430, 265} || points[len(points)-2] != [2]float64{418, 265} {
		t.Fatalf("expected the marker to enter from the left: %v", points)
	}
	if edge.Points[len(edge.Points)-2] != [2]float64{430, 180} {
		t.Fatal("rendering changed the stored layout")
	}
	export, err := Render(source, view)
	if err != nil || string(export) != scene.SVG {
		t.Fatalf("browser and export differ: %v", err)
	}
}
