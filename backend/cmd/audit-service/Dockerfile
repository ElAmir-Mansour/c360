# Stage 1: Build
FROM golang:1.25.12-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache git ca-certificates

# Cache dependencies
COPY go.mod go.sum ./
RUN GOWORK=off go mod download

# Copy source
COPY . .

# Build static binary
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GOWORK=off \
    go build -a -installsuffix cgo \
    -ldflags="-w -s" \
    -o /audit-service \
    ./cmd/audit-service

# Stage 2: Minimal runtime image
FROM gcr.io/distroless/static-debian12

# Copy TLS certificates from builder
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

# Copy the static binary
COPY --from=builder /audit-service /audit-service

# Run as non-root (nobody:nogroup = 65534:65534)
USER 65534:65534

# Public API port
EXPOSE 8084

ENTRYPOINT ["/audit-service"]
