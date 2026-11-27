package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/Rexus/SkyView/internal/cli"
	"github.com/Rexus/SkyView/internal/server"
)

func main() {
	if len(os.Args) > 1 && !strings.HasPrefix(os.Args[1], "-") {
		os.Exit(cli.Run(os.Args[1:], os.Stdout, os.Stderr))
	}
	addr := flag.String("addr", envOr("SKYVIEW_ADDR", "0.0.0.0:8080"), "HTTP listen address")
	workspace := flag.String("workspace", envOr("SKYVIEW_WORKSPACE", "./workspace"), "workspace directory containing .sysml files")
	flag.Parse()

	if _, err := os.Stat(*workspace); err != nil {
		if err := os.MkdirAll(*workspace, 0o755); err != nil {
			log.Fatalf("create workspace: %v", err)
		}
	}

	app := server.New(*workspace)
	httpServer := &http.Server{
		Addr:              *addr,
		Handler:           app.Handler(),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      60 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	fmt.Printf("SkyView — SysML v2 workbench\n")
	fmt.Printf("  listening on http://%s\n", *addr)
	fmt.Printf("  workspace    %s\n", *workspace)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("server: %v", err)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
