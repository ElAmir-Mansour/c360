# syntax=docker/dockerfile:1.6
#
# Multi-stage build for siem-service.
# Mirrors backend/cmd/file-service/Dockerfile per the parent task's
# "use the most recently shipped service as the template" rule.

FROM golang:1.25.12-alpine AS builder

RUN apk add --no-cache git ca-certificates

WORKDIR /build

# Build-arg-driven version metadata. Default values keep `docker build`
# usable without --build-arg; CI overrides them.
ARG VERSION=dev
ARG COMMIT=unknown
ARG BUILD_TIME=unknown

COPY go.mod go.sum ./
RUN go mod download

COPY . .

# -ldflags injects buildinfo via the well-known symbols.
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build \
      -ldflags="-s -w \
        -X github.com/clario360/platform/internal/siem/internal/buildinfo.Version=${VERSION} \
        -X github.com/clario360/platform/internal/siem/internal/buildinfo.Commit=${COMMIT} \
        -X github.com/clario360/platform/internal/siem/internal/buildinfo.BuildTime=${BUILD_TIME}" \
      -o /siem-service ./cmd/siem-service

# Distroless static image: smallest attack surface for a Go binary.
FROM gcr.io/distroless/static-debian12 AS runtime

LABEL org.opencontainers.image.title="clario360-siem-service"
LABEL org.opencontainers.image.description="Clario360 SIEM ingestion + correlation service"
LABEL org.opencontainers.image.vendor="Clario360"
LABEL org.opencontainers.image.source="https://github.com/clario360/platform"
LABEL org.opencontainers.image.licenses="proprietary"

COPY --from=builder /siem-service /siem-service
# Migrations are read at startup from the working directory.
COPY --from=builder /build/migrations/siem_db /migrations/siem_db

USER 65534:65534

EXPOSE 8094
EXPOSE 9082

ENTRYPOINT ["/siem-service"]
