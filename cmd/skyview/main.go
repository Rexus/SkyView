package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/Rexus/SkyView/internal/cli"
	"github.com/Rexus/SkyView/internal/server"
)

func main() {
	if len(os.Args) > 1 && !strings.HasPrefix(os.Args[1], "-") {
		os.Exit(cli.Run(os.Args[1:], os.Stdout, os.Stderr))
	}
	addr := flag.String("addr", envOr("SKYVIEW_ADDR", "127.0.0.1:8080"), "HTTP listen address")
	workspace := flag.String("workspace", envOr("SKYVIEW_WORKSPACE", "./workspace"), "server data directory for workspaces and managed projects")
	mode := flag.String("mode", envOr("SKYVIEW_MODE", "single-user"), "deployment mode: single-user or multi-user")
	var localProjects projectFlags
	flag.Var(&localProjects, "project", "expose an existing server directory as NAME=PATH (repeatable)")
	flag.Parse()

	var handler http.Handler
	switch *mode {
	case "single-user":
		handler = localHandler(*workspace, localProjects)
	case "multi-user":
		if len(localProjects) != 0 {
			log.Fatal("-project is available in single-user mode only")
		}
		var err error
		handler, err = server.NewHosted(*workspace, os.Getenv("SKYVIEW_ACCOUNTS_FILE"), os.Getenv("SKYVIEW_PUBLIC_URL"))
		if err != nil {
			log.Fatal(err)
		}
	default:
		log.Fatal("-mode must be single-user or multi-user")
	}

	httpServer := &http.Server{
		Addr:              *addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      150 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	fmt.Printf("SkyView — SysML v2 workbench\n")
	fmt.Printf("  listening on http://%s\n", *addr)
	fmt.Printf("  mode         %s\n", *mode)
	fmt.Printf("  workspace    %s\n", *workspace)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	stopped := make(chan error, 1)
	go func() { stopped <- httpServer.ListenAndServe() }()
	select {
	case err := <-stopped:
		if !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server: %v", err)
		}
	case <-ctx.Done():
		stop()
		shutdown, cancel := context.WithTimeout(context.Background(), 130*time.Second)
		defer cancel()
		if err := httpServer.Shutdown(shutdown); err != nil {
			log.Printf("server shutdown: %v", err)
		}
	}
}

func localHandler(workspace string, localProjects projectFlags) http.Handler {
	if _, err := os.Stat(workspace); err != nil {
		if err := os.MkdirAll(workspace, 0o755); err != nil {
			log.Fatalf("create workspace: %v", err)
		}
	}

	app := server.New(workspace)
	for _, entry := range localProjects {
		name, directory, ok := strings.Cut(entry, "=")
		if !ok {
			log.Fatal("-project requires NAME=PATH")
		}
		if err := app.ConfigureProject(name, directory); err != nil {
			log.Fatalf("configure project: %v", err)
		}
	}
	return app.Handler()
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

type projectFlags []string

func (p *projectFlags) String() string         { return strings.Join(*p, ", ") }
func (p *projectFlags) Set(value string) error { *p = append(*p, value); return nil }
