package views

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"

	"github.com/Rexus/SkyView/internal/sysml"
)

const PaletteName = "skyview.palette.json"
const PaletteSize = 32 << 10

// Palette records only project overrides. The built-in styles are shared by
// the diagram glyphs, SVG renderer and Settings keyword list.
type Palette struct {
	Version int               `json:"version"`
	Colours map[string]string `json:"colours"`
}

type KeywordColour struct {
	Keyword string `json:"keyword"`
	Default string `json:"default"`
	Fill    string `json:"fill"`
	Stroke  string `json:"stroke"`
}

var keywordFills = map[string]string{
	"action": "#f7e8e0", "analysis": "#dff1ee", "attribute": "#eaf0d9",
	"analysis case": "#dff1ee", "calc": "#ddf0ec", "connection": "#e5ecf3", "constraint": "#eee8f5",
	"doc": "#f5eadb", "item": "#e7efe4", "metadata": "#f3ecd7", "occurrence": "#dfeff2",
	"package": "#e8edf4", "part": "#e3edf3", "port": "#dbedf1",
	"requirement": "#ede7f4", "state": "#f4e8ea", "use case": "#f0ebde", "verification case": "#e6eafa", "view": "#e6ebf2",
}

var definitionKinds = map[string]bool{
	"action": true, "analysis case": true, "attribute": true, "calc": true,
	"connection": true, "constraint": true, "item": true, "metadata": true,
	"occurrence": true, "part": true, "port": true, "requirement": true,
	"state": true, "use case": true, "verification case": true, "view": true,
}

var keywordStrokes = map[string]string{
	"action": "#8b6556", "analysis": "#42786f", "analysis case": "#42786f",
	"attribute": "#67744c", "calc": "#497b71", "constraint": "#79658b",
	"doc": "#8c6e46", "item": "#576f53", "metadata": "#796d43", "occurrence": "#487986",
	"package": "#5a6e89", "part": "#4e7186", "port": "#38788a", "requirement": "#7a6089",
	"state": "#8b626c", "use case": "#7d6b4b", "verification case": "#656f95",
}

func DefaultPalette() Palette { return Palette{Version: 1, Colours: map[string]string{}} }

func ParsePalette(data []byte) (Palette, error) {
	var palette Palette
	if len(data) > PaletteSize {
		return palette, fmt.Errorf("project palette exceeds 32 KiB")
	}
	if err := json.Unmarshal(data, &palette); err != nil || palette.Version != 1 {
		return palette, fmt.Errorf("expected a version 1 project palette")
	}
	if palette.Colours == nil {
		palette.Colours = map[string]string{}
	}
	for keyword, fill := range palette.Colours {
		if _, supported := defaultFill(keyword); !supported || !hexColour(fill) {
			return palette, fmt.Errorf("invalid palette entry for %q: use a supported keyword and a six-digit hex colour", keyword)
		}
		palette.Colours[keyword] = strings.ToLower(fill)
	}
	return palette, nil
}

func hexColour(value string) bool {
	if len(value) != 7 || value[0] != '#' {
		return false
	}
	_, err := strconv.ParseUint(value[1:], 16, 24)
	return err == nil
}

func defaultFill(keyword string) (string, bool) {
	kind := strings.TrimSuffix(keyword, " def")
	fill, ok := keywordFills[kind]
	return fill, ok && (keyword == kind || definitionKinds[kind])
}

func (p Palette) Keywords() []KeywordColour {
	keys := make([]string, 0, len(keywordFills)*2)
	for key := range keywordFills {
		keys = append(keys, key)
		if definitionKinds[key] {
			keys = append(keys, key+" def")
		}
	}
	sort.Strings(keys)
	entries := make([]KeywordColour, 0, len(keys))
	for _, key := range keys {
		fill, _ := defaultFill(key)
		style := p.keywordStyle(key)
		entries = append(entries, KeywordColour{Keyword: key, Default: fill, Fill: style.Fill, Stroke: style.Stroke})
	}
	return entries
}

func (p Palette) keywordStyle(keyword string) Style {
	fill, ok := defaultFill(keyword)
	if !ok {
		fill = "#edf0f3"
	}
	if value := p.Colours[keyword]; value != "" {
		fill = value
	}
	// Pick the higher contrast ink (white or black) for arbitrary chosen fills.
	value, _ := strconv.ParseUint(fill[1:], 16, 24)
	linear := func(shift uint) float64 {
		v := float64(value>>shift&255) / 255
		if v <= 0.04045 {
			return v / 12.92
		}
		return math.Pow((v+.055)/1.055, 2.4)
	}
	ink, stroke := "#16232d", keywordStrokes[strings.TrimSuffix(keyword, " def")]
	if stroke == "" {
		stroke = "#627885"
	}
	switch luminance := .2126*linear(16) + .7152*linear(8) + .0722*linear(0); {
	case luminance < .179:
		ink, stroke = "#ffffff", "#a5b9c4"
	case luminance < .3:
		ink = "#000000"
	}
	return Style{Fill: fill, Stroke: stroke, Color: ink, Dash: "none"}
}

func languageKeyword(element *sysml.Element) string {
	if element.IsDef && definitionKinds[element.Kind] {
		return element.Kind + " def"
	}
	return element.Kind
}

func (p Palette) styleFor(element *sysml.Element) Style {
	return p.keywordStyle(languageKeyword(element))
}
