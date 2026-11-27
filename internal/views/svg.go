package views

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"github.com/Rexus/SkyView/internal/sysml"
	"html"
	"strings"
)

// Render is used unchanged by the HTTP view and CLI. No timestamps, random IDs,
// external assets or browser layout are involved; labels always come from source.
func Render(source string, v View) ([]byte, error) {
	m := sysml.Parse(source)
	if err := v.Validate(m); err != nil {
		return nil, err
	}
	config, _ := json.Marshal(v)
	var b bytes.Buffer
	fmt.Fprintf(&b, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %g %g" role="img" aria-labelledby="title" data-view-id="%s">`+"\n", v.Width, v.Height, html.EscapeString(v.ID))
	fmt.Fprintf(&b, "<title id=\"title\">%s</title>\n", html.EscapeString(v.Title))
	fmt.Fprintf(&b, "<metadata>renderer=skyview-svg-1; source-sha256=%x; view-sha256=%x</metadata>\n", sha256.Sum256([]byte(source)), sha256.Sum256(config))
	b.WriteString(`<style>text{font-family:Arial,sans-serif;fill:#203a5b;text-anchor:middle} .name{font-size:18px;font-weight:600} .kind{font-size:12px} .edge-label{font-size:13px;paint-order:stroke;stroke:white;stroke-width:5px;stroke-linejoin:round} </style>` + "\n")
	fmt.Fprintf(&b, "<rect width=\"%g\" height=\"%g\" fill=\"white\"/>\n", v.Width, v.Height)
	fmt.Fprintf(&b, "<text x=\"%g\" y=\"32\" class=\"name\">%s</text>\n", v.Width/2, html.EscapeString(v.Title))
	b.WriteString(`<defs><marker id="dependency" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="#627581"/></marker></defs>` + "\n")
	for _, e := range v.Edges {
		native, _ := m.Select(e.Element)
		fmt.Fprintf(&b, "<g data-relation=\"%s\" data-from=\"%s\" data-to=\"%s\">\n<polyline points=\"", html.EscapeString(e.Element), html.EscapeString(e.From), html.EscapeString(e.To))
		for _, p := range e.Points {
			fmt.Fprintf(&b, "%g,%g ", p[0], p[1])
		}
		b.WriteString(`" fill="none" stroke="#627581" stroke-width="1.6" stroke-dasharray="6 4" marker-end="url(#dependency)"/>` + "\n")
		fmt.Fprintf(&b, "<text x=\"%g\" y=\"%g\" class=\"edge-label\">%s</text>\n</g>\n", e.Label[0], e.Label[1], html.EscapeString(native.Name))
	}
	for _, n := range v.Nodes {
		e, _ := m.Select(n.Element)
		fmt.Fprintf(&b, "<g data-model=\"%s\"><title>%s</title>\n", html.EscapeString(n.Element), html.EscapeString(e.QName))
		fmt.Fprintf(&b, "<rect x=\"%g\" y=\"%g\" width=\"%g\" height=\"%g\" fill=\"#e7f0fc\" stroke=\"#4d719b\" stroke-width=\"1.5\"/>\n", n.X, n.Y, n.Width, n.Height)
		lines := wrap(e.Name, int((n.Width-24)/10))
		if len(lines)*23+34 > int(n.Height) {
			return nil, fmt.Errorf("label for %s does not fit; enlarge its box", n.Element)
		}
		for _, line := range lines {
			if len([]rune(line))*10 > int(n.Width-24) {
				return nil, fmt.Errorf("label for %s is too wide; enlarge its box", n.Element)
			}
		}
		kind := e.Kind
		if e.IsDef {
			kind += " def"
		}
		fmt.Fprintf(&b, "<text x=\"%g\" y=\"%g\" class=\"kind\">«%s»</text>\n", n.X+n.Width/2, n.Y+20, html.EscapeString(kind))
		for i, line := range lines {
			fmt.Fprintf(&b, "<text x=\"%g\" y=\"%g\" class=\"name\">%s</text>\n", n.X+n.Width/2, n.Y+47+float64(i)*23, html.EscapeString(line))
		}
		b.WriteString("</g>\n")
	}
	b.WriteString("</svg>\n")
	return b.Bytes(), nil
}
func wrap(s string, width int) []string {
	var out []string
	line := ""
	for _, word := range strings.Fields(s) {
		if len([]rune(line+" "+word)) > width && line != "" {
			out = append(out, line)
			line = ""
		}
		if line != "" {
			line += " "
		}
		line += word
	}
	return append(out, line)
}
