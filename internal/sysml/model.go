package sysml

// Severity levels for model diagnostics.
const (
	SeverityError   = "error"
	SeverityWarning = "warning"
	SeverityInfo    = "info"
)

// Diagnostic is a parse or semantic message tied to a source location.
type Diagnostic struct {
	Range     *Span  `json:"range,omitempty"`
	Hint      string `json:"hint,omitempty"`
	Severity  string `json:"severity"`
	Message   string `json:"message"`
	Line      int    `json:"line"`
	Column    int    `json:"column"`
	ElementID string `json:"elementId,omitempty"`
}

// Span is a half-open byte range in the source file.
type Span struct {
	Start int `json:"start"`
	End   int `json:"end"`
}

// Spans records the source ranges needed for structured editing.
type Spans struct {
	Decl        Span `json:"decl"`
	Name        Span `json:"name"`
	Type        Span `json:"type"`
	Specializes Span `json:"specializes"`
	Expression  Span `json:"expression"`
	Value       Span `json:"value"`
	Doc         Span `json:"doc"`
	DocDecl     Span `json:"docDecl"`
	BodyOpen    int  `json:"bodyOpen"`
	BodyClose   int  `json:"bodyClose"`
}

// Element is one SysML element (package, definition, usage, connection, ...).
type Element struct {
	Redefines        string `json:"redefines,omitempty"`
	RedefinitionSpan Span   `json:"-"`
	RedefinedID      string `json:"redefinedId,omitempty"`
	// Expressions remain native source; references are resolved without evaluating them.
	Expression      string   `json:"expression,omitempty"`
	ConstraintRole  string   `json:"constraintRole,omitempty"`
	ValueID         string   `json:"valueId,omitempty"`
	Implicit        bool     `json:"implicit,omitempty"`
	ShortName       string   `json:"shortName,omitempty"`
	ID              string   `json:"id"`
	Name            string   `json:"name"`
	Kind            string   `json:"kind"`
	IsDef           bool     `json:"isDef"`
	Type            string   `json:"type,omitempty"`
	Specializes     string   `json:"specializes,omitempty"`
	Doc             string   `json:"doc,omitempty"`
	DocResolved     string   `json:"docResolved,omitempty"`
	ParentID        string   `json:"parentId"`
	QName           string   `json:"qname"`
	Line            int      `json:"line"`
	Col             int      `json:"col"`
	Value           string   `json:"value,omitempty"`
	Multiplicity    string   `json:"multiplicity,omitempty"`
	Direction       string   `json:"direction,omitempty"`
	Source          string   `json:"source,omitempty"`
	Target          string   `json:"target,omitempty"`
	Requirement     string   `json:"requirement,omitempty"`
	Satisfier       string   `json:"satisfier,omitempty"`
	SourceSpan      Span     `json:"-"`
	TargetSpan      Span     `json:"-"`
	RequirementSpan Span     `json:"-"`
	SatisfierSpan   Span     `json:"-"`
	TypeID          string   `json:"typeId,omitempty"`
	SpecializesID   string   `json:"specializesId,omitempty"`
	SourceID        string   `json:"sourceId,omitempty"`
	TargetID        string   `json:"targetId,omitempty"`
	SourceNodeID    string   `json:"sourceNodeId,omitempty"`
	TargetNodeID    string   `json:"targetNodeId,omitempty"`
	RequirementID   string   `json:"requirementId,omitempty"`
	SatisfierID     string   `json:"satisfierId,omitempty"`
	Children        []string `json:"children,omitempty"`
	Spans           Spans    `json:"spans"`
}

// Model is a parsed SysML v2 file plus semantic annotations.
type Model struct {
	// Reference spans support identity-aware edits without rewriting unrelated names.
	References  []Reference         `json:"-"`
	Unsupported []Unsupported       `json:"unsupported,omitempty"`
	RootID      string              `json:"rootId"`
	RootName    string              `json:"rootName"`
	Elements    []*Element          `json:"elements"`
	ByID        map[string]*Element `json:"-"`
	Imports     []string            `json:"imports,omitempty"`
	Diagnostics []Diagnostic        `json:"diagnostics"`
	Content     string              `json:"-"`
}

type Reference struct {
	Span      Span
	ElementID string
}

// Element returns the element with the given id, or nil.
func (m *Model) Element(id string) *Element {
	if m == nil || m.ByID == nil {
		return nil
	}
	return m.ByID[id]
}

// Children returns direct child elements in source order.
func (m *Model) Children(id string) []*Element {
	var out []*Element
	for _, e := range m.Elements {
		if e.ParentID == id {
			out = append(out, e)
		}
	}
	return out
}

// Depth returns the nesting depth of an element (root = 0).
func (m *Model) Depth(id string) int {
	d := 0
	for e := m.Element(id); e != nil && e.ParentID != ""; e = m.Element(e.ParentID) {
		d++
	}
	return d
}
