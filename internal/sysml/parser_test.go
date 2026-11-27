package sysml

import (
	"os"
	"strings"
	"testing"
)

func TestAnonymousBinaryConnection(t *testing.T) {
	const source = `package Wiring {
	port def Signal;
	part def Sender { port output : Signal; }
	part def Receiver { port 'input port' : Signal; }
	part def Assembly {
		part 'Sender unit' : Sender;
		part 'Receiver unit' : Receiver;
		part spare : Receiver;
		connect 'Sender unit'.output to 'Receiver unit'.'input port';
		connect ('Sender unit'.output, 'Receiver unit'.'input port', spare.'input port');
		connection 'connect' connect 'Sender unit'.output to spare.'input port';
	}
}`
	model := Parse(source)
	if len(model.Diagnostics) != 0 {
		t.Fatalf("unexpected projection diagnostics: %+v", model.Diagnostics)
	}
	if len(model.Unsupported) != 1 || model.Unsupported[0].Reason != "parenthesized connection ends are not projected" {
		t.Fatalf("expected a projection limit for parenthesized ends: %+v", model.Unsupported)
	}
	var anonymous *Element
	connections := 0
	for _, element := range model.Elements {
		if element.Kind != "connection" {
			continue
		}
		connections++
		if element.Spans.Name.Start == element.Spans.Name.End {
			anonymous = element
		}
	}
	if named := model.Element("Wiring::Assembly::connect"); connections != 2 || named == nil || named.TargetNodeID != "Wiring::Assembly::spare" {
		t.Fatalf("expected both binary connections, including the quoted name: %+v", named)
	}
	if anonymous == nil || anonymous.Implicit || anonymous.ShortName != "" ||
		anonymous.SourceNodeID != "Wiring::Assembly::Sender unit" || anonymous.SourceID != "Wiring::Sender::output" ||
		anonymous.TargetNodeID != "Wiring::Assembly::Receiver unit" || anonymous.TargetID != "Wiring::Receiver::input port" {
		t.Fatalf("incorrect authored endpoints: %+v", anonymous)
	}
	if got := source[anonymous.Spans.Decl.Start:anonymous.Spans.Decl.End]; got != "connect 'Sender unit'.output to 'Receiver unit'.'input port';" {
		t.Fatalf("incorrect source span: %q", got)
	}
}

func loadSample(t *testing.T) string {
	t.Helper()
	b, err := os.ReadFile("../../examples/starter/models/example-model.sysml")
	if err != nil {
		t.Fatalf("read sample: %v", err)
	}
	return string(b)
}

func TestParseSample(t *testing.T) {
	m := Parse(loadSample(t))
	var errors int
	for _, d := range m.Diagnostics {
		if d.Severity == SeverityError {
			errors++
			t.Logf("error: line %d: %s", d.Line, d.Message)
		}
	}
	if errors != 0 {
		t.Fatalf("expected no parse errors, got %d", errors)
	}
	var connections, satisfies, parts int
	for _, e := range m.Elements {
		switch e.Kind {
		case "connection":
			connections++
			if e.SourceNodeID == "" || e.TargetNodeID == "" {
				t.Errorf("connection %s unresolved: source=%q target=%q", e.Name, e.Source, e.Target)
			}
		case "satisfy":
			satisfies++
			if e.RequirementID == "" || e.SatisfierID == "" {
				t.Errorf("satisfy %s unresolved: req=%q sat=%q", e.Name, e.Requirement, e.Satisfier)
			}
		case "part":
			parts++
		}
	}
	if connections != 2 {
		t.Errorf("expected 2 connections, got %d", connections)
	}
	if satisfies != 2 {
		t.Errorf("expected 2 satisfy links, got %d", satisfies)
	}
	if parts < 20 {
		t.Errorf("expected at least 20 part elements, got %d", parts)
	}
	// Docs should attach to owners.
	if e := m.ByID["ExampleModel::Compute::ComputeNode"]; e == nil || !strings.Contains(e.Doc, "generic compute node") {
		t.Errorf("ComputeNode doc not attached: %+v", e)
	}
	if e := m.ByID["ExampleModel::Requirements::singleEndpoint"]; e == nil || e.TypeID == "" || !strings.Contains(e.DocResolved, "single API endpoint") {
		t.Errorf("requirement usage not resolved: %+v", e)
	}
}

func TestEdits(t *testing.T) {
	src := loadSample(t)
	m := Parse(src)

	// Rename a part and update its connection paths.
	out, err := RenameElement(src, m, "ExampleModel::Compute::ComputeSystem::node1", "nodeOne")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "part nodeOne : ComputeNode;") || !strings.Contains(out, "nodeOne.api") {
		t.Errorf("rename did not update declaration and references")
	}
	m = Parse(out)
	if len(m.ByID) == 0 {
		t.Fatal("reparse failed")
	}

	// Add a part to the compute system.
	out, err = AddElement(out, m, "ExampleModel::Compute::ComputeSystem", "part", false, "node3", "ComputeNode", "A third compute node.", "")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "part node3 : ComputeNode {") {
		t.Errorf("part not inserted")
	}
	m = Parse(out)
	if m.ByID["ExampleModel::Compute::ComputeSystem::node3"] == nil {
		t.Errorf("added part not parsed")
	}

	// Set documentation on an existing element.
	out, err = SetDoc(out, m, "ExampleModel::Facility::DemoArea", "Updated demo area.")
	if err != nil {
		t.Fatal(err)
	}
	m = Parse(out)
	if !strings.Contains(m.ByID["ExampleModel::Facility::DemoArea"].Doc, "Updated demo area") {
		t.Errorf("doc not updated")
	}

	// Add a connection and a satisfy link (reparse between structural edits).
	out, err = AddConnection(out, m, "ExampleModel::Compute::ComputeSystem", "node3Api", "node3.api", "servingEngine.api")
	if err != nil {
		t.Fatal(err)
	}
	m = Parse(out)
	out, err = AddSatisfy(out, m, "ExampleModel::Requirements::RequirementsContext", "largeContext", "compute.servingEngine")
	if err != nil {
		t.Fatal(err)
	}
	m = Parse(out)
	for _, d := range m.Diagnostics {
		if d.Severity == SeverityError {
			t.Errorf("%s line %d: %s", d.Severity, d.Line, d.Message)
		}
	}
	if c := m.ByID["ExampleModel::Compute::ComputeSystem::node3Api"]; c == nil || c.SourceNodeID == "" {
		t.Errorf("added connection not resolved: %+v", c)
	}

	// Delete the added part.
	out, err = DeleteElement(out, m, "ExampleModel::Compute::ComputeSystem::node3")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out, "part node3") {
		t.Errorf("part not deleted")
	}
}

func TestBrokenInput(t *testing.T) {
	m := Parse("package X {\n  part def A {\n    part b : Missing;\n")
	if len(m.Diagnostics) == 0 {
		t.Errorf("expected diagnostics for broken input")
	}
}
