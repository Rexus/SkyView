package sysml

import "strings"

// Diagnostic ranges are half-open UTF-8 byte offsets into the exact parsed source.
// Editor clients convert them to their own character encoding before decorating text.
func (p *parser) diag(severity, message string, tok Token, elementID string) {
	p.diagRange(severity, message, Span{tok.Start, tok.End}, elementID)
}

func (p *parser) diagAt(severity, message string, offset int, elementID string) {
	span := Span{offset, offset}
	for _, t := range p.toks {
		if t.Start <= offset && offset < t.End {
			span.End = t.End
			break
		}
	}
	p.diagRange(severity, message, span, elementID)
}

func (p *parser) diagRange(severity, message string, span Span, elementID string) {
	span.Start = max(0, min(len(p.src), span.Start))
	span.End = max(span.Start, min(len(p.src), span.End))
	line, column := lineCol(p.src, span.Start)
	p.model.Diagnostics = append(p.model.Diagnostics, Diagnostic{
		Severity: severity, Message: message, Line: line, Column: column, ElementID: elementID,
		Range: &span, Hint: diagnosticHint(message),
	})
}

// Hints suggest a review action, never an unverified change to model intent.
func diagnosticHint(message string) string {
	switch {
	case strings.HasPrefix(message, "Unresolved"):
		return "Check the spelling, owning scope and imports of this reference. SkyView supports a subset of SysML; confirm unfamiliar library constructs with the project's native validator before changing the model."
	case strings.HasPrefix(message, "Duplicate name"):
		return "Use a distinct name within this container, or remove the unintended duplicate. Update references if you rename it."
	case strings.Contains(message, "Unclosed '{'"):
		return "Add the closing '}' for this container, or remove an unintended opening brace."
	case strings.Contains(message, "Unexpected '}'"):
		return "Check the matching opening brace. Remove this closing brace only if it is extra."
	case strings.Contains(message, "block comment"):
		return "Use a complete block comment: doc /* explanation */. Check that the closing */ is present."
	case strings.Contains(strings.ToLower(message), "unterminated"):
		return "Close the quoted text or comment with its matching delimiter. Escape embedded quote characters when needed."
	case strings.HasPrefix(message, "Expected a type"):
		return "Supply a declared type name after the typing or specialization operator, and check its namespace/import."
	case strings.HasPrefix(message, "Expected '>'"):
		return "Close the short name with '>', for example <'SYS-example'>."
	case strings.HasPrefix(message, "Expected ';'"):
		return "Terminate this declaration with ';', or supply a body where the declaration permits one."
	case strings.HasPrefix(message, "Expected 'to'"):
		return "Separate the source and target with the 'to' keyword, and supply both endpoints."
	case strings.HasPrefix(message, "Expected 'connect'"):
		return "Use 'connection name connect source to target;' for this supported connection form."
	case strings.HasPrefix(message, "Expected 'by'"):
		return "Use 'satisfy requirement by satisfier;' and reference existing elements."
	case strings.HasPrefix(message, "Expected a package name"):
		return "Give the package a name before its body; quote names containing spaces with single quotes."
	case strings.HasPrefix(message, "Expected a name after path separator"):
		return "Add the next qualified name after '::' or '.', or remove the unintended separator."
	case strings.Contains(message, "supported") || strings.HasPrefix(message, "Skipping") || strings.HasPrefix(message, "Unexpected token"):
		return "Check the surrounding syntax. This may be a SkyView parser limitation; validate native SysML before rewriting a valid construct."
	default:
		return ""
	}
}
