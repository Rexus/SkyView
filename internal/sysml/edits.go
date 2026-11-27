package sysml

import (
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// Edit replaces bytes [Start, End) with Text.
type Edit struct {
	Start int
	End   int
	Text  string
}

var identRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
var typeRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*(::[A-Za-z_][A-Za-z0-9_]*)*$`)
var pathRe = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*(::[A-Za-z_][A-Za-z0-9_]*)?(\.[A-Za-z_][A-Za-z0-9_]*)*$`)

// ApplyEdits applies non-overlapping edits to src.
func ApplyEdits(src string, edits []Edit) (string, error) {
	if len(edits) == 0 {
		return src, nil
	}
	sort.Slice(edits, func(i, j int) bool { return edits[i].Start < edits[j].Start })
	prevEnd := 0
	for _, e := range edits {
		if e.Start < 0 || e.End < e.Start || e.End > len(src) {
			return "", fmt.Errorf("invalid edit range [%d,%d)", e.Start, e.End)
		}
		if e.Start < prevEnd {
			return "", fmt.Errorf("overlapping edits at byte %d", e.Start)
		}
		prevEnd = e.End
	}
	var b strings.Builder
	last := 0
	for _, e := range edits {
		b.WriteString(src[last:e.Start])
		b.WriteString(e.Text)
		last = e.End
	}
	b.WriteString(src[last:])
	return b.String(), nil
}

// RenameElement changes an element's name and updates obvious references.
func RenameElement(src string, m *Model, id, newName string) (string, error) {
	e := m.Element(id)
	if e == nil {
		return "", fmt.Errorf("element not found")
	}
	if e.Kind == "root" {
		return "", fmt.Errorf("the root cannot be renamed")
	}
	if !identRe.MatchString(newName) {
		return "", fmt.Errorf("invalid SysML identifier %q", newName)
	}
	if e.Spans.Name.Start == e.Spans.Name.End {
		return "", fmt.Errorf("element has no name in the source")
	}
	edits := []Edit{{Start: e.Spans.Name.Start, End: e.Spans.Name.End, Text: newName}}
	seen := map[Span]bool{e.Spans.Name: true}
	for _, ref := range m.References {
		if ref.ElementID == e.ID && !seen[ref.Span] {
			edits = append(edits, Edit{Start: ref.Span.Start, End: ref.Span.End, Text: newName})
			seen[ref.Span] = true
		}
	}
	return ApplyEdits(src, edits)
}

// SetType sets or removes an element's type.
func SetType(src string, m *Model, id, typ string) (string, error) {
	e := m.Element(id)
	if e == nil {
		return "", fmt.Errorf("element not found")
	}
	if isRelationship(e) || e.Kind == "root" || e.Kind == "package" || e.Kind == "constraint" || e.Kind == "entry" {
		return "", fmt.Errorf("cannot set a type on a %s", e.Kind)
	}
	typ = strings.TrimSpace(typ)
	if typ != "" && !typeRe.MatchString(typ) {
		return "", fmt.Errorf("invalid type %q", typ)
	}
	if typ == "" {
		if e.Spans.Type.Start < e.Spans.Type.End {
			// Remove the colon too, when present.
			start := e.Spans.Type.Start
			for start > 0 && (src[start-1] == ' ' || src[start-1] == '\t') {
				start--
			}
			if start > 0 && src[start-1] == ':' {
				start--
			}
			return ApplyEdits(src, []Edit{{Start: start, End: e.Spans.Type.End, Text: ""}})
		}
		return src, nil
	}
	if e.Spans.Type.Start < e.Spans.Type.End {
		return ApplyEdits(src, []Edit{{Start: e.Spans.Type.Start, End: e.Spans.Type.End, Text: typ}})
	}
	insert := e.Spans.Name.End
	if insert == 0 {
		return "", fmt.Errorf("element has no name anchor")
	}
	return ApplyEdits(src, []Edit{{Start: insert, End: insert, Text: " : " + typ}})
}

// SetValue sets or removes a feature value (attributes, constants, ...).
func SetValue(src string, m *Model, id, value string) (string, error) {
	e := m.Element(id)
	if e == nil {
		return "", fmt.Errorf("element not found")
	}
	if isRelationship(e) || e.Kind == "root" || e.Kind == "package" || e.Kind == "constraint" || e.Kind == "entry" {
		return "", fmt.Errorf("cannot set a value on a %s", e.Kind)
	}
	value = strings.TrimSpace(value)
	if strings.ContainsAny(value, "\n;") || strings.Contains(value, "*/") {
		return "", fmt.Errorf("value may not contain newlines, semicolons or comment terminators")
	}
	if value == "" {
		if e.Spans.Value.Start < e.Spans.Value.End {
			start := e.Spans.Value.Start
			for start > 0 && (src[start-1] == ' ' || src[start-1] == '\t') {
				start--
			}
			if start > 0 && src[start-1] == '=' {
				start--
			}
			return ApplyEdits(src, []Edit{{Start: start, End: e.Spans.Value.End, Text: ""}})
		}
		return src, nil
	}
	if e.Spans.Value.Start < e.Spans.Value.End {
		return ApplyEdits(src, []Edit{{Start: e.Spans.Value.Start, End: e.Spans.Value.End, Text: value}})
	}
	insert := e.Spans.Name.End
	if e.Spans.Type.Start < e.Spans.Type.End {
		insert = e.Spans.Type.End
	}
	if insert == 0 {
		return "", fmt.Errorf("element has no anchor")
	}
	return ApplyEdits(src, []Edit{{Start: insert, End: insert, Text: " = " + value}})
}

// SetDoc sets or removes an element's documentation.
func SetDoc(src string, m *Model, id, doc string) (string, error) {
	e := m.Element(id)
	if e == nil {
		return "", fmt.Errorf("element not found")
	}
	if e.Implicit || e.Kind == "first" || e.Kind == "succession" || e.Kind == "verify" || e.Kind == "entry" || e.Kind == "dependency" {
		return "", fmt.Errorf("edit this behavior declaration in source")
	}
	doc = strings.TrimSpace(strings.ReplaceAll(doc, "\r\n", "\n"))
	if strings.Contains(doc, "*/") {
		return "", fmt.Errorf("documentation may not contain '*/'")
	}
	indent := lineIndentAt(src, e.Spans.Decl.Start)
	if doc == "" {
		if e.Spans.DocDecl.Start < e.Spans.DocDecl.End {
			start, end := e.Spans.DocDecl.Start, e.Spans.DocDecl.End
			start, end = expandLineRange(src, start, end)
			return ApplyEdits(src, []Edit{{Start: start, End: end, Text: ""}})
		}
		return src, nil
	}
	if e.Spans.Doc.Start < e.Spans.Doc.End {
		return ApplyEdits(src, []Edit{{Start: e.Spans.Doc.Start, End: e.Spans.Doc.End, Text: formatDocComment(doc, indent)}})
	}
	if e.Spans.BodyOpen >= 0 {
		childIndent := indent + "    "
		text := "\n" + childIndent + "doc " + formatDocComment(doc, childIndent)
		return ApplyEdits(src, []Edit{{Start: e.Spans.BodyOpen + 1, End: e.Spans.BodyOpen + 1, Text: text}})
	}
	// Convert a bodiless declaration into one with a doc body.
	if e.Spans.Decl.End > 0 && e.Spans.Decl.End <= len(src) && src[e.Spans.Decl.End-1] == ';' {
		childIndent := indent + "    "
		text := " {\n" + childIndent + "doc " + formatDocComment(doc, childIndent) + "\n" + indent + "}"
		return ApplyEdits(src, []Edit{{Start: e.Spans.Decl.End - 1, End: e.Spans.Decl.End, Text: text}})
	}
	return "", fmt.Errorf("cannot add documentation to this element")
}

func formatDocComment(doc, indent string) string {
	if !strings.Contains(doc, "\n") {
		return "/* " + doc + " */"
	}
	lines := strings.Split(doc, "\n")
	var b strings.Builder
	b.WriteString("/*\n")
	for _, ln := range lines {
		b.WriteString(indent)
		b.WriteString(" * ")
		b.WriteString(strings.TrimSpace(ln))
		b.WriteString("\n")
	}
	b.WriteString(indent)
	b.WriteString("*/")
	return b.String()
}

// DeleteElement removes an element (including its body and children).
func DeleteElement(src string, m *Model, id string) (string, error) {
	e := m.Element(id)
	if e == nil {
		return "", fmt.Errorf("element not found")
	}
	if e.Implicit {
		return "", fmt.Errorf("implicit succession belongs to its following declaration; edit it in source")
	}
	if e.Kind == "root" {
		return "", fmt.Errorf("the root cannot be deleted")
	}
	start, end := expandLineRange(src, e.Spans.Decl.Start, e.Spans.Decl.End)
	return ApplyEdits(src, []Edit{{Start: start, End: end, Text: ""}})
}

// AddElement inserts a new declaration into a container.
func AddElement(src string, m *Model, parentID, kind string, isDef bool, name, typ, doc, value string) (string, error) {
	parent := m.Element(parentID)
	if parent == nil {
		return "", fmt.Errorf("parent container not found")
	}
	kind = strings.TrimSpace(kind)
	if kind == "" {
		return "", fmt.Errorf("element kind is required")
	}
	if !identRe.MatchString(kind) {
		return "", fmt.Errorf("invalid element kind %q", kind)
	}
	if kind == "connection" || kind == "satisfy" {
		return "", fmt.Errorf("use the connection or satisfy endpoints for %s", kind)
	}
	if name == "" {
		return "", fmt.Errorf("name is required")
	}
	if !identRe.MatchString(name) {
		return "", fmt.Errorf("invalid SysML identifier %q", name)
	}
	typ = strings.TrimSpace(typ)
	if typ != "" && !typeRe.MatchString(typ) {
		return "", fmt.Errorf("invalid type %q", typ)
	}
	doc = strings.TrimSpace(doc)
	if strings.Contains(doc, "*/") {
		return "", fmt.Errorf("documentation may not contain '*/'")
	}
	value = strings.TrimSpace(value)
	if strings.ContainsAny(value, "\n;") {
		return "", fmt.Errorf("value may not contain newlines or semicolons")
	}

	parentIndent := lineIndentAt(src, parent.Spans.Decl.Start)
	childIndent := parentIndent + "    "
	if parent.Kind == "root" {
		parentIndent = ""
		childIndent = "    "
	}

	var b strings.Builder
	if kind == "package" {
		b.WriteString("package " + name)
	} else if isDef {
		b.WriteString(kind + " def " + name)
	} else {
		b.WriteString(kind + " " + name)
		if typ != "" {
			b.WriteString(" : " + typ)
		}
		if value != "" {
			b.WriteString(" = " + value)
		}
	}
	if kind == "package" || doc != "" {
		b.WriteString(" {")
		if doc != "" {
			b.WriteString("\n" + childIndent + "doc " + formatDocComment(doc, childIndent))
		}
		b.WriteString("\n" + parentIndent + "}")
	} else {
		b.WriteString(";")
	}
	return insertChild(src, parent, b.String(), parentIndent, childIndent)
}

// AddConnection inserts an interconnection into a container.
func AddConnection(src string, m *Model, parentID, name, source, target string) (string, error) {
	parent := m.Element(parentID)
	if parent == nil {
		return "", fmt.Errorf("parent container not found")
	}
	name = strings.TrimSpace(name)
	source = strings.TrimSpace(source)
	target = strings.TrimSpace(target)
	if name == "" {
		name = fmt.Sprintf("connection_%d", len(parent.Children)+1)
	}
	if !identRe.MatchString(name) {
		return "", fmt.Errorf("invalid connection name %q", name)
	}
	if !pathRe.MatchString(source) || !pathRe.MatchString(target) {
		return "", fmt.Errorf("invalid connection endpoint path")
	}
	parentIndent := lineIndentAt(src, parent.Spans.Decl.Start)
	childIndent := parentIndent + "    "
	if parent.Kind == "root" {
		parentIndent = ""
		childIndent = ""
	}
	text := "connection " + name + " connect " + source + " to " + target + ";"
	return insertChild(src, parent, text, parentIndent, childIndent)
}

// AddSatisfy inserts a satisfy link into a container.
func AddSatisfy(src string, m *Model, parentID, requirement, satisfier string) (string, error) {
	parent := m.Element(parentID)
	if parent == nil {
		return "", fmt.Errorf("parent container not found")
	}
	requirement = strings.TrimSpace(requirement)
	satisfier = strings.TrimSpace(satisfier)
	if !pathRe.MatchString(requirement) || !pathRe.MatchString(satisfier) {
		return "", fmt.Errorf("invalid satisfy path")
	}
	parentIndent := lineIndentAt(src, parent.Spans.Decl.Start)
	childIndent := parentIndent + "    "
	if parent.Kind == "root" {
		parentIndent = ""
		childIndent = ""
	}
	text := "satisfy " + requirement + " by " + satisfier + ";"
	return insertChild(src, parent, text, parentIndent, childIndent)
}

func insertChild(src string, parent *Element, text, parentIndent, childIndent string) (string, error) {
	if parent.Kind == "constraint" || isRelationship(parent) || parent.Kind == "entry" {
		return "", fmt.Errorf("cannot insert a declaration into this element; edit it in source")
	}
	if parent.Kind == "root" {
		prefix := ""
		if len(src) > 0 && !strings.HasSuffix(src, "\n") {
			prefix = "\n"
		}
		return ApplyEdits(src, []Edit{{Start: len(src), End: len(src), Text: prefix + "\n" + text + "\n"}})
	}
	if parent.Spans.BodyClose >= 0 {
		insert := parent.Spans.BodyClose
		// If the body already has content, append after the last non-space
		// character so the existing closing indentation is preserved.
		j := insert
		for j > parent.Spans.BodyOpen+1 && isSpace(src[j-1]) {
			j--
		}
		if j > parent.Spans.BodyOpen+1 {
			return ApplyEdits(src, []Edit{{Start: j, End: j, Text: "\n" + childIndent + text}})
		}
		return ApplyEdits(src, []Edit{{Start: insert, End: insert, Text: "\n" + childIndent + text + "\n" + parentIndent}})
	}
	// Bodiless container: turn the trailing semicolon into a body.
	if parent.Spans.Decl.End > 0 && parent.Spans.Decl.End <= len(src) && src[parent.Spans.Decl.End-1] == ';' {
		insert := parent.Spans.Decl.End - 1
		replacement := " {\n" + childIndent + text + "\n" + parentIndent + "}"
		return ApplyEdits(src, []Edit{{Start: insert, End: parent.Spans.Decl.End, Text: replacement}})
	}
	return "", fmt.Errorf("cannot insert into this container")
}

func isSpace(b byte) bool {
	return b == ' ' || b == '\t' || b == '\n' || b == '\r'
}

func lineIndentAt(src string, offset int) string {
	if offset > len(src) {
		offset = len(src)
	}
	lineStart := strings.LastIndex(src[:offset], "\n") + 1
	i := lineStart
	for i < len(src) && (src[i] == ' ' || src[i] == '\t') {
		i++
	}
	return src[lineStart:i]
}

func expandLineRange(src string, start, end int) (int, int) {
	lineStart := strings.LastIndex(src[:start], "\n") + 1
	if strings.TrimSpace(src[lineStart:start]) == "" {
		start = lineStart
	}
	lineEnd := end
	for lineEnd < len(src) && src[lineEnd] != '\n' {
		lineEnd++
	}
	if lineEnd < len(src) && strings.TrimSpace(src[end:lineEnd]) == "" {
		end = lineEnd + 1
	}
	return start, end
}

// ValidateEdit parses edited content and rejects new syntax errors.
func ValidateEdit(before *Model, afterSrc string) (*Model, error) {
	after := Parse(afterSrc)
	beforeErrors, afterErrors := 0, 0
	for _, d := range before.Diagnostics {
		if d.Severity == SeverityError {
			beforeErrors++
		}
	}
	for _, d := range after.Diagnostics {
		if d.Severity == SeverityError {
			afterErrors++
		}
	}
	if afterErrors > beforeErrors {
		for _, d := range after.Diagnostics {
			if d.Severity == SeverityError {
				return after, fmt.Errorf("edit would introduce a syntax error at line %d: %s", d.Line, d.Message)
			}
		}
	}
	return after, nil
}
