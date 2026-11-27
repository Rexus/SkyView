// Package cli provides source-preserving exchange and deterministic offline rendering.
package cli

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/Rexus/SkyView/internal/sysml"
	"github.com/Rexus/SkyView/internal/views"
)

func Run(args []string, out, errOut io.Writer) int {
	if err := run(args, out, errOut); err != nil {
		fmt.Fprintln(errOut, err)
		return 1
	}
	return 0
}
func run(args []string, out, errOut io.Writer) error {
	if len(args) == 0 {
		return fmt.Errorf("commands: inspect, render, import, export (use -h for flags)")
	}
	cmd := args[0]
	f := flag.NewFlagSet(cmd, flag.ContinueOnError)
	f.SetOutput(errOut)
	in := f.String("in", "", "UTF-8 SysML source file")
	dest := f.String("out", "", "output file (export refuses overwrite)")
	config := f.String("views", "", "versioned shared-view JSON file")
	view := f.String("view", "", "selected shared view ID")
	viewsOut := f.String("views-out", "", "export shared-view JSON to this new file")
	name := f.String("name", "", "workspace .sysml filename")
	base := f.String("url", "http://127.0.0.1:8081", "SkyView server URL")
	check := f.Bool("check", false, "render: fail if the output differs, without writing")
	if err := f.Parse(args[1:]); err != nil {
		if err == flag.ErrHelp {
			return nil
		}
		return err
	}
	if f.NArg() != 0 {
		return fmt.Errorf("unexpected positional arguments")
	}
	switch cmd {
	case "inspect", "render", "import":
		b, err := readSource(*in)
		if err != nil {
			return err
		}
		if cmd == "inspect" {
			m := sysml.Parse(string(b))
			return json.NewEncoder(out).Encode(map[string]any{"sourceSHA256": fmt.Sprintf("%x", sha256.Sum256(b)), "bytes": len(b), "projectedElements": len(m.Elements), "diagnostics": m.Diagnostics, "unsupported": m.Unsupported, "validation": "partial SkyView projection; not native SysML conformance validation"})
		}
		var c *views.Config
		var cb []byte
		if *config != "" {
			cb, err = os.ReadFile(*config)
			if err != nil {
				return err
			}
			c, err = views.Parse(cb)
			if err != nil {
				return err
			}
		}
		if cmd == "render" {
			if c == nil || *view == "" || *dest == "" {
				return fmt.Errorf("render requires -in, -views, -view and -out")
			}
			v, err := c.Find(*view)
			if err != nil {
				return err
			}
			svg, err := views.Render(string(b), v)
			if err != nil {
				return err
			}
			if *check {
				old, err := os.ReadFile(*dest)
				if err != nil {
					return err
				}
				if !bytes.Equal(old, svg) {
					return fmt.Errorf("SVG is stale: %s", *dest)
				}
				fmt.Fprintln(out, "SVG is current")
				return nil
			}
			if sameFile(*dest, *in) || sameFile(*dest, *config) {
				return fmt.Errorf("output must not replace its inputs")
			}
			if err = os.WriteFile(*dest, svg, 0o644); err != nil {
				return err
			}
			fmt.Fprintln(out, *dest)
			return nil
		}
		// Preflight every selected view before creating any remote model.
		if c != nil {
			for _, v := range c.Views {
				if _, err = views.Render(string(b), v); err != nil {
					return err
				}
			}
		}
		if *name == "" {
			*name = filepath.Base(*in)
		}
		if err = validName(*name); err != nil {
			return err
		}
		endpoint := strings.TrimRight(*base, "/") + "/api/files/" + url.PathEscape(*name)
		current, status, err := request("GET", endpoint+"/download", nil, "")
		if err != nil {
			return err
		}
		if status == 404 {
			payload, _ := json.Marshal(map[string]string{"name": *name, "content": string(b)})
			_, status, err = request("POST", strings.TrimRight(*base, "/")+"/api/files", payload, "")
			if err != nil {
				return err
			}
			if status != 201 {
				return fmt.Errorf("import failed (HTTP %d)", status)
			}
		} else if status != 200 {
			return fmt.Errorf("read failed (HTTP %d)", status)
		} else if !bytes.Equal(current, b) {
			return fmt.Errorf("workspace source differs; export and reconcile it before importing as a new revision")
		}
		if c != nil {
			hash := fmt.Sprintf("%x", sha256.Sum256(b))
			body, status, err := request("PUT", endpoint+"/views", cb, hash[:16])
			if err != nil {
				return err
			}
			if status != 200 {
				return fmt.Errorf("source imported; view publication failed (HTTP %d): %s", status, body)
			}
		}
		fmt.Fprintf(out, "Imported %s (%d bytes); existing source must match exactly\n", *name, len(b))
		return nil
	case "export":
		if *name == "" || *dest == "" {
			return fmt.Errorf("export requires -name and -out")
		}
		if err := validName(*name); err != nil {
			return err
		}
		for _, p := range []string{*dest, *viewsOut} {
			if p != "" {
				if _, err := os.Stat(p); err == nil {
					return fmt.Errorf("refusing to overwrite %s", p)
				} else if !os.IsNotExist(err) {
					return err
				}
			}
		}
		if *viewsOut != "" && filepath.Clean(*viewsOut) == filepath.Clean(*dest) {
			return fmt.Errorf("model and view outputs must differ")
		}
		endpoint := strings.TrimRight(*base, "/") + "/api/files/" + url.PathEscape(*name)
		b, status, err := request("GET", endpoint+"/download", nil, "")
		if err != nil {
			return err
		}
		if status != 200 {
			return fmt.Errorf("export failed (HTTP %d)", status)
		}
		var cb []byte
		if *viewsOut != "" {
			cb, status, err = request("GET", endpoint+"/views", nil, "")
			if err != nil {
				return err
			}
			if status != 200 {
				return fmt.Errorf("view export failed (HTTP %d)", status)
			}
		}
		if err = writeNew(*dest, b); err != nil {
			return err
		}
		if *viewsOut != "" {
			if err = writeNew(*viewsOut, cb); err != nil {
				return fmt.Errorf("model exported, but views failed: %w", err)
			}
		}
		fmt.Fprintf(out, "Exported %s (%d bytes, SHA-256 %x)\n", *name, len(b), sha256.Sum256(b))
		return nil
	default:
		return fmt.Errorf("unknown command %q; use inspect, render, import or export", cmd)
	}
}
func readSource(p string) ([]byte, error) {
	if p == "" {
		return nil, fmt.Errorf("-in is required")
	}
	b, err := os.ReadFile(p)
	if err != nil {
		return nil, err
	}
	if len(b) > 16<<20 || !utf8.Valid(b) {
		return nil, fmt.Errorf("source must be UTF-8 and at most 16 MiB")
	}
	return b, nil
}
func validName(s string) error {
	if !strings.HasSuffix(s, ".sysml") || strings.HasPrefix(s, ".") || len(s) > 120 {
		return fmt.Errorf("invalid .sysml filename")
	}
	for _, r := range s {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || strings.ContainsRune("._-", r)) {
			return fmt.Errorf("invalid .sysml filename")
		}
	}
	return nil
}
func writeNew(p string, b []byte) error {
	f, err := os.OpenFile(p, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	_, err = f.Write(b)
	closeErr := f.Close()
	if err != nil {
		return err
	}
	return closeErr
}
func request(method, endpoint string, b []byte, revision string) ([]byte, int, error) {
	req, err := http.NewRequest(method, endpoint, bytes.NewReader(b))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Content-Type", "application/json")
	if revision != "" {
		req.Header.Set("If-Match", revision)
	}
	client := &http.Client{Timeout: 30 * time.Second}
	res, err := client.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 32<<20))
	return body, res.StatusCode, err
}

// Resolve spelling and existing-file aliases before rendering over an output.
func sameFile(a, b string) bool {
	aa, errA := filepath.Abs(a)
	bb, errB := filepath.Abs(b)
	if errA == nil && errB == nil && aa == bb {
		return true
	}
	af, errA := os.Stat(a)
	bf, errB := os.Stat(b)
	return errA == nil && errB == nil && os.SameFile(af, bf)
}
