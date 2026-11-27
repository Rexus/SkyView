package sysml

// parseFlow projects the bounded binary `flow name from feature to feature;`
// form. It preserves native flow identity and payload paths; it does not claim
// transfer execution, dimensional analysis or full flow grammar support.
func (p *parser) parseFlow(parent string, start Token) {
	short := p.shortName()
	name := ""
	span := Span{}
	if p.cur().Kind == TokIdent && !p.isIdent("from") {
		t := p.next()
		name = t.Text
		span = Span{t.Start, t.End}
	}
	if !p.accept("from") {
		p.unsupported(start, "only binary from/to flows are projected")
		p.skipDeclaration()
		return
	}
	source, sourceSpan := p.readPath()
	if !p.accept("to") {
		p.diag(SeverityError, "Expected 'to' in flow", p.cur(), parent)
		p.skipDeclaration()
		return
	}
	target, targetSpan := p.readPath()
	if name == "" {
		name = short
	}
	if name == "" {
		name = "flow"
	}
	e := p.behaviorElement(parent, start, "flow", name, span)
	e.ShortName = short
	e.Source = source
	e.SourceSpan = sourceSpan
	e.Target = target
	e.TargetSpan = targetSpan
	p.finishBehavior(e)
}
