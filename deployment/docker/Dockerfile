# syntax=docker/dockerfile:1

FROM docker.io/library/node:22-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build -- --outDir dist

FROM docker.io/library/golang:1.24-alpine AS build
RUN apk add --no-cache git ca-certificates
WORKDIR /src
COPY go.mod ./
COPY . .
COPY --from=web /web/dist ./internal/server/dist
ARG SYSML_CHANNEL=published
# Change SYSML_REFRESH to request fresh remote discovery when Docker would reuse this layer.
ARG SYSML_REFRESH=0
RUN go run ./cmd/skyview standards-update -channel "$SYSML_CHANNEL" -cache /tmp/sysml-downloads
ARG SKYVIEW_REVISION=""
ARG SKYVIEW_SOURCE_STATE=unknown
ARG SKYVIEW_SOURCE_TIME=""
ARG SKYVIEW_RELEASE_TAG=""
RUN package=github.com/Rexus/SkyView; \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -buildvcs=false \
    -ldflags="-s -w -X $package.stampedRevision=$SKYVIEW_REVISION -X $package.stampedSourceState=$SKYVIEW_SOURCE_STATE -X $package.stampedSourceTime=$SKYVIEW_SOURCE_TIME -X $package.stampedReleaseTag=$SKYVIEW_RELEASE_TAG" \
    -o /out/skyview ./cmd/skyview

RUN mkdir -p /out/workspace

FROM gcr.io/distroless/static-debian12:nonroot AS minimal
WORKDIR /app
COPY --from=build /out/skyview /app/skyview
COPY --from=build --chown=65532:65532 /out/workspace/ /data/
COPY LICENSE THIRD_PARTY_NOTICES.md /app/licenses/
ENV SKYVIEW_ADDR=0.0.0.0:8080 \
    SKYVIEW_WORKSPACE=/data
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/app/skyview"]

# Default image includes the pinned native checker. The minimal target keeps the Go-only runtime.
FROM docker.io/library/eclipse-temurin:21-jdk-jammy AS native-tools
COPY --from=build /out/skyview /usr/local/bin/skyview
RUN --mount=type=cache,target=/tmp/sysml-downloads \
    skyview standards-setup -toolchain /opt/sysml -cache /tmp/sysml-downloads

FROM docker.io/library/eclipse-temurin:21-jdk-jammy
WORKDIR /app
COPY --from=build /out/skyview /app/skyview
COPY --from=build /src/internal/standards/release.json /app/standards-release.json
COPY --from=native-tools /opt/sysml /opt/sysml
COPY --from=build --chown=65532:65532 /out/workspace/ /data/
COPY LICENSE THIRD_PARTY_NOTICES.md /app/licenses/
ENV SKYVIEW_ADDR=0.0.0.0:8080 \
    SKYVIEW_WORKSPACE=/data \
    SKYVIEW_SYSML_HOME=/opt/sysml
EXPOSE 8080
USER 65532:65532
ENTRYPOINT ["/app/skyview"]
