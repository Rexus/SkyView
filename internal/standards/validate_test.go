package standards

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestSnapshotBoundsAndIdentity(t *testing.T) {
	for _, name := range []string{"../outside.sysml", "/tmp/out.sysml", "C:/out.sysml", "a/../../x.sysml", "a\\x.sysml", "x.txt", "a/./x.sysml"} {
		if ValidateSnapshot(map[string]string{name: "package P;"}) == nil {
			t.Fatalf("accepted %q", name)
		}
	}
	if ValidateSnapshot(map[string]string{"A.sysml": string([]byte{0xff})}) == nil {
		t.Fatal("accepted invalid UTF-8")
	}
	a := map[string]string{"z.sysml": "package Z;", "a.sysml": "package A;"}
	b := map[string]string{"a.sysml": "package A;", "z.sysml": "package Z;"}
	if SnapshotHash(a) != SnapshotHash(b) {
		t.Fatal("hash depends on map order")
	}
	b["a.sysml"] += "\n"
	if SnapshotHash(a) == SnapshotHash(b) {
		t.Fatal("hash hides source edits")
	}
}
func TestUnavailableNeverPasses(t *testing.T) {
	r := NewRunner(t.TempDir(), "java")
	result, err := r.Check(context.Background(), map[string]string{"A.sysml": "package A;"})
	if err == nil || result.Status != "unavailable" || result.Error == "" || result.FilesChecked != 0 {
		t.Fatalf("false native pass: %+v %v", result, err)
	}
	r.active <- struct{}{}
	_, err = r.Check(context.Background(), map[string]string{"A.sysml": "package A;"})
	if err != ErrBusy {
		t.Fatal("concurrent checker was not bounded")
	}
}
func TestCollectReadsNestedFilesWithoutChangingSource(t *testing.T) {
	root := t.TempDir()
	os.Mkdir(filepath.Join(root, "nested"), 0755)
	os.Mkdir(filepath.Join(root, ".git"), 0755)
	source := "// 🛰\r\npackage P;"
	path := filepath.Join(root, "nested", "P.sysml")
	os.WriteFile(path, []byte(source), 0644)
	os.WriteFile(filepath.Join(root, ".git", "Ignored.sysml"), []byte("garbage"), 0644)
	files, err := Collect(root)
	if err != nil || len(files) != 1 || files["nested/P.sysml"] != source {
		t.Fatalf("snapshot: %+v %v", files, err)
	}
	got, _ := os.ReadFile(path)
	if string(got) != source {
		t.Fatal("source changed")
	}
	if err := os.Symlink(path, filepath.Join(root, "Link.sysml")); err == nil {
		if _, err = Collect(root); err == nil {
			t.Fatal("accepted a source symlink")
		}
	}
}
func TestChecksumRejectsModifiedInputs(t *testing.T) {
	p := filepath.Join(t.TempDir(), "input")
	os.WriteFile(p, []byte("official"), 0644)
	hash, _ := fileHash(p)
	if err := checkHash(p, hash); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(p, []byte("modified"), 0644)
	if checkHash(p, hash) == nil {
		t.Fatal("accepted changed dependency")
	}
}

func TestNativeOutputRemainsBoundedThroughIOCopy(t *testing.T) {
	b := &limitedBuffer{limit: 8}
	n, err := io.Copy(b, strings.NewReader(strings.Repeat("x", 100)))
	if err != nil || n != 100 || len(b.Bytes()) != 8 {
		t.Fatalf("unbounded native output: %d %d %v", n, len(b.Bytes()), err)
	}
}

func TestInstalledNativeDiagnosticsAndFailure(t *testing.T) {
	if os.Getenv("SKYVIEW_NATIVE_TESTS") != "1" {
		t.Skip("run with SKYVIEW_NATIVE_TESTS=1 after standards-setup; CI native job requires this")
	}
	r := NewRunner(DefaultHome(), "java")
	source := "// 🛰\r\npackage P { part p : MissingType; }"
	result, err := r.Check(context.Background(), map[string]string{"Nested/Bad.sysml": source})
	if err != nil || result.Status != "failed" {
		t.Fatalf("native invalid source: %+v %v", result, err)
	}
	found := false
	for _, d := range result.Diagnostics {
		if d.Range != nil && d.Range.Start >= 0 && d.Range.End <= len(source) && source[d.Range.Start:d.Range.End] == "MissingType" {
			found = true
		}
	}
	if !found {
		t.Fatalf("native range is not the UTF-8 token: %+v", result.Diagnostics)
	}
	mixed, mixedErr := r.Check(context.Background(), map[string]string{
		"Shared.kerml": "package Shared { feature reading : ScalarValues::Real = 3.0; }",
		"Sensor.sysml": "package Sensor { attribute measured : ScalarValues::Real = Shared::reading; }",
	})
	if mixedErr != nil || mixed.Status != "passed" {
		t.Fatalf("mixed KerML/SysML project: %+v %v", mixed, mixedErr)
	}
	r.Timeout = time.Nanosecond
	result, err = r.Check(context.Background(), map[string]string{"Good.sysml": "package Good;"})
	if err == nil || result.Status != "unavailable" {
		t.Fatal("timeout became a pass")
	}
	r = NewRunner(DefaultHome(), filepath.Join(t.TempDir(), "missing-java"))
	result, err = r.Check(context.Background(), map[string]string{"Good.sysml": "package Good;"})
	if err == nil || result.Status != "unavailable" {
		t.Fatal("missing Java became a pass")
	}
}

func TestInstallPreservesBundledLicense(t *testing.T) {
	home := t.TempDir()
	if err := installNotices(home); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(home, "licenses", "PlantUML-EPL-1.0.html"))
	if err != nil || !strings.Contains(string(data), "Eclipse Public License") {
		t.Fatal("missing bundled dependency license")
	}
}
