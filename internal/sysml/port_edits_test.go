package sysml

import (
	"strings"
	"testing"
)

func TestGraphicalConnectionPreservesPortIdentity(t *testing.T) {
	source := `package S {
 port def SignalPort;
 part def Sender { port output : SignalPort; }
 part def Receiver { port 'input port' : ~SignalPort; }
 part def Assembly {
  part 'Sender unit' : Sender;
  part 'Receiver unit' : Receiver;
 }
}`
	before := Parse(source)
	from := PortEndpoint{"S::Assembly::Sender unit", "S::Sender::output"}
	to := PortEndpoint{"S::Assembly::Receiver unit", "S::Receiver::input port"}
	edited, after, added, err := AddPortConnection(source, before, from, to)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(edited, "connect 'Sender unit'.output to 'Receiver unit'.'input port';") {
		t.Fatalf("connection did not retain restricted names: %s", edited)
	}
	if !strings.HasPrefix(added, "S::Assembly::connection_") {
		t.Fatalf("unexpected added connection ID: %q", added)
	}
	if got := after.Element(added); got.SourceID != from.PortID || got.TargetID != to.PortID {
		t.Fatalf("unexpected native endpoints: %+v", got)
	}
	if _, _, _, err := AddPortConnection(edited, after, to, from); err == nil {
		t.Fatal("duplicate connection accepted")
	}
	bad := PortEndpoint{from.NodeID, to.PortID}
	if _, _, _, err := AddPortConnection(source, before, bad, to); err == nil {
		t.Fatal("foreign port accepted")
	}
}
