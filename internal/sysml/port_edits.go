package sysml

import (
	"fmt"
	"strings"
)

// PortEndpoint identifies the displayed part usage and its native port.
type PortEndpoint struct {
	NodeID string `json:"nodeId"`
	PortID string `json:"portId"`
}

// AddPortConnection authors and verifies one connection between sibling part usages.
func AddPortConnection(src string, before *Model, from, to PortEndpoint) (string, *Model, string, error) {
	source, target := before.Element(from.NodeID), before.Element(to.NodeID)
	port, peer := before.Element(from.PortID), before.Element(to.PortID)
	if source == nil || target == nil || source.Kind != "part" || target.Kind != "part" || source.IsDef || target.IsDef ||
		port == nil || peer == nil || port.Kind != "port" || peer.Kind != "port" || port.IsDef || peer.IsDef {
		return "", before, "", fmt.Errorf("choose ports on part usages")
	}
	if from == to {
		return "", before, "", fmt.Errorf("choose two different port endpoints")
	}
	if source.ParentID != target.ParentID {
		return "", before, "", fmt.Errorf("choose parts with the same native owner")
	}
	owner := before.Element(source.ParentID)
	if owner == nil {
		return "", before, "", fmt.Errorf("native connection owner was not found")
	}
	for _, element := range before.Elements {
		if element.Kind != "connection" || element.IsDef || element.ParentID != owner.ID {
			continue
		}
		existingFrom := PortEndpoint{element.SourceNodeID, element.SourceID}
		existingTo := PortEndpoint{element.TargetNodeID, element.TargetID}
		if existingFrom == from && existingTo == to || existingFrom == to && existingTo == from {
			return "", before, "", fmt.Errorf("these ports already have a connection")
		}
	}
	name := ""
	for number := len(owner.Children) + 1; ; number++ {
		name = fmt.Sprintf("connection_%d", number)
		if before.Element(qnameOf(owner, name)) == nil {
			break
		}
	}
	sourcePath := connectionName(src, source) + "." + connectionName(src, port)
	targetPath := connectionName(src, target) + "." + connectionName(src, peer)
	edited, err := AddConnection(src, before, owner.ID, name, sourcePath, targetPath)
	if err != nil {
		return "", before, "", err
	}
	after, err := ValidateEdit(before, edited)
	if err != nil {
		return "", after, "", err
	}
	e := after.Element(qnameOf(owner, name))
	if e == nil || e.SourceNodeID != from.NodeID || e.SourceID != from.PortID ||
		e.TargetNodeID != to.NodeID || e.TargetID != to.PortID {
		return "", after, "", fmt.Errorf("the selected ports do not resolve on these parts in their native scope")
	}
	return edited, after, e.ID, nil
}

func connectionName(src string, element *Element) string {
	span := element.Spans.Name
	if span.Start >= 0 && span.End > span.Start && span.End <= len(src) {
		original := src[span.Start:span.End]
		tokens := Lex(original)
		if len(tokens) == 2 && tokens[0].Kind == TokIdent && tokens[0].Text == element.Name && tokens[0].Error == "" {
			return original
		}
	}
	escaped := strings.NewReplacer("\\", "\\\\", "'", "\\'", "\n", "\\n", "\r", "\\r", "\t", "\\t")
	return "'" + escaped.Replace(element.Name) + "'"
}

// A connection endpoint consists of identifier segments and path separators.
// Reuse the lexer so a restricted name stays a single, inert identifier.
func validConnectionPath(path string) bool {
	tokens := Lex(path)
	expectName := true
	for _, token := range tokens {
		if token.Kind == TokEOF {
			return !expectName
		}
		if token.Error != "" {
			return false
		}
		if expectName {
			if token.Kind != TokIdent || token.Text == "" {
				return false
			}
		} else if token.Kind != TokPunct || token.Text != "." && token.Text != "::" {
			return false
		}
		expectName = !expectName
	}
	return false
}
