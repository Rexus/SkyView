SHELL := bash
IMAGE ?= skyview:local
SKAFFOLD_FLAGS ?=
SYSML_CHANNEL ?= published
SYSML_REFRESH ?= $(shell date -u +%Y%m%dT%H%M%SZ)

.PHONY: dev-api dev-web build run test fmt vet docker deploy deploy-dev clean

dev-api:
	nix develop --command go run ./cmd/skyview

dev-web:
	nix develop --command bash -c 'cd web && npm run dev'

build:
	SYSML_CHANNEL=$(SYSML_CHANNEL) nix develop --command bash deployment/go/build.sh

run: build
	./bin/local/skyview

test:
	nix develop --command go test . ./cmd/... ./internal/... ./examples/...

vet:
	nix develop --command go vet . ./cmd/... ./internal/... ./examples/...

fmt:
	nix develop --command bash -c 'gofmt -w version.go version_test.go cmd internal examples'

docker:
	SYSML_CHANNEL=$(SYSML_CHANNEL) SYSML_REFRESH=$(SYSML_REFRESH) bash deployment/docker/build.sh -t $(IMAGE)

deploy:
	SYSML_CHANNEL=$(SYSML_CHANNEL) SYSML_REFRESH=$(SYSML_REFRESH) \
	  nix develop --command skaffold run --filename deployment/caas/skaffold.yaml $(SKAFFOLD_FLAGS)

deploy-dev:
	SYSML_CHANNEL=$(SYSML_CHANNEL) SYSML_REFRESH=$(SYSML_REFRESH) \
	  nix develop --command skaffold dev --filename deployment/caas/skaffold.yaml --cleanup=false $(SKAFFOLD_FLAGS)

clean:
	rm -rf bin web/dist internal/server/dist/assets
