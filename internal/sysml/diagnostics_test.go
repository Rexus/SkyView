package sysml

import (
	"strings"
	"testing"
)

func TestDiagnosticTokenRangesAndHints(t *testing.T) {
	cases := []struct{ name, source, message, token string }{
		{"missing type", "package P { part p : ; }", "Expected a type", ";"},
		{"unicode qualified type", "// Å 🛰\r\npackage P { part 'Båt' : Ghost::Vehicle; }", "Unresolved type", "Ghost::Vehicle"},
		{"connection target", "package P { part a; connection c connect a to missing; }", "Unresolved connection target", "missing"},
		{"dependency source", "package P { part a; dependency d from missing to a; }", "Unresolved dependency source", "missing"},
		{"duplicate", "package P { part a; part a; }", "Duplicate name", "a"},
		{"short name", "package P { part <'ID' p; }", "Expected '>'", "p"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			m := Parse(c.source)
			for _, d := range m.Diagnostics {
				if strings.Contains(d.Message, c.message) {
					if d.Range == nil || d.Range.Start < 0 || d.Range.End > len(c.source) {
						t.Fatalf("missing or invalid range: %+v", d)
					}
					if got := c.source[d.Range.Start:d.Range.End]; got != c.token {
						t.Fatalf("marked %q instead of %q", got, c.token)
					}
					if d.Hint == "" {
						t.Fatal("missing suggested review/fix")
					}
					return
				}
			}
			t.Fatalf("missing diagnostic %q: %+v", c.message, m.Diagnostics)
		})
	}
}

func TestEOFDiagnosticIsAnInsertionPoint(t *testing.T) {
	src := "package P {\n"
	m := Parse(src)
	for _, d := range m.Diagnostics {
		if strings.Contains(d.Message, "Unclosed '{'") {
			if d.Range == nil || d.Range.Start != len(src) || d.Range.End != len(src) {
				t.Fatalf("wrong EOF range: %+v", d)
			}
			return
		}
	}
	t.Fatal("missing unclosed-container diagnostic")
}
