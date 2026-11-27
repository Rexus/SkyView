package views

import (
	"fmt"
	"github.com/Rexus/SkyView/internal/sysml"
	"html"
	"math"
	"strings"
)

// Both diagram modes use the same glyph. A saved box supplies dimensions,
// which limit how many native compartment rows fit without scaling the text.
func DetailedNodes(source string) map[string]SceneNode {
	return DetailedNodesWithPalette(source, DefaultPalette())
}

func DetailedNodesWithPalette(source string, palette Palette) map[string]SceneNode {
	m := sysml.Parse(source)
	result := map[string]SceneNode{}
	for _, e := range m.Elements {
		if strings.Contains("|root|port|attribute|connection|flow|satisfy|dependency|message|succession|first|verify|constraint|entry|", "|"+e.Kind+"|") {
			continue
		}
		result[e.ID] = nativeNode(m, e, palette, 224, 0, 0)
	}
	return result
}
func nativeMembers(m *sysml.Model, e *sysml.Element, kind string) []*sysml.Element {
	out := []*sysml.Element{}
	names := map[string]bool{}
	seen := map[string]bool{}
	for e != nil && !seen[e.ID] {
		seen[e.ID] = true
		for _, child := range m.Children(e.ID) {
			if child.Kind == kind && !names[child.Name] {
				out = append(out, child)
				names[child.Name] = true
			}
		}
		next := m.Element(e.TypeID)
		if next == nil {
			next = m.Element(e.SpecializesID)
		}
		if next == nil {
			next = m.Element(e.RedefinedID)
		}
		e = next
	}
	return out
}
func nativeNode(m *sysml.Model, e *sysml.Element, palette Palette, width, height, textHeight float64) SceneNode {
	top := 12.0
	if textHeight > 0 && textHeight < 48 {
		top = 2
	}
	y := top
	style := palette.styleFor(e)
	var body strings.Builder
	ports := []ScenePort{}
	text := func(value string, size float64, maxLines int) bool {
		available := max(4, int((width-24)/(size*.57)))
		lines := wrap(value, available)
		written := false
		for i, line := range lines {
			if i >= maxLines || (textHeight > 0 && y+size+2 > textHeight) {
				break
			}
			runes := []rune(line)
			if len(runes) > available || (i == maxLines-1 && i < len(lines)-1) {
				line = string(runes[:min(len(runes), available-1)]) + "…"
			}
			fmt.Fprintf(&body, `<text x="12" y="%g" font-size="%g" style="font-family:Arial,sans-serif;text-anchor:start;fill:%s;stroke:none">%s</text>`, y+size, size, style.Color, html.EscapeString(line))
			y += size + 4
			written = true
		}
		return written
	}

	section := func(label string) bool {
		if textHeight > 0 && y+28 > textHeight {
			return false
		}
		fmt.Fprintf(&body, `<path d="M1 %g H%g" stroke="%s" opacity=".32"/>`, y+1, width-1, style.Stroke)
		y += 5
		return text(label, 10, 1)
	}
	keyword := languageKeyword(e)
	if e.Direction == "ref" && !e.IsDef {
		keyword = "ref " + keyword
	}
	text("«"+keyword+"»", 10, 1)
	text(e.Name, 13, 2)
	if e.Type != "" {
		text(": "+e.Type, 11, 2)
	}
	attrs, members := nativeMembers(m, e, "attribute"), nativeMembers(m, e, "port")
	if len(attrs) > 0 && section("attributes") {
		for i, attr := range attrs {
			if i == 4 {
				text(fmt.Sprintf("+%d more", len(attrs)-i), 10, 1)
				break
			}
			value := attr.Name
			if attr.Type != "" {
				value += " : " + attr.Type
			}
			if attr.Value != "" {
				value += " = " + attr.Value
			}
			if !text(value, 10, 1) {
				break
			}
		}
	}
	portCompartment := len(members) > 0 && section("ports")
	for i, member := range members {
		anchor := y + 7
		if !portCompartment || !text(member.Name+" : "+member.Type, 10, 1) {
			anchor = 5 + (height-10)*float64(i+1)/float64(len(members)+1)
		}
		ports = append(ports, ScenePort{ID: member.ID, Name: member.Name, Type: member.Type, Y: anchor})
	}
	doc := e.DocResolved
	if doc == "" {
		doc = e.Doc
	}
	if doc != "" && section("doc") {
		text(doc, 10, 2)
	}
	if height <= 0 {
		height = y + 10
	}
	for _, port := range ports {
		for _, x := range []float64{1, width - 6} {
			fmt.Fprintf(&body, `<rect x="%g" y="%g" width="5" height="5" rx="1" fill="%s" stroke="%s"/>`, x, port.Y-2.5, style.Fill, style.Stroke)
		}
	}
	drawing := fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %g %g" width="%g" height="%g"><title>%s</title><rect x=".75" y=".75" width="%g" height="%g" rx="4" fill="%s" stroke="%s" stroke-width="1.2"/>%s</svg>`, width, height, width, height, html.EscapeString(e.QName), math.Max(0, width-1.5), math.Max(0, height-1.5), style.Fill, style.Stroke, body.String())
	return SceneNode{Key: e.QName, ElementID: e.ID, Width: width, Height: height, SVG: drawing, Ports: ports}
}

// Saved containment reserves the space below the first child for the child.
// This keeps parent text out of imported compact layouts without scaling it.
func savedNativeNode(m *sysml.Model, element *sysml.Element, view View, node Node) SceneNode {
	textHeight := node.Height
	for _, child := range view.Nodes {
		if child.Parent == node.Element {
			textHeight = min(textHeight, max(1, child.Y-node.Y-4))
		}
	}
	for _, child := range view.Boundaries {
		if child.Parent == node.Element {
			textHeight = min(textHeight, max(1, child.Y-node.Y-4))
		}
	}
	return nativeNode(m, element, view.Palette, node.Width, node.Height, textHeight)
}
