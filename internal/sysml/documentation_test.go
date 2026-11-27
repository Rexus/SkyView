package sysml

import (
	"strings"
	"testing"
)

func TestDocumentationMarkdownSurvivesSourceEdits(t *testing.T) {
	source := "package Demo {\n    part example;\n}"
	doc := strings.Join([]string{
		"# Flight controls", "",
		"* First item with **emphasis**  ", "    * Nested item", "",
		"```text", "  preserve code indentation", "```",
	}, "\n")
	edited, err := SetDoc(source, Parse(source), "Demo::example", doc)
	if err != nil {
		t.Fatal(err)
	}
	model := Parse(edited)
	element := model.Element("Demo::example")
	if element == nil || element.Doc != doc {
		t.Fatalf("Markdown changed after save: %#v", element)
	}
	if _, err := SetDoc(edited, model, element.ID, "cannot include */ as literal SysML doc"); err == nil {
		t.Fatal("accepted a block-comment terminator")
	}
	indented := "    first line of code\n      second line"
	edited, err = SetDoc(edited, model, element.ID, indented)
	if err != nil || Parse(edited).Element(element.ID).Doc != indented {
		t.Fatalf("indented code changed after save: %v", err)
	}
}

func TestDocumentationLegacyAndAuthoredFormatting(t *testing.T) {
	for _, tt := range []struct{ source, want string }{
		{"/*\n     * Previously saved prose\n     * Next paragraph\n    */", "Previously saved prose\nNext paragraph"},
		{"/*\n        * A Markdown list\n          * A nested list\n    */", "* A Markdown list\n  * A nested list"},
		{"/* **Inline**\r\n        continuation", "**Inline**\ncontinuation"},
	} {
		if got := DocText(tt.source); got != tt.want {
			t.Errorf("DocText(%q) = %q, want %q", tt.source, got, tt.want)
		}
	}
}
