package cli_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Rexus/SkyView/internal/cli"
	"github.com/Rexus/SkyView/internal/server"
	"github.com/Rexus/SkyView/internal/views"
)

const source = "// UTF-8 retained: blåbär\r\npackage System {\r\n part <'SYS'> system { part <'A'> 'Consumer'; part <'B'> 'Provider'; dependency <'D'> 'Supply' from 'Consumer' to 'Provider'; }\r\n view <'future'> overview : UnknownView;\r\n}\r\n"

func fixture() views.Config {
	return views.Config{Version: 1, Views: []views.View{
		{ID: "overall", Title: "System Overall", Owner: ".", Subject: "SYS", Width: 600, Height: 250,
			Nodes: []views.Node{{Element: "A", X: 30, Y: 80, Width: 180, Height: 90}, {Element: "B", X: 390, Y: 80, Width: 180, Height: 90}},
			Edges: []views.Edge{{Element: "D", From: "A", To: "B", Points: [][2]float64{{210, 125}, {390, 125}}, Label: [2]float64{300, 110}}},
		},
	}}
}
func invoke(t *testing.T, want int, args ...string) string {
	t.Helper()
	var out, err bytes.Buffer
	got := cli.Run(args, &out, &err)
	if got != want {
		t.Fatalf("%v: exit %d, want %d: %s %s", args, got, want, &out, &err)
	}
	return out.String() + err.String()
}
func put(t *testing.T, p string, b []byte) {
	t.Helper()
	if err := os.WriteFile(p, b, 0o600); err != nil {
		t.Fatal(err)
	}
}
func TestExchangeAndOneRenderer(t *testing.T) {
	dir := t.TempDir()
	srv := httptest.NewServer(server.New(filepath.Join(dir, "workspace")).Handler())
	defer srv.Close()
	src, cfg, svg := filepath.Join(dir, "Model.sysml"), filepath.Join(dir, "Model.views.json"), filepath.Join(dir, "Overall.svg")
	put(t, src, []byte(source))
	cb, _ := json.Marshal(fixture())
	put(t, cfg, cb)
	for i := 0; i < 2; i++ {
		invoke(t, 0, "import", "-url", srv.URL, "-in", src, "-views", cfg)
	}
	exported, vcopy := filepath.Join(dir, "Export.sysml"), filepath.Join(dir, "Export.views.json")
	invoke(t, 0, "export", "-url", srv.URL, "-name", "Model.sysml", "-out", exported, "-views-out", vcopy)
	got, _ := os.ReadFile(exported)
	if string(got) != source {
		t.Fatal("source changed during exchange")
	}
	got, _ = os.ReadFile(vcopy)
	if !bytes.Equal(got, cb) {
		t.Fatal("shared config changed")
	}
	invoke(t, 0, "render", "-in", src, "-views", cfg, "-view", "overall", "-out", svg)
	res, err := http.Get(srv.URL + "/api/files/Model.sysml/views/overall")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	browser, _ := io.ReadAll(res.Body)
	offline, _ := os.ReadFile(svg)
	if res.StatusCode != 200 || !bytes.Equal(browser, offline) {
		t.Fatal("browser and CLI do not share identical SVG output")
	}
	invoke(t, 0, "render", "-in", src, "-views", cfg, "-view", "overall", "-out", svg, "-check")
	put(t, svg, []byte("stale"))
	invoke(t, 1, "render", "-in", src, "-views", cfg, "-view", "overall", "-out", svg, "-check")
	invoke(t, 1, "export", "-url", srv.URL, "-name", "Model.sysml", "-out", exported)
	put(t, src, []byte(source+"// changed\n"))
	invoke(t, 1, "import", "-url", srv.URL, "-in", src)
	res, err = http.Get(srv.URL + "/api/files/Model.sysml/download")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	unchanged, _ := io.ReadAll(res.Body)
	if string(unchanged) != source {
		t.Fatal("conflicting import replaced workspace edits")
	}
}
func TestPreserveEmptyAndUnsupportedSource(t *testing.T) {
	for _, s := range []string{"", " \r\n\t", source} {
		t.Run(string(rune('a'+len(s)%26)), func(t *testing.T) {
			dir := t.TempDir()
			srv := httptest.NewServer(server.New(filepath.Join(dir, "workspace")).Handler())
			defer srv.Close()
			in, out := filepath.Join(dir, "Input.sysml"), filepath.Join(dir, "Output.sysml")
			put(t, in, []byte(s))
			invoke(t, 0, "import", "-url", srv.URL, "-in", in)
			invoke(t, 0, "export", "-url", srv.URL, "-name", "Input.sysml", "-out", out)
			got, _ := os.ReadFile(out)
			if string(got) != s {
				t.Fatal("verbatim source not preserved")
			}
		})
	}
}
func TestRejectMisleadingViews(t *testing.T) {
	for _, kind := range []string{"unknown", "reversed", "invented", "overlap", "wrong-attachment"} {
		t.Run(kind, func(t *testing.T) {
			c := fixture()
			v := &c.Views[0]
			switch kind {
			case "unknown":
				v.Nodes[0].Element = "missing"
			case "reversed":
				v.Edges[0].From = "B"
				v.Edges[0].To = "A"
			case "invented":
				v.Edges[0].Element = "fake"
			case "overlap":
				v.Nodes[1].X = 50
			case "wrong-attachment":
				v.Edges[0].Points[0] = [2]float64{0, 125}
			}
			if _, err := views.Render(source, *v); err == nil {
				t.Fatal("invalid view accepted")
			}
		})
	}
	b, _ := json.Marshal(fixture())
	if _, err := views.Parse([]byte(strings.Replace(string(b), `"version":1`, `"version":1,"typo":true`, 1))); err == nil {
		t.Fatal("unknown JSON field accepted")
	}
}

func TestRejectDuplicateNativeSelection(t *testing.T) {
	c := fixture()
	v := &c.Views[0]
	v.Nodes = append(v.Nodes, views.Node{Element: "System::system::Consumer", X: 30, Y: 180, Width: 180, Height: 60})
	if _, err := views.Render(source, *v); err == nil {
		t.Fatal("same native node selected twice through different identities")
	}
	c = fixture()
	v = &c.Views[0]
	edge := v.Edges[0]
	edge.Element = "System::system::Supply"
	v.Edges = append(v.Edges, edge)
	if _, err := views.Render(source, *v); err == nil {
		t.Fatal("same native edge selected twice through different identities")
	}
}

func TestInvalidConfigCannotCreateModel(t *testing.T) {
	dir := t.TempDir()
	srv := httptest.NewServer(server.New(filepath.Join(dir, "workspace")).Handler())
	defer srv.Close()
	src, cfg := filepath.Join(dir, "Model.sysml"), filepath.Join(dir, "Model.views.json")
	put(t, src, []byte(source))
	c := fixture()
	c.Views[0].Edges[0].To = "A"
	cb, _ := json.Marshal(c)
	put(t, cfg, cb)
	invoke(t, 1, "import", "-url", srv.URL, "-in", src, "-views", cfg)
	res, err := http.Get(srv.URL + "/api/files/Model.sysml/download")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 404 {
		t.Fatal("invalid preflight still created model")
	}
}

func TestRenderCannotOverwriteSourceAlias(t *testing.T) {
	dir := t.TempDir()
	src, cfg, alias := filepath.Join(dir, "Model.sysml"), filepath.Join(dir, "Model.views.json"), filepath.Join(dir, "alias.svg")
	put(t, src, []byte(source))
	cb, _ := json.Marshal(fixture())
	put(t, cfg, cb)
	if err := os.Link(src, alias); err != nil {
		t.Skipf("hard link unavailable: %v", err)
	}
	invoke(t, 1, "render", "-in", src, "-views", cfg, "-view", "overall", "-out", alias)
	b, _ := os.ReadFile(src)
	if string(b) != source {
		t.Fatal("render overwrote original source")
	}
}
