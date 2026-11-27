SHELL := bash

.PHONY: dev-api dev-web build run test fmt vet docker deploy deploy-dev clean

dev-api:
	nix develop --command go run ./cmd/skyview

dev-web:
	nix develop --command bash -c 'cd web && npm run dev'

build:
	nix develop --command bash -c 'cd web && npm run build'
	nix develop --command go build -o bin/skyview ./cmd/skyview

run: build
	./bin/skyview

test:
	nix develop --command go test ./...

vet:
	nix develop --command go vet ./...

fmt:
	nix develop --command bash -c 'gofmt -w cmd internal'

docker:
	docker build -t registry.example.com/library/skyview:dev .

deploy:
	@HARBOR_USER=$${HARBOR_USER:-admin} \
	 HARBOR_PASSWORD=$${HARBOR_PASSWORD:-$$(kubectl -n harbor get secret harbor-core -o jsonpath='{.data.HARBOR_ADMIN_PASSWORD}' | base64 -d)} \
	 nix develop --command skaffold run --cache-artifacts=false --insecure-registry=registry.example.com

deploy-dev:
	@HARBOR_USER=$${HARBOR_USER:-admin} \
	 HARBOR_PASSWORD=$${HARBOR_PASSWORD:-$$(kubectl -n harbor get secret harbor-core -o jsonpath='{.data.HARBOR_ADMIN_PASSWORD}' | base64 -d)} \
	 nix develop --command skaffold dev --cache-artifacts=false --insecure-registry=registry.example.com

clean:
	rm -rf bin web/dist internal/server/dist/assets
