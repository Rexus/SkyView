package sysml

import "fmt"

// Unsupported identifies source preserved verbatim but omitted from the structured projection.
type Unsupported struct {
	Keyword string `json:"keyword"`
	Reason  string `json:"reason"`
	Line    int    `json:"line"`
	Column  int    `json:"column"`
}

func (p *parser) unsupported(t Token, reason string) {
	p.model.Unsupported = append(p.model.Unsupported, Unsupported{t.Text, reason, t.Line, t.Col})
}

func (p *parser) shortName() string {
	if !p.accept("<") {
		return ""
	}
	t := p.cur()
	if t.Kind != TokIdent {
		p.diag(SeverityError, "Expected a short name after '<'", t, "")
		return ""
	}
	p.next()
	if !p.accept(">") {
		p.diag(SeverityError, "Expected '>' after short name", p.cur(), "")
	}
	return t.Text
}

func (p *parser) parseDependency(parent string, start Token) {
	short := p.shortName()
	name := ""
	nameSpan := Span{}
	if p.cur().Kind == TokIdent && !p.isIdent("from") {
		t := p.next()
		name = t.Text
		nameSpan = Span{t.Start, t.End}
	}
	if !p.accept("from") {
		p.unsupported(start, "only binary from/to dependencies are projected")
		p.skipDeclaration()
		return
	}
	readUntil := func(stop string) (string, Span) {
		result := ""
		span := Span{p.cur().Start, p.cur().Start}
		for p.cur().Kind != TokEOF && (p.cur().Quoted || (p.cur().Text != stop && p.cur().Text != ";" && p.cur().Text != "}")) {
			t := p.next()
			span.End = t.End
			if !t.Quoted && t.Text == "," {
				p.unsupported(start, "multiple dependency endpoints are not projected")
			}
			result += t.Text
		}
		return result, span
	}
	source, sourceSpan := readUntil("to")
	if !p.accept("to") {
		p.diag(SeverityError, "Expected 'to' in dependency", p.cur(), parent)
		p.skipDeclaration()
		return
	}
	target, targetSpan := readUntil(";")
	end := p.cur().End
	if !p.accept(";") {
		p.diag(SeverityError, "Expected ';' after dependency", p.cur(), parent)
	}
	if name == "" {
		name = short
	}
	if name == "" {
		name = fmt.Sprintf("dependency_%d_%d", start.Line, start.Col)
	}
	e := &Element{Name: name, ShortName: short, Kind: "dependency", ParentID: parent, Source: source, Target: target, Line: start.Line, Col: start.Col,
		SourceSpan: sourceSpan, TargetSpan: targetSpan,
		Spans: Spans{Decl: Span{start.Start, end}, Name: nameSpan, BodyOpen: -1, BodyClose: -1}}
	e.QName = qnameOf(p.model.ByID[parent], name)
	e.ID = e.QName
	p.add(e)
}

// Select requires an unambiguous native short name or full qualified name.
func (m *Model) Select(key string) (*Element, error) {
	if key == "" {
		return nil, fmt.Errorf("empty model identity")
	}
	var found *Element
	for _, e := range m.Elements {
		if e.ShortName == key || e.QName == key {
			if found != nil && found.ID != e.ID {
				return nil, fmt.Errorf("ambiguous model identity %q", key)
			}
			found = e
		}
	}
	if found == nil {
		return nil, fmt.Errorf("model identity %q not found", key)
	}
	return found, nil
}
