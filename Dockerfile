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
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/skyview ./cmd/skyview

RUN mkdir -p /out/workspace

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=build /out/skyview /app/skyview
COPY --from=build --chown=65532:65532 /out/workspace/ /data/
COPY LICENSE THIRD_PARTY_NOTICES.md /app/licenses/
ENV SKYVIEW_ADDR=0.0.0.0:8080 \
    SKYVIEW_WORKSPACE=/data
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/app/skyview"]
