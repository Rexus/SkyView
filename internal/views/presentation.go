package views

import (
	"fmt"
	"github.com/Rexus/SkyView/internal/sysml"
	"math"
	"regexp"
)

// Presentation settings do not instantiate SysML elements or establish ownership.
// Children use absolute canvas coordinates; parent is an explicit layout container.
type Arrangement struct {
	Pattern        string  `json:"pattern,omitempty"`
	Direction      string  `json:"direction,omitempty"`
	Columns        int     `json:"columns,omitempty"`
	Locked         bool    `json:"locked,omitempty"`
	PositionLocked bool    `json:"positionLocked,omitempty"`
	Gap            float64 `json:"gap,omitempty"`
	Padding        float64 `json:"padding,omitempty"`
}
type Style struct {
	Fill   string `json:"fill,omitempty"`
	Stroke string `json:"stroke,omitempty"`
	Color  string `json:"color,omitempty"`
	Dash   string `json:"dash,omitempty"`
}
type Label struct {
	Text string  `json:"text"`
	X    float64 `json:"x"`
	Y    float64 `json:"y"`
	Size float64 `json:"size,omitempty"`
}
type Boundary struct {
	ID     string       `json:"id"`
	Label  string       `json:"label"`
	Kind   string       `json:"kind,omitempty"`
	Parent string       `json:"parent,omitempty"`
	X      float64      `json:"x"`
	Y      float64      `json:"y"`
	Width  float64      `json:"width"`
	Height float64      `json:"height"`
	Style  string       `json:"style,omitempty"`
	Layout *Arrangement `json:"layout,omitempty"`
}

var colorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
var dashPattern = regexp.MustCompile(`^(none|[0-9]+( [0-9]+){0,7})$`)

func finite(x float64) bool { return !math.IsNaN(x) && !math.IsInf(x, 0) }
func validArrangement(a *Arrangement) bool {
	if a == nil {
		return true
	}
	return (a.Pattern == "" || a.Pattern == "flow" || a.Pattern == "horizontal" || a.Pattern == "vertical" || a.Pattern == "grid") &&
		(a.Direction == "" || a.Direction == "LR" || a.Direction == "TB") && a.Columns >= 0 && a.Columns <= 20 &&
		finite(a.Gap) && a.Gap >= 0 && a.Gap <= 200 && finite(a.Padding) && a.Padding >= 0 && a.Padding <= 100
}

type presentationBox struct {
	key, parent string
	x, y, w, h  float64
	element     *sysml.Element
}

func (v View) validatePresentation(m *sysml.Model) error {
	if _, err := m.Select(v.Subject); err != nil {
		return err
	}
	if len(v.Nodes) == 0 || len(v.Nodes) > 200 || len(v.Boundaries) > 100 || len(v.Edges) > 500 || !validArrangement(v.Layout) {
		return fmt.Errorf("invalid presentation size or layout settings")
	}
	for key, s := range v.Styles {
		if !identifier.MatchString(key) {
			return fmt.Errorf("invalid style identity %q", key)
		}
		for _, color := range []string{s.Fill, s.Stroke, s.Color} {
			if color != "" && !colorPattern.MatchString(color) {
				return fmt.Errorf("style %s needs six-digit hex colours", key)
			}
		}
		if s.Dash != "" && !dashPattern.MatchString(s.Dash) {
			return fmt.Errorf("invalid dash pattern in %s", key)
		}
	}
	boxes := map[string]presentationBox{}
	native := map[string]bool{}
	nodes := map[string]Node{}
	add := func(b presentationBox, style string, layout *Arrangement) error {
		if _, ok := boxes[b.key]; ok || b.key == "" {
			return fmt.Errorf("duplicate presentation identity %q", b.key)
		}
		if !dimension(b.w) || !dimension(b.h) || !finite(b.x) || !finite(b.y) || !within([2]float64{b.x, b.y}, v) || !within([2]float64{b.x + b.w, b.y + b.h}, v) {
			return fmt.Errorf("%s lies outside the canvas", b.key)
		}
		if style != "" {
			if _, ok := v.Styles[style]; !ok {
				return fmt.Errorf("unknown style %q", style)
			}
		}
		if !validArrangement(layout) {
			return fmt.Errorf("invalid layout for %s", b.key)
		}
		boxes[b.key] = b
		return nil
	}
	for _, n := range v.Nodes {
		nodes[n.Element] = n
		e, err := m.Select(n.Element)
		if err != nil {
			return err
		}
		if native[e.ID] {
			return fmt.Errorf("native element %s selected more than once", e.QName)
		}
		native[e.ID] = true
		if e.Kind != "part" && e.Kind != "package" && e.Kind != "item" && e.Kind != "requirement" {
			return fmt.Errorf("node kind %q not supported by presentation renderer", e.Kind)
		}
		if n.Shape != "" && n.Shape != "rectangle" && n.Shape != "cylinder" && n.Shape != "hexagon" {
			return fmt.Errorf("unsupported shape %s", n.Shape)
		}
		if len(n.Labels) > 12 {
			return fmt.Errorf("too many labels for %s", n.Element)
		}
		for _, l := range n.Labels {
			if len(l.Text) > 500 || !finite(l.X) || !finite(l.Y) || l.X < 0 || l.X > n.Width || l.Y < 0 || l.Y > n.Height || !finite(l.Size) || l.Size < 0 || l.Size > 40 {
				return fmt.Errorf("invalid label in %s", n.Element)
			}
		}
		if err = add(presentationBox{n.Element, n.Parent, n.X, n.Y, n.Width, n.Height, e}, n.Style, n.Layout); err != nil {
			return err
		}
	}
	for _, b := range v.Boundaries {
		if !identifier.MatchString(b.ID) || b.Label == "" || len(b.Label) > 200 {
			return fmt.Errorf("invalid boundary identity or label")
		}
		if b.Kind != "" && b.Kind != "tier" && b.Kind != "zone" && b.Kind != "network" && b.Kind != "group" {
			return fmt.Errorf("unknown annotation kind %s", b.Kind)
		}
		if err := add(presentationBox{b.ID, b.Parent, b.X, b.Y, b.Width, b.Height, nil}, b.Style, b.Layout); err != nil {
			return err
		}
	}
	ancestors := func(key string) (map[string]bool, error) {
		seen := map[string]bool{key: true}
		p := boxes[key].parent
		for p != "" {
			if seen[p] {
				return nil, fmt.Errorf("cyclic presentation nesting at %s", p)
			}
			b, ok := boxes[p]
			if !ok {
				return nil, fmt.Errorf("missing container %s", p)
			}
			seen[p] = true
			p = b.parent
		}
		return seen, nil
	}
	for key, b := range boxes {
		above, err := ancestors(key)
		if err != nil {
			return err
		}
		if b.parent != "" {
			p := boxes[b.parent]
			if b.x < p.x || b.y < p.y+24 || b.x+b.w > p.x+p.w || b.y+b.h > p.y+p.h {
				return fmt.Errorf("%s is outside the content area of %s", key, p.key)
			}
			// An annotation may group arbitrary selections. Nesting under a native node
			// must agree with model ownership; a frame cannot invent composition.
			if p.element != nil && b.element != nil {
				owned := false
				for e := m.ByID[b.element.ParentID]; e != nil; e = m.ByID[e.ParentID] {
					if e.ID == p.element.ID {
						owned = true
						break
					}
				}
				if !owned {
					return fmt.Errorf("%s is not owned by native container %s", key, p.key)
				}
			}
		}
		// Annotation nesting cannot bypass native ownership checks.
		if b.element != nil {
			for ancestor := range above {
				p := boxes[ancestor]
				if ancestor == key || p.element == nil {
					continue
				}
				owned := false
				for e := m.ByID[b.element.ParentID]; e != nil; e = m.ByID[e.ParentID] {
					if e.ID == p.element.ID {
						owned = true
						break
					}
				}
				if !owned {
					return fmt.Errorf("%s is not owned by native container %s", key, ancestor)
				}
			}
		}
		for other, c := range boxes {
			if other == key || above[other] {
				continue
			}
			ca, err := ancestors(other)
			if err != nil {
				return err
			}
			if ca[key] {
				continue
			}
			if math.Min(b.x+b.w, c.x+c.w) > math.Max(b.x, c.x) && math.Min(b.y+b.h, c.y+c.h) > math.Max(b.y, c.y) {
				return fmt.Errorf("overlapping siblings %s and %s", key, other)
			}
		}
	}
	seen := map[string]bool{}
	for _, edge := range v.Edges {
		e, err := m.Select(edge.Element)
		if err != nil {
			return err
		}
		if seen[e.ID] {
			return fmt.Errorf("duplicate native edge %s", edge.Element)
		}
		seen[e.ID] = true
		from, to := boxes[edge.From].element, boxes[edge.To].element
		if from == nil || to == nil {
			return fmt.Errorf("relationship endpoints must be selected native elements")
		}
		source, target := e.SourceID, e.TargetID
		switch e.Kind {
		case "dependency":
		case "connection", "flow":
			if e.SourceNodeID != "" {
				source = e.SourceNodeID
			}
			if e.TargetNodeID != "" {
				target = e.TargetNodeID
			}
		default:
			return fmt.Errorf("edge kind %q not supported", e.Kind)
		}
		if source != from.ID || target != to.ID {
			return fmt.Errorf("edge %s endpoints differ from native model", edge.Element)
		}
		if len(edge.Points) < 2 || len(edge.Points) > 40 || !within(edge.Label, v) || len(edge.Caption) > 200 {
			return fmt.Errorf("invalid route %s", edge.Element)
		}
		if !onPresentationBoundary(edge.Points[0], nodes[edge.From]) || !onPresentationBoundary(edge.Points[len(edge.Points)-1], nodes[edge.To]) {
			return fmt.Errorf("edge %s detached from endpoints", edge.Element)
		}
		for i, p := range edge.Points {
			if !finite(p[0]) || !finite(p[1]) || !within(p, v) {
				return fmt.Errorf("invalid route coordinate")
			}
			if i > 0 && p[0] != edge.Points[i-1][0] && p[1] != edge.Points[i-1][1] {
				return fmt.Errorf("edge %s must be orthogonal", edge.Element)
			}
		}
	}
	return nil
}

// A stroke can meet the curved storage cap just inside its geometric bounds.
func onPresentationBoundary(p [2]float64, n Node) bool {
	if onBoundary(p, n) {
		return true
	}
	return n.Shape == "cylinder" && math.Abs(p[0]-n.X-n.Width/2) <= 2 &&
		(math.Abs(p[1]-n.Y) <= 2 || math.Abs(p[1]-n.Y-n.Height) <= 2)
}
func (v View) hasPresentationSettings() bool {
	if len(v.Boundaries) > 0 || v.Layout != nil {
		return true
	}
	for _, n := range v.Nodes {
		if n.Detail || n.Parent != "" || n.Style != "" || n.Shape != "" || len(n.Labels) > 0 || n.Layout != nil {
			return true
		}
	}
	for _, e := range v.Edges {
		if e.Caption != "" {
			return true
		}
	}
	return false
}
