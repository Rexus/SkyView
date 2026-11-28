package sysml

import (
	"fmt"
	"sort"
	"strings"
)

var modifierWords = map[string]bool{
	"ref": true, "in": true, "out": true, "inout": true, "abstract": true,
	"private": true, "public": true, "protected": true, "readonly": true,
	"derived": true, "end": true, "individual": true, "snapshot": true,
	"timeslice": true, "nonunique": true, "ordered": true, "constant": true,
}

var scalarTypes = map[string]bool{
	"String": true, "Integer": true, "Boolean": true, "Real": true,
	"Natural": true, "Complex": true, "Rational": true, "Number": true,
	"Anything": true, "Positive": true, "Negative": true,
	"UnlimitedNatural": true, "ScalarValues": true,
}

type parser struct {
	src            string
	toks           []Token
	pos            int
	model          *Model
	idCounts       map[string]int
	pendingDoc     string
	pendingDocSpan Span
	pendingDocDecl Span
	previous       map[string]endpoint
	imports        []scopedImport
}

// Parse parses a SysML v2 textual file. It is intentionally tolerant so that
// partially broken models can still be inspected and repaired in the UI.
func Parse(src string) *Model {
	p := &parser{
		src:      src,
		toks:     Lex(src),
		idCounts: map[string]int{},
		previous: map[string]endpoint{},
		model: &Model{
			RootID:      "root",
			RootName:    "root",
			Elements:    []*Element{},
			ByID:        map[string]*Element{},
			Diagnostics: []Diagnostic{},
			Content:     src,
		},
	}
	root := &Element{
		ID:    "root",
		Name:  "root",
		Kind:  "root",
		IsDef: true,
		QName: "",
		Line:  1,
		Col:   1,
		Spans: Spans{BodyOpen: -1, BodyClose: -1},
	}
	p.add(root)
	for _, t := range p.toks {
		if t.Error != "" {
			p.diag(SeverityError, t.Error, t, "")
		}
	}
	p.parseMembers(root.ID, false)
	p.semantic()
	return p.model
}

func (p *parser) cur() Token { return p.toks[p.pos] }

func (p *parser) peek(n int) Token {
	i := p.pos + n
	if i >= len(p.toks) {
		return p.toks[len(p.toks)-1]
	}
	return p.toks[i]
}

func (p *parser) next() Token {
	t := p.toks[p.pos]
	if p.pos < len(p.toks)-1 {
		p.pos++
	}
	return t
}

func (p *parser) accept(text string) bool {
	if !p.cur().Quoted && p.cur().Text == text {
		p.next()
		return true
	}
	return false
}

func (p *parser) acceptKind(kind TokenKind, text string) bool {
	t := p.cur()
	if t.Kind == kind && t.Text == text {
		p.next()
		return true
	}
	return false
}

func (p *parser) isIdent(text string) bool {
	t := p.cur()
	return t.Kind == TokIdent && !t.Quoted && t.Text == text
}

func (p *parser) add(e *Element) *Element {
	base := e.ID
	if n := p.idCounts[base]; n > 0 {
		e.ID = fmt.Sprintf("%s#%d", base, n+1)
	}
	p.idCounts[base]++
	p.model.Elements = append(p.model.Elements, e)
	p.model.ByID[e.ID] = e
	if e.ParentID != "" {
		if parent := p.model.ByID[e.ParentID]; parent != nil {
			parent.Children = append(parent.Children, e.ID)
		}
	}
	return e
}

func (p *parser) parseMembers(parentID string, expectBrace bool) {
	for {
		t := p.cur()
		if t.Kind == TokEOF {
			if expectBrace {
				p.diag(SeverityError, "Unclosed '{' — expected '}'", t, parentID)
			}
			return
		}
		if t.Kind == TokPunct && t.Text == "}" {
			if expectBrace {
				p.next()
				return
			}
			p.diag(SeverityError, "Unexpected '}'", t, parentID)
			p.next()
			continue
		}
		if t.Kind == TokPunct && t.Text == ";" {
			p.next()
			continue
		}
		if t.Kind == TokComment {
			p.next()
			continue
		}
		if t.Kind == TokIdent && t.Text == "doc" {
			p.parseDoc(parentID)
			continue
		}
		if t.Kind == TokIdent && (t.Text == "import" || t.Text == "private" || t.Text == "public" || t.Text == "protected") {
			// Imports may be preceded by visibility modifiers.
			if t.Text == "import" || p.peek(1).Text == "import" {
				p.parseImport(parentID)
				continue
			}
		}
		if t.Kind == TokIdent && t.Text == "comment" {
			p.skipDeclaration()
			continue
		}
		iterStart := p.pos
		firstElement := len(p.model.Elements)
		p.parseDeclaration(parentID)
		p.rememberPrevious(parentID, firstElement)
		if p.pos == iterStart {
			// Defensive: never spin on an unknown token.
			p.next()
		}
	}
}

func (p *parser) parseDoc(parentID string) {
	docTok := p.next() // doc
	t := p.cur()
	if !isComment(t) {
		p.diag(SeverityError, "'doc' must be followed by a block comment", t, parentID)
		return
	}
	p.next()
	text := DocText(t.Text)
	span := Span{Start: t.Start, End: t.End}
	decl := Span{Start: docTok.Start, End: t.End}

	parent := p.model.ByID[parentID]
	if parent != nil && parent.Doc == "" && len(parent.Children) == 0 {
		parent.Doc = text
		parent.Spans.Doc = span
		parent.Spans.DocDecl = decl
		parent.DocResolved = text
		return
	}
	p.pendingDoc = text
	p.pendingDocSpan = span
	p.pendingDocDecl = decl
}

func (p *parser) parseImport(parentID string) {
	start := p.pos
	for {
		t := p.cur()
		if t.Kind == TokEOF || t.Text == ";" || t.Text == "}" {
			break
		}
		p.next()
	}
	end := p.pos
	if end > start {
		raw := strings.TrimSpace(p.src[p.toks[start].Start:p.toks[end-1].End])
		p.model.Imports = append(p.model.Imports, raw)
		p.recordImport(parentID, p.toks[start:end])
	}
	if p.cur().Text == ";" {
		p.next()
	}
}

func (p *parser) skipDeclaration() {
	depth := 0
	for {
		t := p.cur()
		if t.Kind == TokEOF {
			return
		}
		switch t.Text {
		case "{":
			depth++
		case "}":
			if depth == 0 {
				return
			}
			depth--
			if depth == 0 {
				p.next()
				return
			}
		case ";":
			if depth == 0 {
				p.next()
				return
			}
		}
		p.next()
	}
}

func (p *parser) parseDeclaration(parentID string) {
	pendingDoc, pendingSpan, pendingDecl := p.pendingDoc, p.pendingDocSpan, p.pendingDocDecl
	p.pendingDoc, p.pendingDocSpan, p.pendingDocDecl = "", Span{}, Span{}

	startTok := p.cur()
	before := p.pos

	// Consume leading modifiers such as `ref`, `in`, `abstract`, `private`.
	direction := ""
	for p.cur().Kind == TokIdent && modifierWords[p.cur().Text] {
		w := p.next().Text
		if w == "in" || w == "out" || w == "inout" || w == "ref" {
			direction = w
		}
	}

	if p.cur().Kind != TokIdent {
		// Unknown token; report once and skip it.
		p.diag(SeverityWarning, fmt.Sprintf("Unexpected token %q", p.cur().Text), p.cur(), parentID)
		if p.pos == before {
			p.next()
		}
		return
	}

	keyword := p.cur().Text
	switch keyword {
	case "first", "then":
		p.parseOrdering(parentID, startTok)
		return
	case "message":
		p.next()
		p.parseMessage(parentID, startTok)
		return
	case "verify":
		p.next()
		p.parseVerify(parentID, startTok)
		return
	case "require", "assume":
		p.next()
		if !p.accept("constraint") {
			p.unsupported(startTok, "only inline constraint usages are projected")
			p.diag(SeverityWarning, "Expected a supported inline constraint", p.cur(), parentID)
			p.skipDeclaration()
			return
		}
		index := len(p.model.Elements)
		p.parseNamed(parentID, startTok, "constraint", direction, pendingDoc, pendingSpan, pendingDecl)
		p.model.Elements[index].ConstraintRole = keyword
		return
	case "event":
		p.next()
		if !p.accept("occurrence") {
			p.diag(SeverityError, "Expected 'occurrence' after 'event'", p.cur(), parentID)
			p.skipDeclaration()
			return
		}
		p.parseNamed(parentID, startTok, "event occurrence", direction, pendingDoc, pendingSpan, pendingDecl)
		return
	case "import":
		p.parseImport(parentID)
		return
	case "package":
		p.next() // package
		p.parsePackage(parentID, startTok, pendingDoc, pendingSpan, pendingDecl)
		return
	case "connection", "connect":
		if keyword == "connection" {
			p.next()
		}
		p.parseConnection(parentID, startTok, pendingDoc, pendingSpan, pendingDecl)
		return
	case "satisfy":
		p.next() // satisfy
		p.parseSatisfy(parentID, startTok)
		return
	case "flow":
		p.next()
		p.parseFlow(parentID, startTok)
		return
	case "dependency":
		p.next()
		p.parseDependency(parentID, startTok)
		return
	case "comment", "alias", "metadata", "view", "rendering", "concern":
		p.unsupported(startTok, "not yet projected by SkyView")
		p.skipDeclaration()
		return
	}

	p.next() // the declaration keyword
	if (keyword == "use" || keyword == "verification" || keyword == "analysis") && p.isIdent("case") {
		p.next()
		keyword += " case"
	}
	p.parseNamed(parentID, startTok, keyword, direction, pendingDoc, pendingSpan, pendingDecl)
}

func (p *parser) parsePackage(parentID string, startTok Token, doc string, docSpan, docDecl Span) {
	shortName := p.shortName()
	name := ""
	nameSpan := Span{}
	if p.cur().Kind == TokIdent {
		t := p.next()
		name = t.Text
		nameSpan = Span{Start: t.Start, End: t.End}
	} else {
		p.diag(SeverityError, "Expected a package name", p.cur(), parentID)
	}

	e := &Element{
		ID:        "",
		Name:      name,
		Kind:      "package",
		ShortName: shortName,
		IsDef:     true,
		ParentID:  parentID,
		Line:      startTok.Line,
		Col:       startTok.Col,
		Doc:       doc,
		Spans: Spans{
			Name:      nameSpan,
			Doc:       docSpan,
			DocDecl:   docDecl,
			BodyOpen:  -1,
			BodyClose: -1,
		},
	}
	e.QName = qnameOf(p.model.ByID[parentID], name)
	e.ID = e.QName
	p.add(e)

	if p.cur().Text == "{" {
		e.Spans.BodyOpen = p.cur().Start
		p.next()
		p.parseMembers(e.ID, true)
		if p.toks[p.pos-1].Text == "}" {
			e.Spans.BodyClose = p.toks[p.pos-1].Start
		}
		e.Spans.Decl = Span{Start: startTok.Start, End: p.toks[p.pos-1].End}
	} else if p.cur().Text == ";" {
		t := p.next()
		e.Spans.Decl = Span{Start: startTok.Start, End: t.End}
	} else {
		p.diag(SeverityWarning, "Expected '{' or ';' after package name", p.cur(), e.ID)
		e.Spans.Decl = Span{Start: startTok.Start, End: p.toks[p.pos-1].End}
	}
}

func (p *parser) parseNamed(parentID string, startTok Token, kind, direction, doc string, docSpan, docDecl Span) {
	isDef := false
	if p.isIdent("def") {
		p.next()
		isDef = true
	}
	shortName := p.shortName()

	name := ""
	nameSpan := Span{}
	if p.cur().Kind == TokIdent {
		t := p.next()
		name = t.Text
		nameSpan = Span{Start: t.Start, End: t.End}
	}

	e := &Element{
		ID:        "",
		Name:      name,
		Kind:      kind,
		ShortName: shortName,
		IsDef:     isDef,
		ParentID:  parentID,
		Line:      startTok.Line,
		Col:       startTok.Col,
		Doc:       doc,
		Direction: direction,
		Spans: Spans{
			Name:      nameSpan,
			Doc:       docSpan,
			DocDecl:   docDecl,
			BodyOpen:  -1,
			BodyClose: -1,
		},
	}
	e.QName = qnameOf(p.model.ByID[parentID], name)
	if name == "" {
		e.QName = qnameOf(p.model.ByID[parentID], fmt.Sprintf("_%s_%d_%d", kind, startTok.Line, startTok.Col))
		e.Name = ""
	}
	e.ID = e.QName
	p.add(e)

	// Type, specialisation, multiplicity, value and body in a forgiving order.
	for {
		t := p.cur()
		if t.Kind == TokEOF {
			break
		}
		switch {
		case t.Text == ":":
			p.next()
			typ, span := p.readPath()
			e.Type = typ
			e.Spans.Type = span
			if typ == "" {
				p.diag(SeverityError, "Expected a type after ':'", p.cur(), e.ID)
			}
		case t.Kind == TokIdent && (t.Text == "specializes" || t.Text == "specialises"):
			p.next()
			typ, span := p.readPath()
			e.Specializes = typ
			e.Spans.Specializes = span
			if typ == "" {
				p.diag(SeverityError, "Expected a type after 'specializes'", p.cur(), e.ID)
			}
			_ = span
		case t.Text == ":>>" || (t.Kind == TokIdent && t.Text == "redefines"):
			p.next()
			e.Redefines, e.RedefinitionSpan = p.readPath()
		case t.Kind == TokIdent && (t.Text == "subsets" || t.Text == "references" || t.Text == "crosses"):
			p.next()
			_, _ = p.readPath()
		case t.Text == "[":
			start := p.next().Start
			var b strings.Builder
			for p.cur().Kind != TokEOF && p.cur().Text != "]" {
				b.WriteString(p.cur().Text)
				p.next()
			}
			end := p.cur().Start
			if p.cur().Text == "]" {
				end = p.cur().End
				p.next()
			}
			e.Multiplicity = b.String()
			_ = start
			_ = end
		case t.Text == "=":
			p.next()
			value, span := p.readValue()
			e.Value = value
			e.Spans.Value = span
		case t.Text == "{":
			e.Spans.BodyOpen = t.Start
			p.next()
			if kind == "constraint" {
				p.parseConstraintBody(e)
			} else {
				p.parseMembers(e.ID, true)
			}
			if p.pos > 0 && p.toks[p.pos-1].Text == "}" {
				e.Spans.BodyClose = p.toks[p.pos-1].Start
			}
		case t.Text == ";":
			end := p.next().End
			e.Spans.Decl = Span{Start: startTok.Start, End: end}
			return
		case t.Text == "}":
			// Missing semicolon before a closing brace.
			e.Spans.Decl = Span{Start: startTok.Start, End: p.toks[p.pos-1].End}
			return
		default:
			// Unknown suffix: preserve source and expose the projection gap.
			p.unsupported(t, "declaration suffix not yet projected")
			p.diag(SeverityWarning, fmt.Sprintf("Skipping unexpected %q in declaration", t.Text), t, e.ID)
			p.skipDeclaration()
			e.Spans.Decl = Span{Start: startTok.Start, End: p.toks[p.pos-1].End}
			return
		}
		if p.pos > 0 && e.Spans.BodyClose >= 0 && p.toks[p.pos-1].Text == "}" {
			e.Spans.Decl = Span{Start: startTok.Start, End: p.toks[p.pos-1].End}
			return
		}
	}
	if e.Spans.Decl.End == 0 {
		e.Spans.Decl = Span{Start: startTok.Start, End: p.toks[p.pos-1].End}
	}
}

func (p *parser) readPath() (string, Span) {
	if p.cur().Kind != TokIdent {
		return "", Span{}
	}
	start := p.cur().Start
	var b strings.Builder
	b.WriteString(p.next().Text)
	end := p.toks[p.pos-1].End
	for p.cur().Text == "::" || p.cur().Text == "." {
		b.WriteString(p.next().Text)
		if p.cur().Kind != TokIdent {
			p.diag(SeverityError, "Expected a name after path separator", p.cur(), "")
			break
		}
		b.WriteString(p.next().Text)
		end = p.toks[p.pos-1].End
	}
	return b.String(), Span{Start: start, End: end}
}

func (p *parser) readValue() (string, Span) {
	start := p.cur().Start
	end := start
	depth := 0
	for {
		t := p.cur()
		if t.Kind == TokEOF {
			break
		}
		if depth == 0 && (t.Text == ";" || t.Text == "{" || t.Text == "}") {
			break
		}
		switch t.Text {
		case "(", "[", "{":
			depth++
		case ")", "]":
			if depth > 0 {
				depth--
			}
		case "}":
			if depth > 0 {
				depth--
			}
		}
		end = t.End
		p.next()
	}
	raw := strings.TrimSpace(p.src[start:end])
	return raw, Span{Start: start, End: end}
}

func (p *parser) parseConnection(parentID string, startTok Token, doc string, docSpan, docDecl Span) {
	shortName := p.shortName()
	name := ""
	nameSpan := Span{}
	if p.cur().Kind == TokIdent && !p.isIdent("connect") {
		t := p.next()
		name = t.Text
		nameSpan = Span{Start: t.Start, End: t.End}
	}
	if !p.isIdent("connect") {
		p.diag(SeverityError, "Expected 'connect' in connection", p.cur(), parentID)
		p.skipDeclaration()
		return
	}
	p.next()
	if t := p.cur(); t.Kind == TokPunct && t.Text == "(" {
		p.unsupported(startTok, "parenthesized connection ends are not projected")
		p.skipDeclaration()
		return
	}
	source := ""
	sourceSpan := Span{}
	for {
		t := p.cur()
		if t.Kind == TokEOF || !t.Quoted && (t.Text == ";" || t.Text == "{" || t.Text == "}" || t.Kind == TokIdent && t.Text == "to") {
			break
		}
		if sourceSpan.Start == 0 && sourceSpan.End == 0 {
			sourceSpan.Start = t.Start
		}
		sourceSpan.End = t.End
		source += t.Text
		p.next()
	}
	if !p.isIdent("to") {
		p.diag(SeverityError, "Expected 'to' in connection", p.cur(), parentID)
		p.skipDeclaration()
		return
	}
	p.next()
	target := ""
	targetSpan := Span{}
	for {
		t := p.cur()
		if t.Kind == TokEOF || !t.Quoted && (t.Text == ";" || t.Text == "{" || t.Text == "}") {
			break
		}
		if targetSpan.Start == 0 && targetSpan.End == 0 {
			targetSpan.Start = t.Start
		}
		targetSpan.End = t.End
		target += t.Text
		p.next()
	}

	e := &Element{
		ID:         "",
		Name:       name,
		Kind:       "connection",
		ShortName:  shortName,
		ParentID:   parentID,
		Line:       startTok.Line,
		Col:        startTok.Col,
		Doc:        doc,
		Source:     source,
		Target:     target,
		SourceSpan: sourceSpan,
		TargetSpan: targetSpan,
		Spans:      Spans{Name: nameSpan, Doc: docSpan, DocDecl: docDecl, BodyOpen: -1, BodyClose: -1},
	}
	if name == "" {
		e.Name = fmt.Sprintf("connection_%d_%d", startTok.Line, startTok.Col)
	}
	e.QName = qnameOf(p.model.ByID[parentID], e.Name)
	e.ID = e.QName
	p.add(e)

	if p.cur().Text == "{" {
		e.Spans.BodyOpen = p.cur().Start
		p.next()
		p.parseMembers(e.ID, true)
		if p.toks[p.pos-1].Text == "}" {
			e.Spans.BodyClose = p.toks[p.pos-1].Start
		}
		e.Spans.Decl = Span{Start: startTok.Start, End: p.toks[p.pos-1].End}
	} else if p.cur().Text == ";" {
		end := p.next().End
		e.Spans.Decl = Span{Start: startTok.Start, End: end}
	} else {
		e.Spans.Decl = Span{Start: startTok.Start, End: p.toks[p.pos-1].End}
	}
	if source == "" || target == "" {
		p.diag(SeverityError, "Connection is missing a source or target", startTok, e.ID)
	}
}

func (p *parser) parseSatisfy(parentID string, startTok Token) {
	requirement := ""
	requirementSpan := Span{}
	for {
		t := p.cur()
		if t.Kind == TokEOF || t.Text == ";" || t.Text == "{" || t.Text == "}" || (t.Kind == TokIdent && t.Text == "by") {
			break
		}
		if requirementSpan.Start == 0 && requirementSpan.End == 0 {
			requirementSpan.Start = t.Start
		}
		requirementSpan.End = t.End
		requirement += t.Text
		p.next()
	}
	if !p.isIdent("by") {
		p.diag(SeverityError, "Expected 'by' in satisfy", p.cur(), parentID)
		p.skipDeclaration()
		return
	}
	p.next()
	satisfier := ""
	satisfierSpan := Span{}
	for {
		t := p.cur()
		if t.Kind == TokEOF || t.Text == ";" || t.Text == "{" || t.Text == "}" {
			break
		}
		if satisfierSpan.Start == 0 && satisfierSpan.End == 0 {
			satisfierSpan.Start = t.Start
		}
		satisfierSpan.End = t.End
		satisfier += t.Text
		p.next()
	}

	e := &Element{
		ID:              "",
		Name:            fmt.Sprintf("satisfy_%d_%d", startTok.Line, startTok.Col),
		Kind:            "satisfy",
		ParentID:        parentID,
		Line:            startTok.Line,
		Col:             startTok.Col,
		Requirement:     requirement,
		Satisfier:       satisfier,
		RequirementSpan: requirementSpan,
		SatisfierSpan:   satisfierSpan,
		Spans:           Spans{BodyOpen: -1, BodyClose: -1},
	}
	e.QName = qnameOf(p.model.ByID[parentID], e.Name)
	e.ID = e.QName
	p.add(e)

	if p.cur().Text == "{" {
		e.Spans.BodyOpen = p.cur().Start
		p.next()
		p.parseMembers(e.ID, true)
		if p.toks[p.pos-1].Text == "}" {
			e.Spans.BodyClose = p.toks[p.pos-1].Start
		}
		e.Spans.Decl = Span{Start: startTok.Start, End: p.toks[p.pos-1].End}
	} else if p.cur().Text == ";" {
		end := p.next().End
		e.Spans.Decl = Span{Start: startTok.Start, End: end}
	} else {
		e.Spans.Decl = Span{Start: startTok.Start, End: p.toks[p.pos-1].End}
	}
}

func qnameOf(parent *Element, name string) string {
	if parent == nil || parent.QName == "" {
		return name
	}
	if name == "" {
		return parent.QName
	}
	return parent.QName + "::" + name
}

// semantic resolves references and records non-fatal diagnostics.
func (p *parser) semantic() {
	m := p.model
	// Redefinitions retain their own usage identity and inherit feature types.
	for _, e := range m.Elements {
		if e.Redefines != "" {
			if target := p.resolveRef(m.ByID[e.ParentID], e.Redefines); target != nil {
				e.RedefinedID = target.ID
			}
		}
	}
	// Resolve declared types first (connections/satisfies need TypeID).
	for _, e := range m.Elements {
		if e.Kind == "root" {
			continue
		}
		if e.Type != "" {
			e.TypeID = p.resolveType(e, e.Type)
			if e.TypeID == "" {
				p.diagRange(SeverityWarning, fmt.Sprintf("Unresolved type '%s'", e.Type), e.Spans.Type, e.ID)
			}
		}
		if e.Specializes != "" {
			e.SpecializesID = p.resolveType(e, e.Specializes)
			if e.SpecializesID == "" {
				p.diagRange(SeverityWarning, fmt.Sprintf("Unresolved specialisation '%s'", e.Specializes), e.Spans.Specializes, e.ID)
			}
		}
	}

	for _, e := range m.Elements {
		switch e.Kind {
		case "connection", "flow":
			scope := m.ByID[e.ParentID]
			src, srcTop := p.resolveFeature(scope, e.Source)
			dst, dstTop := p.resolveFeature(scope, e.Target)
			if src == nil {
				p.diagRange(SeverityWarning, fmt.Sprintf("Unresolved connection source '%s'", e.Source), e.SourceSpan, e.ID)
			} else {
				e.SourceID = src.ID
				if srcTop != nil {
					e.SourceNodeID = srcTop.ID
				} else {
					e.SourceNodeID = src.ID
				}
			}
			if dst == nil {
				p.diagRange(SeverityWarning, fmt.Sprintf("Unresolved connection target '%s'", e.Target), e.TargetSpan, e.ID)
			} else {
				e.TargetID = dst.ID
				if dstTop != nil {
					e.TargetNodeID = dstTop.ID
				} else {
					e.TargetNodeID = dst.ID
				}
			}
			// SysML connections may terminate at parts as well as ports.
		case "dependency":
			scope := m.ByID[e.ParentID]
			if src := p.resolveRef(scope, e.Source); src != nil {
				e.SourceID = src.ID
			}
			if dst := p.resolveRef(scope, e.Target); dst != nil {
				e.TargetID = dst.ID
			}
			if e.SourceID == "" {
				p.diagRange(SeverityWarning, "Unresolved dependency source '"+e.Source+"'", e.SourceSpan, e.ID)
			}
			if e.TargetID == "" {
				p.diagRange(SeverityWarning, "Unresolved dependency target '"+e.Target+"'", e.TargetSpan, e.ID)
			}
		case "satisfy":
			scope := m.ByID[e.ParentID]
			req, _ := p.resolveFeature(scope, e.Requirement)
			sat, _ := p.resolveFeature(scope, e.Satisfier)
			if req == nil {
				p.diagRange(SeverityWarning, fmt.Sprintf("Unresolved requirement '%s'", e.Requirement), e.RequirementSpan, e.ID)
			} else {
				e.RequirementID = req.ID
			}
			if sat == nil {
				p.diagRange(SeverityWarning, fmt.Sprintf("Unresolved satisfier '%s'", e.Satisfier), e.SatisfierSpan, e.ID)
			} else {
				e.SatisfierID = sat.ID
			}
		}
	}

	p.resolveBehavior()
	p.collectReferences()

	// Resolve requirement documentation through usage types.
	for _, e := range m.Elements {
		e.DocResolved = e.Doc
		if e.Kind == "requirement" && !e.IsDef && e.TypeID != "" {
			if def := m.ByID[e.TypeID]; def != nil && def.Doc != "" {
				e.DocResolved = def.Doc
			}
		}
	}

	// Duplicate names inside the same container.
	seen := map[string][]*Element{}
	for _, e := range m.Elements {
		if e.Kind == "root" || e.Name == "" || e.Kind == "satisfy" {
			continue
		}
		key := e.ParentID + "\x00" + e.Name
		seen[key] = append(seen[key], e)
	}
	for _, group := range seen {
		if len(group) > 1 {
			for _, e := range group[1:] {
				p.diagRange(SeverityWarning, fmt.Sprintf("Duplicate name '%s' in the same container", e.Name), e.Spans.Name, e.ID)
			}
		}
	}

	sort.SliceStable(m.Diagnostics, func(i, j int) bool {
		if m.Diagnostics[i].Line != m.Diagnostics[j].Line {
			return m.Diagnostics[i].Line < m.Diagnostics[j].Line
		}
		return m.Diagnostics[i].Column < m.Diagnostics[j].Column
	})
}

func (p *parser) findChild(parent *Element, name string) *Element {
	if parent == nil {
		return nil
	}
	for _, id := range parent.Children {
		if child := p.model.ByID[id]; child != nil && child.Name == name {
			return child
		}
	}
	return nil
}

// findInType looks for a feature on the usage's type definition, then on any
// specialisation chain (e.g. HAL inherits api from VoiceAssistant).
func (p *parser) findInType(cur *Element, name string) *Element {
	if cur == nil {
		return nil
	}
	seen := map[string]bool{}
	var walk func(*Element) *Element
	walk = func(e *Element) *Element {
		if e == nil || seen[e.ID] {
			return nil
		}
		seen[e.ID] = true
		for _, ref := range []string{e.TypeID, e.SpecializesID, e.RedefinedID} {
			if ref == "" {
				continue
			}
			if typ := p.model.ByID[ref]; typ != nil {
				if child := p.findChild(typ, name); child != nil {
					return child
				}
				if child := walk(typ); child != nil {
					return child
				}
			}
		}
		return nil
	}
	return walk(cur)
}

func lineCol(src string, offset int) (int, int) {
	if offset < 0 {
		offset = 0
	}
	if offset > len(src) {
		offset = len(src)
	}
	line, col := 1, 1
	for i := 0; i < offset; i++ {
		if src[i] == '\n' {
			line++
			col = 1
		} else {
			col++
		}
	}
	return line, col
}
