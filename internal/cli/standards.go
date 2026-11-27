package cli

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/Rexus/SkyView/internal/standards"
)

func runStandards(args []string, out, errOut io.Writer) error {
	f := flag.NewFlagSet(args[0], flag.ContinueOnError)
	f.SetOutput(errOut)
	home := f.String("toolchain", standards.DefaultHome(), "installed pinned SysML toolchain directory")
	cache := f.String("cache", filepath.Join(filepath.Dir(standards.DefaultHome()), "downloads"), "download cache (setup only)")
	java := f.String("java", "java", "JDK 21+ java executable")
	project := f.String("project-dir", "", "project directory containing SysML/KerML files (lint)")
	timeout := f.Duration("timeout", 120*time.Second, "maximum native check duration per project (lint)")
	repository := f.Bool("repository", false, "run the repository model and validator acceptance gate")
	strictLibrary := f.Bool("strict-library", false, "also fail on constraint defects inherited from official libraries")
	channel := f.String("channel", "published", "build update: published, latest (including previews), or locked (offline)")
	lock := f.String("lock", "internal/standards/release.json", "version lock to update during a source build")
	report := f.String("report", "", "write the current attempt as JSON, including failed attempts")
	if e := f.Parse(args[1:]); e != nil {
		if e == flag.ErrHelp {
			return nil
		}
		return e
	}
	if f.NArg() != 0 {
		return fmt.Errorf("unexpected positional arguments")
	}
	if args[0] == "standards-update" {
		return standards.RefreshLock(context.Background(), *channel, *lock, *cache, errOut)
	}
	if args[0] == "standards-info" {
		info := standards.NewRunner(*home, *java).Identity()
		if e := emitReport(*report, info, out); e != nil {
			return e
		}
		if info.State != "verified" {
			return fmt.Errorf("%s", info.Error)
		}
		return nil
	}
	if args[0] == "standards-setup" {
		result := standards.Result{Status: "running", Release: standards.Pinned(), Diagnostics: []standards.Diagnostic{}}
		if e := emitReport(*report, result, nil); e != nil {
			return e
		}
		e := standards.Install(context.Background(), *home, *cache, errOut)
		result.Status = "passed"
		if e != nil {
			result.Status = "unavailable"
			result.Error = e.Error()
		}
		if writeErr := emitReport(*report, result, nil); writeErr != nil {
			return writeErr
		}
		return e
	}
	if (*project == "") == !(*repository) {
		return fmt.Errorf("lint requires exactly one of -project-dir or -repository")
	}
	if *timeout <= 0 {
		return fmt.Errorf("native check timeout must be positive")
	}
	runner := standards.NewRunner(*home, *java)
	runner.Timeout = *timeout
	runner.StrictLibrary = *strictLibrary
	if *repository {
		return repositoryGate(runner, *report, out, errOut)
	}
	result := standards.Result{Status: "unavailable", Release: standards.Pinned(), Diagnostics: []standards.Diagnostic{}}
	files, e := standards.Collect(*project)
	if e == nil {
		result, e = runner.Check(context.Background(), files)
	} else {
		result.Error = e.Error()
	}
	if err := emitReport(*report, result, out); err != nil {
		return err
	}
	if e != nil {
		return e
	}
	if result.Status != "passed" {
		return fmt.Errorf("native SysML validation failed")
	}
	return nil
}
func emitReport(path string, value any, out io.Writer) error {
	b, e := json.MarshalIndent(value, "", "  ")
	if e != nil {
		return e
	}
	b = append(b, '\n')
	if path != "" {
		if e = os.MkdirAll(filepath.Dir(path), 0755); e != nil {
			return e
		}
		if e = os.WriteFile(path, b, 0644); e != nil {
			return e
		}
	}
	if out != nil {
		_, e = out.Write(b)
	}
	return e
}

type gateCheck struct {
	Name                string           `json:"name"`
	Expected            string           `json:"expected"`
	Passed              bool             `json:"passed"`
	ExpectedDiagnostics []fixtureFinding `json:"expectedDiagnostics,omitempty"`
	Result              standards.Result `json:"result"`
}
type gateReport struct {
	Status  string            `json:"status"`
	Started string            `json:"started"`
	Release standards.Release `json:"release"`
	Checks  []gateCheck       `json:"checks"`
	Error   string            `json:"error,omitempty"`
}

func repositoryGate(runner *standards.Runner, path string, out, errOut io.Writer) error {
	report := gateReport{Status: "running", Started: time.Now().UTC().Format(time.RFC3339), Release: standards.Pinned(), Checks: []gateCheck{}}
	if e := emitReport(path, report, nil); e != nil {
		return e
	}
	finishError := func(e error) error {
		report.Status = "failed"
		report.Error = e.Error()
		if writeErr := emitReport(path, report, out); writeErr != nil {
			return writeErr
		}
		return e
	}
	if e := standards.Verify(runner.Home); e != nil {
		return finishError(e)
	}
	run := func(name string, files map[string]string, expected string, findings []fixtureFinding) error {
		result, e := runner.Check(context.Background(), files)
		passed := e == nil && result.Status == expected && matchesFindings(result.Diagnostics, findings)
		report.Checks = append(report.Checks, gateCheck{Name: name, Expected: expected, Passed: passed, ExpectedDiagnostics: findings, Result: result})
		fmt.Fprintf(errOut, "%s: %s (expected %s; %d official-library findings)\n", name, result.Status, expected, len(result.LibraryDiagnostics))
		if writeErr := emitReport(path, report, nil); writeErr != nil {
			return writeErr
		}
		if !passed {
			return fmt.Errorf("%s did not meet native validation expectation: %s %v", name, result.Status, e)
		}
		return nil
	}
	// Discover every model-bearing example directory; fail on an empty or unreadable first-party group.
	dirs := []string{"architecture/models"}
	entries, e := os.ReadDir("examples")
	if e != nil {
		return finishError(e)
	}
	for _, entry := range entries {
		if entry.IsDir() {
			dirs = append(dirs, filepath.Join("examples", entry.Name()))
		}
	}
	for _, dir := range dirs {
		files, e := standards.Collect(dir)
		if e != nil {
			return finishError(e)
		}
		if e = run(filepath.ToSlash(dir), files, "passed", nil); e != nil {
			return finishError(e)
		}
	}
	groups := map[string]map[string]string{}
	for name := range report.Release.Corpus {
		source, e := standards.ReadCorpus(runner.Home, name)
		if e != nil {
			return finishError(e)
		}
		group := filepath.ToSlash(filepath.Dir(name))
		if strings.Contains(name, "v1 Spec Examples/") || strings.Contains(name, "Spec Annex A") {
			group = name
		}
		if groups[group] == nil {
			groups[group] = map[string]string{}
		}
		groups[group][filepath.Base(name)] = source
	}
	names := make([]string, 0, len(groups))
	for name := range groups {
		names = append(names, name)
	}
	sort.Strings(names)
	var failures []string
	for _, name := range names {
		findings := officialFindings(report.Release, name)
		expected := "passed"
		if len(findings) > 0 {
			expected = "failed"
		}
		if e := run("official/"+name, groups[name], expected, findings); e != nil {
			failures = append(failures, e.Error())
		}
	}
	controls := []struct {
		name, expected string
		files          map[string]string
	}{
		{"cross-file reference and SI library", "passed", map[string]string{"a/Use.sysml": "package Consumer { private import Definitions::*; part p : Vehicle; attribute length : ISQ::LengthValue = 2 [SI::m]; }", "z/Types.sysml": "package Definitions { part def Vehicle; }"}},
		{"no declarations leaked between projects", "failed", map[string]string{"Use.sysml": "package Consumer { part p : Definitions::Vehicle; }"}},
		{"anonymous definitions accepted", "passed", map[string]string{"Anonymous.sysml": "package Anonymous { part def ; }"}},
		{"unclosed definition rejected", "failed", map[string]string{"Broken.sysml": "package Broken { part def Vehicle {"}},
		{"unresolved type rejected with Unicode and CRLF", "failed", map[string]string{"Broken.sysml": "// 🛰\r\npackage Broken { part p : MissingType; }"}},
	}
	for _, c := range controls {
		if e = run(c.name, c.files, c.expected, nil); e != nil {
			return finishError(e)
		}
	}
	if len(failures) > 0 {
		return finishError(fmt.Errorf("official corpus failures: %s", strings.Join(failures, "; ")))
	}
	report.Status = "passed"
	return emitReport(path, report, out)
}
