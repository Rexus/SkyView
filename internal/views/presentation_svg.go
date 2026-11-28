package views

import (
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/json"
	"fmt"
	"github.com/Rexus/SkyView/internal/sysml"
	"html"
	"slices"
	"strings"
)

//go:embed relationship.css
var relationshipCSS string

// RelationshipCSS is shared by the SVG export and the interactive canvas.
func RelationshipCSS() string { return relationshipCSS }

func renderPresentation(source string, v View) ([]byte, error) {
	drawing, _, err := drawPresentation(source, v, sysml.Parse(source))
	return drawing, err
}

func drawPresentation(source string, v View, m *sysml.Model) ([]byte, []SceneEdge, error) {
	if err := v.Validate(m); err != nil {
		return nil, nil, err
	}
	config, _ := json.Marshal(struct {
		View    View
		Styles  map[string]Style
		Palette map[string]string `json:"palette,omitempty"`
	}{v, v.Styles, v.Palette.Colours})
	var b bytes.Buffer
	fmt.Fprintf(&b, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %g %g" role="img" aria-labelledby="title" data-view-id="%s">`+"\n", v.Width, v.Height, html.EscapeString(v.ID))
	fmt.Fprintf(&b, "<title id=\"title\">%s</title>\n<metadata>renderer=skyview-svg-5; source-sha256=%x; view-sha256=%x</metadata>\n", html.EscapeString(v.Title), sha256.Sum256([]byte(source)), sha256.Sum256(config))
	b.WriteString("<style>" + relationshipCSS + "</style>\n")
	fmt.Fprintf(&b, "<rect width=\"%g\" height=\"%g\" fill=\"white\"/>\n", v.Width, v.Height)
	b.WriteString(`<defs class="diagram-relationship">
<marker id="flow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path class="relationship-arrow" d="M0 0 L8 4 L0 8 Z"/></marker>
<marker id="dependency" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path class="relationship-open-arrow" d="M1 1 L7 4 L1 7"/></marker>
</defs>` + "\n")
	frameStyle := Style{Fill: "#fafafa", Stroke: "#a5adb5", Color: "#273340", Dash: "7 4"}
	// Paint containers before descendants, then connectors over their backgrounds.
	glyphs := make(map[string]SceneNode, len(v.Nodes))
	var drawChildren func(string)
	drawChildren = func(parent string) {
		for _, f := range v.Boundaries {
			if f.Parent != parent {
				continue
			}
			s := frameStyle
			fmt.Fprintf(&b, "<g data-boundary=\"%s\" data-boundary-kind=\"%s\" data-parent=\"%s\"><title>Layout annotation: %s</title>\n", html.EscapeString(f.ID), html.EscapeString(f.Kind), html.EscapeString(f.Parent), html.EscapeString(f.Label))
			fmt.Fprintf(&b, "<rect x=\"%g\" y=\"%g\" width=\"%g\" height=\"%g\" fill=\"%s\" stroke=\"%s\" stroke-dasharray=\"%s\"/>\n", f.X, f.Y, f.Width, f.Height, s.Fill, s.Stroke, s.Dash)
			fmt.Fprintf(&b, "<text x=\"%g\" y=\"%g\" font-family=\"Arial,sans-serif\" text-anchor=\"middle\" font-size=\"15\" fill=\"%s\">%s</text></g>\n", f.X+f.Width/2, f.Y+23, s.Color, html.EscapeString(f.Label))
			drawChildren(f.ID)
		}
		for _, n := range v.Nodes {
			if n.Parent != parent {
				continue
			}
			e, _ := m.Select(n.Element)
			fmt.Fprintf(&b, "<g data-model=\"%s\" data-parent=\"%s\"><title>%s</title>\n", html.EscapeString(n.Element), html.EscapeString(n.Parent), html.EscapeString(e.QName))
			glyph := savedNativeNode(m, e, v, n)
			glyph.X, glyph.Y = n.X, n.Y
			glyphs[n.Element] = glyph
			fmt.Fprintf(&b, "<g transform=\"translate(%g %g)\">%s</g></g>\n", n.X, n.Y, glyph.SVG)
			drawChildren(n.Element)
		}
	}
	drawChildren("")
	edges := make([]SceneEdge, 0, len(v.Edges))
	for _, edge := range v.Edges {
		e, _ := m.Select(edge.Element)
		points := slices.Clone(edge.Points)
		label := e.Name
		if e.Kind == "connection" && e.Spans.Name.Start == e.Spans.Name.End {
			label = e.ShortName
		}
		if e.Kind == "connection" || e.Kind == "flow" {
			var fromVisible, toVisible bool
			points, fromVisible = attachPort(points, glyphs[edge.From], e.SourceID, v.Width)
			slices.Reverse(points)
			points, toVisible = attachPort(points, glyphs[edge.To], e.TargetID, v.Width)
			slices.Reverse(points)
			var suppressedPorts []string
			if port := m.Element(e.SourceID); !fromVisible && port != nil && port.Kind == "port" {
				suppressedPorts = append(suppressedPorts, e.Source)
			}
			if port := m.Element(e.TargetID); !toVisible && port != nil && port.Kind == "port" {
				suppressedPorts = append(suppressedPorts, e.Target)
			}
			if label != "" {
				suppressedPorts = append([]string{label}, suppressedPorts...)
			}
			label = strings.Join(suppressedPorts, " · ")
		}
		edges = append(edges, SceneEdge{Key: edge.Element, ElementID: e.ID, From: edge.From, To: edge.To, Points: points, Label: label})
		fmt.Fprintf(&b, "<g class=\"diagram-relationship\" style=\"--flow-end:url(#flow);--dependency-end:url(#dependency)\" data-relation=\"%s\" data-kind=\"%s\" data-from=\"%s\" data-to=\"%s\"><title>%s</title><polyline class=\"relationship-line\" points=\"", html.EscapeString(edge.Element), e.Kind, html.EscapeString(edge.From), html.EscapeString(edge.To), html.EscapeString(e.QName))
		for _, p := range points {
			fmt.Fprintf(&b, "%g,%g ", p[0], p[1])
		}
		b.WriteString("\"/>\n")
		fmt.Fprintf(&b, "<text x=\"%g\" y=\"%g\" class=\"relationship-label\">%s</text></g>\n", edge.Label[0], edge.Label[1], html.EscapeString(label))
	}
	b.WriteString("</svg>\n")
	return b.Bytes(), edges, nil
}

// Saved routes govern placement, but only the native endpoint determines the
// port. Keep the stored bends and join them from the actual boundary symbol.
func attachPort(points [][2]float64, node SceneNode, portID string, width float64) ([][2]float64, bool) {
	for _, port := range node.Ports {
		if port.ID != portID {
			continue
		}
		original := points[0]
		left := node.X
		right := node.X + node.Width
		x, stub := left, max(0, left-8)
		if original[0] > (left+right)/2 || original[0] == (left+right)/2 && points[1][0] >= original[0] {
			x, stub = right, min(width, right+8)
		}
		anchor := [2]float64{x, node.Y + port.Y}
		if anchor == original {
			return points, true
		}
		join := [2]float64{stub, original[1]}
		first := [][2]float64{anchor, {stub, anchor[1]}, join}
		next := points[1]
		if next[1] == original[1] && (stub < x && next[0] <= stub || stub > x && next[0] >= stub) {
			points = points[1:]
		}
		return slices.Compact(append(first, points...)), true
	}
	return points, false
}
