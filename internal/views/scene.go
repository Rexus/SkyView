package views

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"github.com/Rexus/SkyView/internal/sysml"
	"io"
)

// Scene is the interactive decomposition of the canonical drawing. Geometry is
// view-owned; ElementID and port identities come from the single native projector.
type Scene struct {
	SVG       string      `json:"svg"`
	Resources string      `json:"resources"`
	Nodes     []SceneNode `json:"nodes"`
	Edges     []SceneEdge `json:"edges"`
}
type ScenePort struct {
	ID   string  `json:"id"`
	Name string  `json:"name"`
	Type string  `json:"type"`
	Y    float64 `json:"y"`
}
type SceneNode struct {
	Key        string      `json:"key"`
	ElementID  string      `json:"elementId,omitempty"`
	Parent     string      `json:"parent,omitempty"`
	Annotation bool        `json:"annotation,omitempty"`
	X          float64     `json:"x"`
	Y          float64     `json:"y"`
	Width      float64     `json:"width"`
	Height     float64     `json:"height"`
	SVG        string      `json:"svg"`
	Ports      []ScenePort `json:"ports"`
}
type SceneEdge struct {
	Key       string       `json:"key"`
	ElementID string       `json:"elementId"`
	From      string       `json:"from"`
	To        string       `json:"to"`
	Points    [][2]float64 `json:"points"`
	Label     string       `json:"label"`
	SVG       string       `json:"svg"`
}

// BuildScene uses Render's exact drawing primitives. The browser does not parse
// an SVG into a model or implement a competing node/relationship renderer.
func BuildScene(source string, v View) (*Scene, error) {
	m := sysml.Parse(source)
	drawing, edges, err := drawPresentation(source, v, m)
	if err != nil {
		return nil, err
	}
	resources, groups, err := drawingGroups(drawing)
	if err != nil {
		return nil, err
	}
	scene := &Scene{SVG: string(drawing), Resources: resources, Nodes: []SceneNode{}, Edges: edges}
	for _, b := range v.Boundaries {
		scene.Nodes = append(scene.Nodes, SceneNode{Key: b.ID, Parent: b.Parent, Annotation: true, X: b.X, Y: b.Y, Width: b.Width, Height: b.Height, SVG: standaloneGlyph(resources, groups["boundary:"+b.ID], b.X, b.Y, b.Width, b.Height), Ports: []ScenePort{}})
	}
	for _, n := range v.Nodes {
		e, _ := m.Select(n.Element)
		ports := savedNativeNode(m, e, v, n).Ports
		scene.Nodes = append(scene.Nodes, SceneNode{Key: n.Element, ElementID: e.ID, Parent: n.Parent, X: n.X, Y: n.Y, Width: n.Width, Height: n.Height, SVG: standaloneGlyph(resources, groups["model:"+n.Element], n.X, n.Y, n.Width, n.Height), Ports: ports})
	}
	for i := range scene.Edges {
		scene.Edges[i].SVG = groups["relation:"+scene.Edges[i].Key]
	}
	return scene, nil
}
func standaloneGlyph(resources, body string, x, y, w, h float64) string {
	return fmt.Sprintf(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="%g %g %g %g" width="%g" height="%g">%s%s</svg>`, x, y, w, h, w, h, resources, body)
}

// Split top-level groups only. Nested labels/shapes stay byte-for-byte identical
// to export, including escaped text, inherited styles and marker definitions.
func drawingGroups(svg []byte) (string, map[string]string, error) {
	d := xml.NewDecoder(bytes.NewReader(svg))
	groups := map[string]string{}
	resources := ""
	depth := 0
	start := int64(0)
	key := ""
	resource := false
	for {
		before := d.InputOffset()
		token, err := d.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", nil, err
		}
		switch t := token.(type) {
		case xml.StartElement:
			depth++
			if depth == 2 {
				start = before
				key = ""
				resource = t.Name.Local == "style" || t.Name.Local == "defs"
				for _, a := range t.Attr {
					switch a.Name.Local {
					case "data-model":
						key = "model:" + a.Value
					case "data-boundary":
						key = "boundary:" + a.Value
					case "data-relation":
						key = "relation:" + a.Value
					}
				}
			}
		case xml.EndElement:
			if depth == 2 {
				raw := string(svg[start:d.InputOffset()])
				if key != "" {
					groups[key] = raw
				}
				if resource {
					resources += raw
				}
			}
			depth--
		}
	}
	return resources, groups, nil
}
