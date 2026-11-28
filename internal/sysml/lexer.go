package sysml

import (
	"strings"
	"unicode"
	"unicode/utf8"
)

// TokenKind identifies the lexical class of a token.
type TokenKind int

const (
	TokEOF TokenKind = iota
	TokIdent
	TokString
	TokNumber
	TokPunct
	TokComment
)

// Token is a lexical token with byte offsets and 1-based line/column.
type Token struct {
	Quoted bool
	Error  string
	Kind   TokenKind
	Text   string
	Start  int
	End    int
	Line   int
	Col    int
}

// Lex splits SysML v2 textual notation into tokens. It is deliberately
// permissive: comments are preserved, unknown punctuation becomes a token, and
// unterminated strings/comments are returned as-is so the parser can report
// them instead of losing the rest of the file.
func Lex(src string) []Token {
	var toks []Token
	line, col := 1, 1
	i := 0
	n := len(src)

	advance := func(from, to int) {
		for j := from; j < to && j < n; j++ {
			if src[j] == '\n' {
				line++
				col = 1
			} else {
				col++
			}
		}
	}

	for i < n {
		c := src[i]
		// Whitespace.
		if c == ' ' || c == '\t' || c == '\r' || c == '\n' {
			advance(i, i+1)
			i++
			continue
		}
		// Line comment.
		if c == '/' && i+1 < n && src[i+1] == '/' {
			start := i
			for i < n && src[i] != '\n' {
				i++
			}
			toks = append(toks, Token{Kind: TokComment, Text: src[start:i], Start: start, End: i, Line: line, Col: col})
			advance(start, i)
			continue
		}
		// Block comment.
		if c == '/' && i+1 < n && src[i+1] == '*' {
			start := i
			i += 2
			for i+1 < n && !(src[i] == '*' && src[i+1] == '/') {
				i++
			}
			if i+1 < n {
				i += 2
			} else {
				i = n
			}
			toks = append(toks, Token{Kind: TokComment, Text: src[start:i], Start: start, End: i, Line: line, Col: col})
			advance(start, i)
			continue
		}
		// Restricted names use single quotes; string literals use double quotes.
		// Decode the name while retaining its original source range for edits.
		if c == '"' || c == '\'' {
			start := i
			quote := c
			closed := false
			var decoded strings.Builder
			i++
			for i < n {
				if src[i] == '\\' && i+1 < n {
					escaped := src[i+1]
					switch escaped {
					case 'n':
						escaped = '\n'
					case 'r':
						escaped = '\r'
					case 't':
						escaped = '\t'
					}
					decoded.WriteByte(escaped)
					i += 2
					continue
				}
				if src[i] == quote {
					i++
					closed = true
					break
				}
				if src[i] == '\n' {
					break
				}
				decoded.WriteByte(src[i])
				i++
			}
			t := Token{Kind: TokString, Text: src[start:i], Start: start, End: i, Line: line, Col: col}
			if quote == '\'' {
				t.Kind = TokIdent
				t.Text = decoded.String()
				t.Quoted = true
			}
			if !closed {
				t.Error = "Unterminated quoted name or string"
			}
			toks = append(toks, t)
			advance(start, i)
			continue
		}
		// Number.
		if c >= '0' && c <= '9' {
			start := i
			for i < n && (src[i] >= '0' && src[i] <= '9' || src[i] == '.' || src[i] == 'e' || src[i] == 'E' || src[i] == '+' || src[i] == '-') {
				// Stop at a '-'/'+' that is not part of an exponent.
				if (src[i] == '+' || src[i] == '-') && !(i > start && (src[i-1] == 'e' || src[i-1] == 'E')) {
					break
				}
				i++
			}
			toks = append(toks, Token{Kind: TokNumber, Text: src[start:i], Start: start, End: i, Line: line, Col: col})
			advance(start, i)
			continue
		}
		// Identifier (allow unicode letters and $).
		r, _ := utf8.DecodeRuneInString(src[i:])
		if unicode.IsLetter(r) || c == '_' || c == '$' {
			start := i
			for i < n {
				r, size := utf8.DecodeRuneInString(src[i:])
				if unicode.IsLetter(r) || unicode.IsDigit(r) || src[i] == '_' || src[i] == '$' {
					i += size
					continue
				}
				break
			}
			toks = append(toks, Token{Kind: TokIdent, Text: src[start:i], Start: start, End: i, Line: line, Col: col})
			advance(start, i)
			continue
		}
		// Multi-character punctuation we care about.
		start := i
		two := ""
		if i+1 < n {
			two = src[i : i+2]
		}
		if i+2 < n && src[i:i+3] == ":>>" {
			i += 3
		} else {
			switch two {
			case "::", "->", "=>", ":=", "==", "!=", "<=", ">=", "&&", "||", "..", "**", ":>":
				i += 2
			default:
				i++
			}
		}
		toks = append(toks, Token{Kind: TokPunct, Text: src[start:i], Start: start, End: i, Line: line, Col: col})
		advance(start, i)
	}
	toks = append(toks, Token{Kind: TokEOF, Text: "", Start: n, End: n, Line: line, Col: col})
	return toks
}

func isComment(t Token) bool { return t.Kind == TokComment && strings.HasPrefix(t.Text, "/*") }

// DocText removes the block-comment framing while preserving the Markdown.
func DocText(comment string) string {
	body := strings.TrimSuffix(strings.TrimPrefix(comment, "/*"), "*/")
	boxed := strings.HasPrefix(comment, "/**")
	if boxed {
		body = strings.TrimPrefix(body, "*")
	}
	lines := strings.Split(strings.ReplaceAll(body, "\r\n", "\n"), "\n")
	if len(lines) == 1 {
		return strings.Trim(lines[0], " \t")
	}
	closingIndent := lines[len(lines)-1]
	standaloneClose := strings.TrimSpace(closingIndent) == ""
	inline := strings.TrimSpace(lines[0]) != ""
	if inline {
		lines[0] = strings.TrimLeft(lines[0], " \t")
	}
	if standaloneClose {
		lines = lines[:len(lines)-1]
	} else {
		lines[len(lines)-1] = strings.TrimRight(lines[len(lines)-1], " \t")
	}
	// Earlier SkyView saves prefixed each line with an aligned decorative star.
	// Require that framing on every nonblank continuation line.
	first := 0
	if inline {
		first = 1
	}
	stars := boxed || (!inline && standaloneClose)
	prefix := closingIndent + " *"
	for _, line := range lines[first:] {
		if strings.TrimSpace(line) == "" {
			continue
		}
		if boxed {
			stars = strings.HasPrefix(strings.TrimLeft(line, " \t"), "*")
		} else {
			stars = strings.HasPrefix(line, prefix+" ") || line == prefix
		}
		if !stars {
			break
		}
	}
	if stars {
		for i := first; i < len(lines); i++ {
			line := strings.TrimLeft(lines[i], " \t")
			lines[i] = strings.TrimPrefix(strings.TrimPrefix(line, "*"), " ")
		}
	} else {
		indent := commonDocIndent(lines[first:])
		framing := closingIndent + "    "
		if standaloneClose && strings.HasPrefix(indent, framing) {
			indent = framing
		}
		for i := first; i < len(lines); i++ {
			lines[i] = strings.TrimPrefix(lines[i], indent)
		}
	}
	return trimDocLines(strings.Join(lines, "\n"))
}

func commonDocIndent(lines []string) string {
	prefix := ""
	found := false
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		indent := line[:len(line)-len(strings.TrimLeft(line, " \t"))]
		if !found {
			prefix, found = indent, true
		}
		for !strings.HasPrefix(indent, prefix) {
			prefix = prefix[:len(prefix)-1]
		}
	}
	return prefix
}

func trimDocLines(doc string) string {
	lines := strings.Split(strings.ReplaceAll(doc, "\r\n", "\n"), "\n")
	for len(lines) > 0 && strings.TrimSpace(lines[0]) == "" {
		lines = lines[1:]
	}
	for len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) == "" {
		lines = lines[:len(lines)-1]
	}
	return strings.Join(lines, "\n")
}
