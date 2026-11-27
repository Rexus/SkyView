{
  description = "SkyView — a modern SysML v2 workbench (Go + React)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        version = "0.1.0";

        # Frontend: build the Vite/React app into internal/server/dist.
        frontend = pkgs.buildNpmPackage {
          pname = "skyview-web";
          inherit version;
          src = ./web;
          nodejs = pkgs.nodejs_22;
          npmDepsHash = "sha256-luJ3ltnBBHc5PHy6V0MpMwwQ91vFRL1YGlTDhtdyFnA=";
          buildPhase = ''
            runHook preBuild
            npm run build -- --outDir dist
            runHook postBuild
          '';
          installPhase = ''
            runHook preInstall
            mkdir -p $out
            cp -r dist/. $out/
            runHook postInstall
          '';
        };

        skyview = pkgs.buildGoModule {
          pname = "skyview";
          inherit version;
          src = ./.;
          vendorHash = null;
          subPackages = [ "cmd/skyview" ];
          ldflags = [ "-s" "-w" ];
          # Embed the built frontend where go:embed expects it.
          preBuild = ''
            mkdir -p internal/server/dist
            cp -r ${frontend}/. internal/server/dist/
          '';
        };
      in {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            go
            gopls
            gotools
            nodejs_22
            typescript
            typescript-language-server
            git
            curl
            jq
            skopeo
            gnumake
          ];

          shellHook = ''
            echo ""
            echo "  SkyView — SysML v2 workbench"
            echo "  go $(go version | cut -d' ' -f3)   node $(node --version)"
            echo ""
            echo "  make dev-api  # Go API + built UI on :8080"
            echo "  make dev-web  # Vite dev server on :5173"
            echo "  make build    # single binary with embedded UI"
            echo ""
          '';
        };

        packages.default = skyview;
        packages.skyview = skyview;
      });
}
