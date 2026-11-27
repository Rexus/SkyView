// Package views resolves presentation-only selections against native source identities.
package views

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/Rexus/SkyView/internal/sysml"
	"io"
	"math"
	"path"
	"regexp"
	"strings"
)

type Config struct {
	Version int    `json:"version"`
	Views   []View `json:"views"`
}
type View struct {
	ID      string  `json:"id"`
	Title   string  `json:"title"`
	Owner   string  `json:"owner"`
	Subject string  `json:"subject"`
	Width   float64 `json:"width"`
	Height  float64 `json:"height"`
	Nodes   []Node  `json:"nodes"`
	Edges   []Edge  `json:"edges"`
}
type Node struct {
	Element string  `json:"element"`
	X       float64 `json:"x"`
	Y       float64 `json:"y"`
	Width   float64 `json:"width"`
	Height  float64 `json:"height"`
}
type Edge struct {
	Element string       `json:"element"`
	From    string       `json:"from"`
	To      string       `json:"to"`
	Points  [][2]float64 `json:"points"`
	Label   [2]float64   `json:"label"`
}

var identifier = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$`)

func Parse(data []byte) (*Config, error) {
	var c Config
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if err := d.Decode(&c); err != nil {
		return nil, err
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return nil, fmt.Errorf("expected exactly one JSON configuration")
	}
	if c.Version != 1 || len(c.Views) == 0 || len(c.Views) > 100 {
		return nil, fmt.Errorf("expected version 1 and 1–100 selected views")
	}
	ids := map[string]bool{}
	for _, v := range c.Views {
		if !identifier.MatchString(v.ID) || ids[v.ID] {
			return nil, fmt.Errorf("invalid or duplicate view ID %q", v.ID)
		}
		ids[v.ID] = true
		if v.Title == "" || v.Subject == "" || !dimension(v.Width) || !dimension(v.Height) {
			return nil, fmt.Errorf("view %s needs title, subject and bounded canvas", v.ID)
		}
		if v.Owner != "." && (path.Clean(v.Owner) != v.Owner || strings.HasPrefix(v.Owner, "/") || strings.Contains(v.Owner, "\\") || v.Owner == ".." || strings.HasPrefix(v.Owner, "../")) {
			return nil, fmt.Errorf("invalid view owner %q", v.Owner)
		}
	}
	return &c, nil
}
func dimension(x float64) bool { return x > 0 && x <= 10000 && !math.IsNaN(x) && !math.IsInf(x, 0) }
func within(p [2]float64, v View) bool {
	return p[0] >= 0 && p[1] >= 0 && p[0] <= v.Width && p[1] <= v.Height
}
func onBoundary(p [2]float64, n Node) bool {
	const epsilon = 0.01
	return p[0] >= n.X-epsilon && p[0] <= n.X+n.Width+epsilon && p[1] >= n.Y-epsilon && p[1] <= n.Y+n.Height+epsilon &&
		(math.Abs(p[0]-n.X) < epsilon || math.Abs(p[0]-n.X-n.Width) < epsilon || math.Abs(p[1]-n.Y) < epsilon || math.Abs(p[1]-n.Y-n.Height) < epsilon)
}
func (c *Config) Find(id string) (View, error) {
	for _, v := range c.Views {
		if v.ID == id {
			return v, nil
		}
	}
	return View{}, fmt.Errorf("unknown view %q", id)
}

// Validate rejects invented/reversed relationships and unsupported selections. Parser
// diagnostics elsewhere in the preserved document remain distinct from this scoped check.
func (v View) Validate(m *sysml.Model) error {
	if _, err := m.Select(v.Subject); err != nil {
		return err
	}
	if len(v.Nodes) == 0 || len(v.Nodes) > 200 || len(v.Edges) > 500 {
		return fmt.Errorf("view selection exceeds compact renderer bounds")
	}
	nodes := map[string]Node{}
	nativeNodes := map[string]bool{}
	elements := map[string]*sysml.Element{}
	for _, n := range v.Nodes {
		if _, ok := nodes[n.Element]; ok {
			return fmt.Errorf("duplicate node %s", n.Element)
		}
		if !dimension(n.Width) || !dimension(n.Height) || !within([2]float64{n.X, n.Y}, v) || !within([2]float64{n.X + n.Width, n.Y + n.Height}, v) {
			return fmt.Errorf("node %s lies outside the canvas", n.Element)
		}
		e, err := m.Select(n.Element)
		if err != nil {
			return err
		}
		if nativeNodes[e.ID] {
			return fmt.Errorf("native element %s selected more than once", e.QName)
		}
		nativeNodes[e.ID] = true
		if e.Kind != "part" && e.Kind != "package" {
			return fmt.Errorf("node kind %q not supported by shared-view renderer", e.Kind)
		}
		for _, other := range nodes {
			if math.Min(n.X+n.Width, other.X+other.Width) > math.Max(n.X, other.X) && math.Min(n.Y+n.Height, other.Y+other.Height) > math.Max(n.Y, other.Y) {
				return fmt.Errorf("overlapping nodes %s and %s", n.Element, other.Element)
			}
		}
		nodes[n.Element] = n
		elements[n.Element] = e
	}
	seen := map[string]bool{}
	nativeEdges := map[string]bool{}
	for _, edge := range v.Edges {
		if seen[edge.Element] {
			return fmt.Errorf("duplicate edge %s", edge.Element)
		}
		seen[edge.Element] = true
		from, to := elements[edge.From], elements[edge.To]
		e, err := m.Select(edge.Element)
		if err != nil {
			return err
		}
		if nativeEdges[e.ID] {
			return fmt.Errorf("native relationship %s selected more than once", e.QName)
		}
		nativeEdges[e.ID] = true
		if e.Kind != "dependency" {
			return fmt.Errorf("edge kind %q not supported by shared-view renderer", e.Kind)
		}
		if from == nil || to == nil || e.SourceID != from.ID || e.TargetID != to.ID {
			return fmt.Errorf("edge %s endpoints differ from the native model", edge.Element)
		}
		if len(edge.Points) < 2 || len(edge.Points) > 20 || !within(edge.Label, v) {
			return fmt.Errorf("invalid edge route %s", edge.Element)
		}
		if !onBoundary(edge.Points[0], nodes[edge.From]) || !onBoundary(edge.Points[len(edge.Points)-1], nodes[edge.To]) {
			return fmt.Errorf("edge %s does not attach to its selected endpoints", edge.Element)
		}
		for i, p := range edge.Points {
			if !within(p, v) {
				return fmt.Errorf("edge route outside canvas")
			}
			if i > 0 && p[0] != edge.Points[i-1][0] && p[1] != edge.Points[i-1][1] {
				return fmt.Errorf("edge %s must be orthogonal", edge.Element)
			}
		}
	}
	return nil
}
