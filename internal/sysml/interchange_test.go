package sysml

import "testing"

func TestNativeIdentitiesAndDependencies(t *testing.T) {
	src := `package <'P'> System { part <'SYS'> system { part <'A'> 'Consumer'; ref part <'B'> 'Provider'; dependency <'D'> 'Supply' from 'Consumer' to 'Provider'; } use case def <'UC'> 'Acquire software'; view overview : Unknown; }`
	m := Parse(src)
	for _, key := range []string{"P", "SYS", "A", "B", "D", "UC"} {
		if _, err := m.Select(key); err != nil {
			t.Fatal(err)
		}
	}
	d, _ := m.Select("D")
	a, _ := m.Select("A")
	b, _ := m.Select("B")
	if d.SourceID != a.ID || d.TargetID != b.ID {
		t.Fatalf("wrong endpoints: %+v", d)
	}
	uc, _ := m.Select("UC")
	if uc.Kind != "use case" || !uc.IsDef {
		t.Fatal("use case declaration not recognized")
	}
	if len(m.Unsupported) == 0 || m.Content != src {
		t.Fatal("unsupported content was not retained and reported")
	}
}
func TestAmbiguousShortName(t *testing.T) {
	m := Parse(`package A { part <'same'> a; } package B { part <'same'> b; }`)
	if _, err := m.Select("same"); err == nil {
		t.Fatal("ambiguous short name accepted")
	}
}
