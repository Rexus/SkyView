package views

import (
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/json"
	"fmt"
	"github.com/Rexus/SkyView/internal/sysml"
	"html"
	"math"
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
	x, y := v.origin()
	fmt.Fprintf(&b, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="%g %g %g %g" role="img" aria-labelledby="title" data-view-id="%s">`+"\n", x, y, v.Width, v.Height, html.EscapeString(v.ID))
	fmt.Fprintf(&b, "<title id=\"title\">%s</title>\n<metadata>renderer=skyview-svg-6; source-sha256=%x; view-sha256=%x</metadata>\n", html.EscapeString(v.Title), sha256.Sum256([]byte(source)), sha256.Sum256(config))
	b.WriteString("<style>" + relationshipCSS + "</style>\n")
	fmt.Fprintf(&b, "<rect x=\"%g\" y=\"%g\" width=\"%g\" height=\"%g\" fill=\"white\"/>\n", x, y, v.Width, v.Height)
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
			points, fromVisible = attachPort(points, glyphs[edge.From], e.SourceID, x, x+v.Width)
			slices.Reverse(points)
			points, toVisible = attachPort(points, glyphs[edge.To], e.TargetID, x, x+v.Width)
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
		points = attachApproach(points, glyphs[edge.From], v)
		slices.Reverse(points)
		points = attachApproach(points, glyphs[edge.To], v)
		slices.Reverse(points)
		var leader *[2][2]float64
		if edge.LabelMoved && label != "" {
			leader = connectorLabelLeader(points, edge.Label, label)
		}
		edges = append(edges, SceneEdge{Key: edge.Element, ElementID: e.ID, From: edge.From, To: edge.To, Points: points, Label: label, LabelLeader: leader})
		fmt.Fprintf(&b, "<g class=\"diagram-relationship\" style=\"--flow-end:url(#flow);--dependency-end:url(#dependency)\" data-relation=\"%s\" data-kind=\"%s\" data-from=\"%s\" data-to=\"%s\"><title>%s</title><polyline class=\"relationship-line\" points=\"", html.EscapeString(edge.Element), e.Kind, html.EscapeString(edge.From), html.EscapeString(edge.To), html.EscapeString(e.QName))
		for _, p := range points {
			fmt.Fprintf(&b, "%g,%g ", p[0], p[1])
		}
		b.WriteString("\"/>\n")
		if leader != nil {
			fmt.Fprintf(&b, "<path class=\"relationship-label-leader\" d=\"M%g %g L%g %g\"/>\n",
				leader[0][0], leader[0][1], leader[1][0], leader[1][1])
		}
		fmt.Fprintf(&b, "<text x=\"%g\" y=\"%g\" class=\"relationship-label\">%s</text></g>\n", edge.Label[0], edge.Label[1], html.EscapeString(label))
	}
	b.WriteString("</svg>\n")
	return b.Bytes(), edges, nil
}

func connectorLabelLeader(points [][2]float64, position [2]float64, label string) *[2][2]float64 {
	width := 12.0
	for _, r := range label {
		switch {
		case strings.ContainsRune(" .,:;!'ilI1", r):
			width += 4
		case strings.ContainsRune("MW@%&mw", r):
			width += 11
		case r >= 'A' && r <= 'Z' || r >= '0' && r <= '9':
			width += 9
		case r >= '!' && r <= '~':
			width += 7
		default:
			width += 14
		}
	}
	center := [2]float64{position[0], position[1] - 3.5}
	best := math.Inf(1)
	var dx, dy float64
	for i, end := range points[1:] {
		start := points[i]
		x, y := end[0]-start[0], end[1]-start[1]
		length := x*x + y*y
		if length == 0 {
			continue
		}
		t := max(0, min(1, ((center[0]-start[0])*x+(center[1]-start[1])*y)/length))
		u, v := start[0]+x*t-center[0], start[1]+y*t-center[1]
		if distance := math.Hypot(u, v); distance < best {
			best, dx, dy = distance, u, v
		}
	}
	scale := max(math.Abs(dx)/(width/2), math.Abs(dy)/8.5)
	if scale <= 1 {
		return nil
	}
	return &[2][2]float64{{center[0] + dx, center[1] + dy}, {center[0] + dx/scale, center[1] + dy/scale}}
}

// Saved routes govern placement, but only the native endpoint determines the
// port. Keep the stored bends and join them from the actual boundary symbol.
func attachPort(points [][2]float64, node SceneNode, portID string, leftBound, rightBound float64) ([][2]float64, bool) {
	for _, port := range node.Ports {
		if port.ID != portID {
			continue
		}
		original := points[0]
		left := node.X
		right := node.X + node.Width
		x, stub := left, max(leftBound, left-8)
		if original[0] > (left+right)/2 || original[0] == (left+right)/2 && points[1][0] >= original[0] {
			x, stub = right, min(rightBound, right+8)
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

// A route imported from an older layout may run down the border of the target.
// Shift the last approach outside the card so its marker points into the card.
func attachApproach(points [][2]float64, node SceneNode, view View) [][2]float64 {
	if len(points) < 2 {
		return points
	}
	a, b := points[0], points[1]
	x, y := view.origin()
	left, right := node.X, node.X+node.Width
	top, bottom := node.Y, node.Y+node.Height
	on := func(a, b float64) bool { return math.Abs(a-b) < .01 }
	var offset [2]float64
	switch {
	case on(a[0], left) && on(a[0], b[0]) && !on(a[1], b[1]):
		offset[0] = -min(12, a[0]-x)
	case on(a[0], right) && on(a[0], b[0]) && !on(a[1], b[1]):
		offset[0] = min(12, x+view.Width-a[0])
	case on(a[1], top) && on(a[1], b[1]) && !on(a[0], b[0]):
		offset[1] = -min(12, a[1]-y)
	case on(a[1], bottom) && on(a[1], b[1]) && !on(a[0], b[0]):
		offset[1] = min(12, y+view.Height-a[1])
	default:
		return points
	}
	if offset == [2]float64{} {
		return points
	}
	stub := [2]float64{a[0] + offset[0], a[1] + offset[1]}
	join := [2]float64{b[0] + offset[0], b[1] + offset[1]}
	// When the old path already leaves the edge at the bend, start the
	// parallel portion there instead of doubling back across that bend.
	if len(points) > 2 {
		c := points[2]
		if offset[0] != 0 && on(c[1], join[1]) && (c[0]-join[0])*offset[0] >= 0 ||
			offset[1] != 0 && on(c[0], join[0]) && (c[1]-join[1])*offset[1] >= 0 {
			return slices.Compact(append([][2]float64{a, stub, join}, points[2:]...))
		}
	}
	return slices.Compact(append([][2]float64{a, stub, join}, points[1:]...))
}
