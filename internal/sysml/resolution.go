package sysml

import "strings"

type scopedImport struct {
	parent, path string
	wildcard     bool
}

func (p *parser) recordImport(parent string, toks []Token) {
	i := 0
	for i < len(toks) && toks[i].Text != "import" {
		i++
	}
	var b strings.Builder
	for i++; i < len(toks); i++ {
		b.WriteString(toks[i].Text)
	}
	path := b.String()
	wildcard := strings.HasSuffix(path, "::*")
	if wildcard {
		path = strings.TrimSuffix(path, "::*")
	}
	p.imports = append(p.imports, scopedImport{parent, path, wildcard})
}

// Resolve in lexical scope, then explicitly imported namespaces. Never guess
// from a matching suffix elsewhere in the model: it can link unrelated systems.
func (p *parser) resolveRef(scope *Element, path string) *Element {
	if path == "" {
		return nil
	}
	for owner := scope; owner != nil; owner = p.model.ByID[owner.ParentID] {
		if e := p.uniqueQName(qnameOf(owner, path)); e != nil {
			return e
		}
		var found *Element
		for _, imp := range p.imports {
			if imp.parent != owner.ID {
				continue
			}
			candidate := ""
			if imp.wildcard {
				candidate = imp.path + "::" + path
			} else if tailName(imp.path) == strings.Split(path, "::")[0] {
				candidate = strings.TrimSuffix(imp.path, tailName(imp.path)) + path
			}
			if candidate == "" {
				continue
			}
			// Import paths may themselves be relative to their lexical owner.
			for base := owner; base != nil; base = p.model.ByID[base.ParentID] {
				if e := p.uniqueQName(qnameOf(base, candidate)); e != nil {
					if found != nil && found.ID != e.ID {
						return nil
					}
					found = e
					break
				}
			}
		}
		if found != nil {
			return found
		}
	}
	return nil
}

func tailName(path string) string {
	parts := strings.Split(path, "::")
	return parts[len(parts)-1]
}

func (p *parser) uniqueQName(path string) *Element {
	var found *Element
	for _, e := range p.model.Elements {
		if e.QName == path {
			if found != nil {
				return nil
			}
			found = e
		}
	}
	return found
}

// The lightweight projection recognizes a finite library subset. Full library
// semantics remain the responsibility of a native SysML validator.
func libraryType(path string) bool {
	if strings.HasPrefix(path, "ScalarValues::") {
		return scalarTypes[strings.TrimPrefix(path, "ScalarValues::")]
	}
	return path == "ISQ::DurationValue"
}

func (p *parser) resolveType(e *Element, path string) string {
	if ref := p.resolveRef(p.model.ByID[e.ParentID], path); ref != nil {
		return ref.ID
	}
	if libraryType(path) || scalarTypes[path] {
		return "builtin:" + path
	}
	for scope := e; scope != nil; scope = p.model.ByID[scope.ParentID] {
		for _, imp := range p.imports {
			if imp.parent != scope.ID {
				continue
			}
			candidate := imp.path
			if imp.wildcard {
				candidate += "::" + path
			} else if tailName(candidate) != path {
				continue
			}
			if libraryType(candidate) {
				return "builtin:" + candidate
			}
		}
	}
	return ""
}

// Only the first path segment may use lexical lookup. Every subsequent member
// must belong to that feature or its type, not to an unrelated outer namespace.
func (p *parser) resolveFeature(scope *Element, path string) (*Element, *Element) {
	parts := strings.Split(path, ".")
	if len(parts) == 0 || scope == nil {
		return nil, nil
	}
	cur := p.resolveRef(scope, parts[0])
	if cur == nil {
		cur = p.findInType(scope, parts[0])
	}
	top := cur
	for _, name := range parts[1:] {
		if cur == nil {
			return nil, top
		}
		next := p.findChild(cur, name)
		if next == nil {
			next = p.findInType(cur, name)
		}
		cur = next
	}
	return cur, top
}

func (p *parser) collectReferences() {
	for _, e := range p.model.Elements {
		scope := p.model.ByID[e.ParentID]
		for _, span := range []Span{e.Spans.Type, e.Spans.Specializes, e.SourceSpan, e.TargetSpan, e.RequirementSpan, e.SatisfierSpan} {
			p.referencePath(scope, span)
		}
	}
}

func (p *parser) referencePath(scope *Element, span Span) {
	if span.End <= span.Start {
		return
	}
	tokens := Lex(p.src[span.Start:span.End])
	path := ""
	for _, t := range tokens {
		if t.Kind == TokEOF {
			break
		}
		path += t.Text
		if t.Kind != TokIdent {
			continue
		}
		if ref, _ := p.resolveFeature(scope, path); ref != nil {
			p.model.References = append(p.model.References, Reference{Span{span.Start + t.Start, span.Start + t.End}, ref.ID})
		}
	}
}
