package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/Rexus/SkyView/internal/sysml"
)

func TestValidateUnsavedSourceWithRangesWithoutSaving(t *testing.T) {
	s := New(t.TempDir())
	const name = "Draft.sysml"
	const saved = "package P { part a; }"
	if err := s.writeFile(name, saved); err != nil {
		t.Fatal(err)
	}
	handler := s.Handler()
	for _, draft := range []string{"// 🛰\r\npackage P { part p : Ghost; }", "package P { part def Vehicle; part p : Vehicle; }"} {
		body, _ := json.Marshal(map[string]string{"content": draft})
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/files/"+name+"/validate", bytes.NewReader(body)))
		if response.Code != 200 {
			t.Fatalf("validation: %s", response.Body.String())
		}
		var result struct {
			Diagnostics []sysml.Diagnostic `json:"diagnostics"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(draft, "Ghost") {
			if len(result.Diagnostics) != 1 {
				t.Fatalf("expected one issue: %+v", result.Diagnostics)
			}
			d := result.Diagnostics[0]
			if d.Range == nil || draft[d.Range.Start:d.Range.End] != "Ghost" || d.Hint == "" {
				t.Fatalf("missing editor information: %+v", d)
			}
		} else if len(result.Diagnostics) != 0 {
			t.Fatal("corrected draft still has issues")
		}
		got, err := s.readFile(name)
		if err != nil || got != saved {
			t.Fatal("validation changed the saved model")
		}
	}
}
