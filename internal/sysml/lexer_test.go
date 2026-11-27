package sysml

import "testing"

func TestQuotedIdentifiersAndUnicode(t *testing.T) {
	src := `package <'SYS-test'> 'Test System' {
    part def 'Pilot\'s \\ station';
    part 'then' : 'Pilot\'s \\ station';
    part café : 'Pilot\'s \\ station';
    dependency from 'then' to café;
}`
	m := Parse(src)
	requireClean(t, m)
	system, err := m.Select("SYS-test")
	if err != nil || system.Name != "Test System" {
		t.Fatalf("short/name: %+v %v", system, err)
	}
	pilot := m.Element("Test System::Pilot's \\ station")
	if pilot == nil {
		t.Fatal("quoted identifier not decoded")
	}
	if src[pilot.Spans.Name.Start:pilot.Spans.Name.End] != `'Pilot\'s \\ station'` {
		t.Fatal("lost source range")
	}
	for _, e := range m.Elements {
		if e.Type != "" && e.TypeID != pilot.ID {
			t.Errorf("quoted type unresolved: %+v", e)
		}
	}
	for _, broken := range []string{`package 'missing {}`, `package P { attribute x = "missing; }`} {
		found := false
		for _, d := range Parse(broken).Diagnostics {
			if d.Severity == SeverityError {
				found = true
			}
		}
		if !found {
			t.Errorf("unterminated literal accepted: %s", broken)
		}
	}
	tokens := Lex(`:>>`)
	if tokens[0].Text != ":>>" {
		t.Fatal("redefinition operator split")
	}
}
