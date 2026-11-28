package views

import "strings"

// Render uses the same native card drawing as the interactive diagram.
func Render(source string, view View) ([]byte, error) {
	return renderPresentation(source, view)
}

func wrap(s string, width int) []string {
	var out []string
	line := ""
	for _, word := range strings.Fields(s) {
		if len([]rune(line+" "+word)) > width && line != "" {
			out = append(out, line)
			line = ""
		}
		if line != "" {
			line += " "
		}
		line += word
	}
	return append(out, line)
}
