package sysml

import (
	"strconv"
	"strings"
)

// Constraint bodies are expressions, not nested declarations. Preserve their
// exact text and byte span for inspection and reference-aware source edits.
func (p *parser) parseConstraintBody(e *Element) {
	for p.cur().Kind == TokComment || p.isIdent("doc") {
		if p.isIdent("doc") {
			p.parseDoc(e.ID)
		} else {
			p.next()
		}
	}
	start, end := p.cur().Start, p.cur().Start
	for p.cur().Kind != TokEOF && p.cur().Text != "}" {
		end = p.next().End
	}
	e.Expression = strings.TrimSpace(p.src[start:end])
	e.Spans.Expression = Span{start, end}
	if e.Expression == "" {
		p.diag(SeverityError, "Expected a constraint expression", p.cur(), e.ID)
	}
	if !p.accept("}") {
		p.diag(SeverityError, "Unclosed constraint body", p.cur(), e.ID)
	}
}

// This expression parser covers literals, feature references, parentheses,
// unary not/signs, arithmetic, comparisons, boolean operators and SI seconds.
// It checks shape and references, but does not execute or prove a constraint.
type expressionParser struct {
	p           *parser
	e           *Element
	scope       *Element
	tokens      []Token
	pos, offset int
	failed      bool
}

func (p *parser) checkExpression(e *Element, span Span) {
	if span.End <= span.Start {
		return
	}
	x := &expressionParser{p: p, e: e, scope: e, offset: span.Start}
	for _, t := range Lex(p.src[span.Start:span.End]) {
		if t.Kind != TokComment {
			x.tokens = append(x.tokens, t)
		}
	}
	category := x.expression(0)
	if x.cur().Kind != TokEOF && !x.failed {
		x.unsupported("Expression form is not yet supported")
	}
	if e.Kind == "constraint" && category != "Boolean" && category != "Unknown" && !x.failed {
		x.problem("Constraint expression must be Boolean")
	}
}

func (x *expressionParser) cur() Token { return x.tokens[x.pos] }
func (x *expressionParser) next() Token {
	t := x.cur()
	if x.pos < len(x.tokens)-1 {
		x.pos++
	}
	return t
}
func (x *expressionParser) accept(s string) bool {
	if !x.cur().Quoted && x.cur().Text == s {
		x.next()
		return true
	}
	return false
}
func (x *expressionParser) problem(message string) {
	severity := SeverityWarning
	if strings.HasPrefix(message, "Expected ") || message == "Invalid numeric literal" {
		severity = SeverityError
	}
	x.p.diagAt(severity, message, x.offset+x.cur().Start, x.e.ID)
	x.failed = true
}
func (x *expressionParser) unsupported(message string) {
	t := x.cur()
	t.Line, t.Col = lineCol(x.p.src, x.offset+t.Start)
	x.p.unsupported(t, message)
	x.problem(message)
}

func precedence(op string) int {
	switch op {
	case "or", "xor", "|":
		return 1
	case "and", "&":
		return 2
	case "==", "!=":
		return 3
	case "<", "<=", ">", ">=":
		return 4
	case "+", "-":
		return 5
	case "*", "/", "%":
		return 6
	}
	return -1
}

func (x *expressionParser) expression(min int) string {
	left := x.primary()
	for !x.failed && precedence(x.cur().Text) >= min {
		op := x.next().Text
		right := x.expression(precedence(op) + 1)
		switch op {
		case "or", "xor", "and", "|", "&":
			if (left != "Boolean" && left != "Unknown") || (right != "Boolean" && right != "Unknown") {
				x.problem("Boolean operator requires Boolean operands")
			}
			left = "Boolean"
		case "==", "!=", "<", "<=", ">", ">=":
			if left != right && left != "Unknown" && right != "Unknown" {
				x.problem("Incompatible comparison operands")
			}
			left = "Boolean"
		default:
			if left == "Boolean" || right == "Boolean" || left == "String" || right == "String" {
				x.problem("Arithmetic operator requires numeric operands")
			}
		}
	}
	return left
}

func (x *expressionParser) primary() string {
	t := x.cur()
	if x.accept("not") || x.accept("!") {
		kind := x.expression(7)
		if kind != "Boolean" && kind != "Unknown" {
			x.problem("'not' requires a Boolean operand")
		}
		return "Boolean"
	}
	if x.accept("+") || x.accept("-") {
		kind := x.expression(7)
		if kind != "Number" && kind != "Duration" && kind != "Unknown" {
			x.problem("Unary sign requires a numeric operand")
		}
		return kind
	}
	if x.accept("(") {
		kind := x.expression(0)
		if !x.accept(")") {
			x.problem("Expected ')' in expression")
		}
		return kind
	}
	if t.Kind == TokNumber {
		x.next()
		if _, err := strconv.ParseFloat(t.Text, 64); err != nil {
			x.problem("Invalid numeric literal")
		}
		if x.accept("[") {
			unit, _ := x.path()
			if unit != "SI::s" {
				x.unsupported("Unresolved or unsupported unit '" + unit + "'")
			}
			if !x.accept("]") {
				x.problem("Expected ']' after quantity unit")
			}
			return "Duration"
		}
		return "Number"
	}
	if t.Kind == TokString {
		x.next()
		return "String"
	}
	if x.accept("true") || x.accept("false") {
		return "Boolean"
	}
	if t.Kind == TokIdent {
		if !t.Quoted && precedence(t.Text) >= 0 {
			x.problem("Expected an expression operand")
			x.next()
			return "Unknown"
		}
		path, span := x.path()
		x.p.referencePath(x.scope, span)
		ref, _ := x.p.resolveFeature(x.scope, path)
		if ref == nil {
			x.p.diagAt(SeverityWarning, "Unresolved expression reference '"+path+"'", span.Start, x.e.ID)
			return "Unknown"
		}
		return expressionType(ref.TypeID)
	}
	x.problem("Expected an expression operand")
	x.next()
	return "Unknown"
}

func (x *expressionParser) path() (string, Span) {
	start := x.cur().Start
	if x.cur().Kind != TokIdent {
		x.problem("Expected a name in expression")
		return "", Span{}
	}
	path := x.next().Text
	end := x.tokens[x.pos-1].End
	for x.cur().Text == "::" || x.cur().Text == "." {
		path += x.next().Text
		if x.cur().Kind != TokIdent {
			x.problem("Expected a name after path separator")
			break
		}
		path += x.next().Text
		end = x.tokens[x.pos-1].End
	}
	return path, Span{x.offset + start, x.offset + end}
}

func expressionType(id string) string {
	if !strings.HasPrefix(id, "builtin:") {
		return "Unknown"
	}
	name := tailName(strings.TrimPrefix(id, "builtin:"))
	switch name {
	case "Boolean", "String":
		return name
	case "DurationValue":
		return "Duration"
	case "Integer", "Real", "Natural", "Rational", "Number", "Positive", "Negative", "UnlimitedNatural":
		return "Number"
	}
	return "Unknown"
}
