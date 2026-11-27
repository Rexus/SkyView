package sysml

import "fmt"

type endpoint struct {
	path string
	span Span
}

func isRelationship(e *Element) bool {
	switch e.Kind {
	case "connection", "dependency", "satisfy", "verify", "message", "succession", "first":
		return true
	}
	return false
}

func isOccurrence(e *Element) bool {
	switch e.Kind {
	case "action", "state", "occurrence", "event occurrence", "message", "part", "item":
		return !e.IsDef
	}
	return false
}

func (p *parser) rememberPrevious(parent string, index int) {
	if index >= len(p.model.Elements) {
		return
	}
	e := p.model.Elements[index]
	if e.ParentID != parent {
		return
	}
	if isOccurrence(e) && e.Name != "" {
		p.previous[parent] = endpoint{e.Name, e.Spans.Name}
	} else if e.Kind == "entry" {
		p.previous[parent] = endpoint{"entry", Span{}}
	}
}

func (p *parser) behaviorElement(parent string, start Token, kind, name string, nameSpan Span) *Element {
	e := &Element{Kind: kind, Name: name, ParentID: parent, Line: start.Line, Col: start.Col,
		Spans: Spans{Name: nameSpan, Decl: Span{Start: start.Start}, BodyOpen: -1, BodyClose: -1}}
	key := name
	if key == "" {
		key = fmt.Sprintf("_%s_%d_%d", kind, start.Line, start.Col)
	}
	e.QName = qnameOf(p.model.ByID[parent], key)
	e.ID = e.QName
	return p.add(e)
}

func (p *parser) finishBehavior(e *Element) {
	if p.accept(";") {
		e.Spans.Decl.End = p.toks[p.pos-1].End
		return
	}
	if p.accept("{") {
		e.Spans.BodyOpen = p.toks[p.pos-1].Start
		p.parseMembers(e.ID, true)
		if p.toks[p.pos-1].Text == "}" {
			e.Spans.BodyClose = p.toks[p.pos-1].Start
		}
		e.Spans.Decl.End = p.toks[p.pos-1].End
		return
	}
	p.diag(SeverityError, "Expected ';' or a body after "+e.Kind, p.cur(), e.ID)
	p.skipDeclaration()
	e.Spans.Decl.End = p.toks[p.pos-1].End
}

func (p *parser) expectWord(word string, e *Element) bool {
	if p.accept(word) {
		return true
	}
	p.diag(SeverityError, "Expected '"+word+"' in "+e.Kind, p.cur(), e.ID)
	return false
}

func (p *parser) requiredPath(e *Element) (string, Span) {
	path, span := p.readPath()
	if path == "" {
		p.diag(SeverityError, "Expected a reference in "+e.Kind, p.cur(), e.ID)
	}
	return path, span
}

func (p *parser) parseMessage(parent string, start Token) {
	short := p.shortName()
	name, nameSpan := "", Span{}
	if p.cur().Kind == TokIdent && !p.isIdent("of") {
		t := p.next()
		name, nameSpan = t.Text, Span{t.Start, t.End}
	}
	e := p.behaviorElement(parent, start, "message", name, nameSpan)
	e.ShortName = short
	if !p.expectWord("of", e) {
		p.skipDeclaration()
		e.Spans.Decl.End = p.toks[p.pos-1].End
		return
	}
	e.Type, e.Spans.Type = p.requiredPath(e)
	if !p.expectWord("from", e) {
		p.skipDeclaration()
		e.Spans.Decl.End = p.toks[p.pos-1].End
		return
	}
	e.Source, e.SourceSpan = p.requiredPath(e)
	if !p.expectWord("to", e) {
		p.skipDeclaration()
		e.Spans.Decl.End = p.toks[p.pos-1].End
		return
	}
	e.Target, e.TargetSpan = p.requiredPath(e)
	p.finishBehavior(e)
}

func (p *parser) parseVerify(parent string, start Token) {
	e := p.behaviorElement(parent, start, "verify", "", Span{})
	e.Requirement, e.RequirementSpan = p.requiredPath(e)
	p.finishBehavior(e)
}

// A leading first establishes the succession source; then may reference an
// existing occurrence or introduce the next occurrence in the same scope.
func (p *parser) parseOrdering(parent string, start Token) {
	word := p.next().Text
	source := p.previous[parent]
	if word == "first" {
		source.path, source.span = p.readPath()
		if source.path == "" {
			p.diag(SeverityError, "Expected an occurrence after 'first'", p.cur(), parent)
		}
		if p.accept(";") {
			e := p.behaviorElement(parent, start, "first", "", Span{})
			e.Target, e.TargetSpan = source.path, source.span
			e.Spans.Decl.End = p.toks[p.pos-1].End
			p.previous[parent] = source
			return
		}
		if !p.accept("then") {
			p.diag(SeverityError, "Expected 'then' or ';' after 'first'", p.cur(), parent)
			p.skipDeclaration()
			return
		}
	}
	if source.path == "" {
		p.diag(SeverityError, "'then' has no preceding occurrence", start, parent)
	}
	target := endpoint{}
	inline := p.isIdent("action") || p.isIdent("event") || p.isIdent("occurrence") || p.isIdent("state") || p.isIdent("part") || p.isIdent("item")
	if inline {
		index := len(p.model.Elements)
		p.parseDeclaration(parent)
		if index < len(p.model.Elements) {
			next := p.model.Elements[index]
			target = endpoint{next.Name, next.Spans.Name}
			next.Spans.Decl.Start = start.Start
			if !isOccurrence(next) || next.Name == "" {
				p.unsupported(start, "ordered anonymous occurrences are not projected")
				p.diag(SeverityWarning, "Expected a named occurrence after 'then'", start, next.ID)
			}
		}
	} else {
		target.path, target.span = p.readPath()
		if target.path == "" {
			p.diag(SeverityError, "Expected an occurrence after 'then'", p.cur(), parent)
		}
	}
	e := p.behaviorElement(parent, start, "succession", "", Span{})
	e.Source, e.SourceSpan = source.path, source.span
	e.Target, e.TargetSpan = target.path, target.span
	e.Implicit = inline
	if inline {
		e.Spans.Decl.End = p.toks[p.pos-1].End
	} else {
		p.finishBehavior(e)
	}
	p.previous[parent] = target
}

func (p *parser) resolveBehavior() {
	for _, e := range p.model.Elements {
		scope := p.model.ByID[e.ParentID]
		switch e.Kind {
		case "message", "succession", "first":
			if e.Source != "" {
				e.SourceID, e.SourceNodeID = p.behaviorEndpoint(scope, e, e.Source, e.SourceSpan)
			}
			if e.Target != "" {
				e.TargetID, e.TargetNodeID = p.behaviorEndpoint(scope, e, e.Target, e.TargetSpan)
			}
			if e.Kind == "message" {
				if typ := p.model.ByID[e.TypeID]; typ != nil && (typ.Kind != "item" || !typ.IsDef) {
					p.diagAt(SeverityWarning, "Message payload must reference an item definition in the supported subset", e.Spans.Type.Start, e.ID)
				}
			}
		case "verify":
			if req, _ := p.resolveFeature(scope, e.Requirement); req != nil && req.Kind == "requirement" {
				e.RequirementID = req.ID
			} else {
				p.diagAt(SeverityWarning, "Unresolved verification requirement '"+e.Requirement+"'", e.RequirementSpan.Start, e.ID)
			}
		}
		if e.Kind == "constraint" && e.Expression != "" {
			p.checkExpression(e, e.Spans.Expression)
		}
		if e.Value != "" {
			p.checkExpression(e, e.Spans.Value)
			if ref, _ := p.resolveFeature(scope, e.Value); ref != nil {
				e.ValueID = ref.ID
			}
		}
	}
}

func (p *parser) behaviorEndpoint(scope, owner *Element, path string, span Span) (string, string) {
	if owner.Kind != "message" && scope != nil {
		if scope.Kind == "action" && (path == "start" || path == "done") {
			return "builtin:" + scope.ID + "::" + path, ""
		}
		if scope.Kind == "state" && path == "entry" {
			for _, e := range p.model.Children(scope.ID) {
				if e.Kind == "entry" {
					return e.ID, e.ID
				}
			}
		}
	}
	e, top := p.resolveFeature(scope, path)
	if e == nil {
		p.diagAt(SeverityWarning, "Unresolved "+owner.Kind+" endpoint '"+path+"'", span.Start, owner.ID)
		return "", ""
	}
	valid := isOccurrence(e)
	if owner.Kind == "message" {
		valid = e.Kind == "event occurrence"
	}
	if !valid {
		p.diagAt(SeverityWarning, "Invalid "+owner.Kind+" endpoint '"+path+"' ("+e.Kind+")", span.Start, owner.ID)
	}
	return e.ID, top.ID
}
