.PHONY: build test test-cover test-short test-integration test-security test-all e2e-test \
       lint lint-fix fmt migrate-up migrate-down migrate-create migrate-status \
       seed docker-up docker-down docker-clean docker-wait docker-build \
       docker-test-up docker-test-down \
       run-all run frontend-install frontend-dev frontend-build frontend-lint frontend-test test-ai \
       generate-api-docs generate-sdk check-sdk-drift generate-mocks validate-api proto-gen \
       loadtest helm-lint helm-template clean help \
       siem-build siem-run siem-test siem-test-integration siem-lint siem-clean \
       siem-up siem-down siem-logs \
       dr-agent-build dr-agent-build-static dr-agent-image dr-test dr-test-integration dr-worm-integration dr-agent-acceptance dr-lint

# ---------------------------------------------------------------------------
# Variables
# ---------------------------------------------------------------------------
GO          := go
GOFLAGS     := -race
BINARY_DIR  := backend/bin
SERVICES    := api-gateway iam-service event-bus workflow-engine audit-service \
               notification-service file-service siem-service license-service \
               cyber-service data-service acta-service lex-service visus-service \
               clario-dr-service clario-dr-agent
TOOLS       := migrator data-seeder system-seeder
ALL_TARGETS := $(SERVICES) $(TOOLS)
MIGRATE     := $(GO) run -C backend ./cmd/migrator
DC          := docker compose
DC_TEST     := docker compose -f docker-compose.test.yml
HELM_CHART  := deploy/helm/clario360
SEED_SCALE  ?= large
HELM_DUMMY_SECRET_ARGS := \
	--set-string secrets.database.password=dummy-database-password \
	--set-string secrets.redis.password=dummy-redis-password \
	--set-string secrets.kafka.saslUsername=dummy-kafka-user \
	--set-string secrets.kafka.saslPassword=dummy-kafka-password \
	--set-string secrets.jwt.rsaPrivateKeyPem=dummy-jwt-private-key \
	--set-string secrets.jwt.rsaPublicKeyPem=dummy-jwt-public-key \
	--set-string secrets.encryption.key=dummy-encryption-key \
	--set-string secrets.minio.accessKey=dummy-minio-access-key \
	--set-string secrets.minio.secretKey=dummy-minio-secret-key \
	--set-string secrets.smtp.username=dummy-smtp-user \
	--set-string secrets.smtp.password=dummy-smtp-password \
	--set-string secrets.notification.webhookHmacSecret=dummy-notification-webhook-secret
HELM_LINT_ARGS ?=
HELM_TEMPLATE_ARGS ?=
DR_AGENT_IMAGE ?= clario360/clario-dr-agent:latest

# Service port mapping (used by run target)
PORT_api-gateway          := 8080
PORT_iam-service          := 8081
PORT_workflow-engine      := 8083
PORT_audit-service        := 8084
PORT_cyber-service        := 8085
PORT_data-service         := 8086
PORT_acta-service         := 8087
PORT_lex-service          := 8088
PORT_visus-service        := 8089
PORT_notification-service := 8090
PORT_file-service         := 8091
PORT_siem-service         := 8094
PORT_license-service      := 8096
PORT_clario-dr-service    := 8097
PORT_clario-dr-agent      := 9098

# ---------------------------------------------------------------------------
# Default
# ---------------------------------------------------------------------------
help: ## Show this help
	@echo "Clario 360 — Build & Development Targets"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-24s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
build: ## Build all backend services
	@echo "==> Building all services..."
	@mkdir -p $(BINARY_DIR)
	@set -e; for svc in $(ALL_TARGETS); do \
		echo "  -> $$svc"; \
		$(GO) build -C backend -o bin/$$svc ./cmd/$$svc; \
	done
	@echo "==> Done."

build-%: ## Build a specific service (e.g., make build-api-gateway)
	@mkdir -p $(BINARY_DIR)
	$(GO) build -C backend -o bin/$* ./cmd/$*

# ---------------------------------------------------------------------------
# Run
# ---------------------------------------------------------------------------
run-all: ## Start all backend services in parallel
	@echo "==> Starting all services..."
	@for svc in $(SERVICES); do \
		echo "  -> Starting $$svc"; \
		$(GO) run -C backend ./cmd/$$svc & \
	done; \
	echo "==> All services started. Press Ctrl+C to stop."; \
	wait

run: ## Run a specific service (e.g., make run SERVICE=iam-service)
	@if [ -z "$(SERVICE)" ]; then \
		echo "Usage: make run SERVICE=<service-name>"; \
		echo "Available services: $(SERVICES)"; \
		exit 1; \
	fi
	@echo "==> Starting $(SERVICE)..."
	$(GO) run -C backend ./cmd/$(SERVICE)

dev: docker-up ## Start all dependencies and run the API gateway
	@echo "==> Starting API gateway..."
	$(GO) run -C backend ./cmd/api-gateway

# ---------------------------------------------------------------------------
# Test
# ---------------------------------------------------------------------------
test: ## Run all backend unit tests with race detector
	GOWORK=off $(GO) test -C backend $(GOFLAGS) ./...

test-cover: ## Run tests with coverage report
	GOWORK=off $(GO) test -C backend $(GOFLAGS) -coverprofile=coverage.out ./...
	$(GO) tool cover -C backend -html=coverage.out -o coverage.html
	@echo "Coverage report: backend/coverage.html"

test-short: ## Run short tests only (skip integration)
	GOWORK=off $(GO) test -C backend -short ./...

test-integration: docker-test-up ## Run integration tests (requires Docker)
	@echo "==> Waiting for test dependencies..."
	@sleep 5
	GOWORK=off $(GO) test -C backend $(GOFLAGS) -tags=integration ./...
	@$(MAKE) docker-test-down

e2e-test: ## Run end-to-end tests (requires full Docker environment)
	@echo "==> Running end-to-end tests..."
	GOWORK=off $(GO) test -C backend $(GOFLAGS) -tags=e2e ./e2e_tests/...

test-security: ## Run security-focused tests and static analysis
	@echo "==> Running security tests..."
	@if command -v gosec >/dev/null 2>&1; then \
		cd backend && gosec -quiet ./...; \
	else \
		echo "  [SKIP] gosec not installed — run: go install github.com/securego/gosec/v2/cmd/gosec@latest"; \
	fi
	@if command -v trivy >/dev/null 2>&1; then \
		trivy fs --security-checks vuln backend/; \
	else \
		echo "  [SKIP] trivy not installed — see https://aquasecurity.github.io/trivy/"; \
	fi
	@echo "==> Running npm audit..."
	@cd frontend && npm audit --audit-level=critical 2>/dev/null || true
	@echo "==> Security tests complete."

test-all: test test-security frontend-test ## Run all tests (unit + security + frontend)
	@echo "==> All tests complete."

loadtest: ## Run load tests (usage: make loadtest SCENARIO=smoke)
	@if [ -z "$(SCENARIO)" ]; then \
		echo "Usage: make loadtest SCENARIO=<smoke|load|stress|soak>"; \
		exit 1; \
	fi
	@if command -v k6 >/dev/null 2>&1; then \
		k6 run deploy/loadtest/$(SCENARIO).js; \
	else \
		echo "k6 not installed — see https://k6.io/docs/getting-started/installation/"; \
		exit 1; \
	fi

frontend-test: ## Run frontend tests
	cd frontend && npm test -- --run 2>/dev/null || cd frontend && npx vitest run

test-ai: ## Run WatheeqTech Second Brain (ai/second-brain) pure-logic pytest
	cd ai/second-brain && python3 -m pip install --quiet --upgrade pytest && python3 -m pytest -q

# ---------------------------------------------------------------------------
# Lint & Format
# ---------------------------------------------------------------------------
lint: ## Run golangci-lint on backend
	cd backend && golangci-lint run ./...

lint-fix: ## Run golangci-lint with auto-fix
	cd backend && golangci-lint run --fix ./...

fmt: ## Format Go source code
	@echo "==> Formatting Go code..."
	cd backend && $(GO) fmt ./...
	@echo "==> Done."

frontend-lint: ## Lint frontend code
	cd frontend && npm run lint

# ---------------------------------------------------------------------------
# Migrations
# ---------------------------------------------------------------------------
migrate-up: ## Run all database migrations
	$(MIGRATE) -direction up

migrate-down: ## Rollback last migration
	$(MIGRATE) -direction down

migrate-create: ## Create a new migration (usage: make migrate-create NAME=create_users)
	@if [ -z "$(NAME)" ]; then echo "Usage: make migrate-create NAME=migration_name"; exit 1; fi
	migrate create -ext sql -dir backend/migrations -seq $(NAME)

migrate-status: ## Show migration status for all databases
	@echo "==> Migration status"
	@for db_dir in backend/migrations/*/; do \
		db=$$(basename $$db_dir); \
		count=$$(ls -1 $$db_dir/*.sql 2>/dev/null | wc -l | tr -d ' '); \
		echo "  $$db: $$count migration files"; \
	done

# ---------------------------------------------------------------------------
# Seed
# ---------------------------------------------------------------------------
seed: ## Seed the database with development data (override with SEED_SCALE=small|large|massive)
	$(GO) run -C backend ./cmd/system-seeder -scale $(SEED_SCALE)

# ---------------------------------------------------------------------------
# Code Generation
# ---------------------------------------------------------------------------
generate-api-docs: ## Refresh the embedded Watheeq reviewed contract and route inventory
	@echo "==> Generating Watheeq API documentation inputs..."
	@python3 scripts/generate-watheeq-api-docs.py

generate-sdk: generate-api-docs ## Generate TypeScript types from the schema-reviewed Watheeq contract
	@echo "==> Generating Watheeq TypeScript API types..."
	@mkdir -p frontend/src/types
	@npx --yes openapi-typescript@7.10.1 docs/api/watheeq-lex-service.openapi.yaml \
		-o frontend/src/types/watheeq-api.generated.ts
	@echo "==> Generated: frontend/src/types/watheeq-api.generated.ts"

check-sdk-drift: ## Fail when generated Watheeq TypeScript API types are stale
	@echo "==> Checking Watheeq TypeScript API type drift..."
	@python3 scripts/generate-watheeq-api-docs.py --check
	@mkdir -p .tmp
	@npx --yes openapi-typescript@7.10.1 docs/api/watheeq-lex-service.openapi.yaml \
		-o .tmp/watheeq-api.generated.ts
	@cmp -s .tmp/watheeq-api.generated.ts frontend/src/types/watheeq-api.generated.ts || \
		(echo "  [ERROR] generated Watheeq types are stale; run: make generate-sdk"; exit 1)

generate-mocks: ## Generate Go mocks for testing
	@echo "==> Generating Go mocks..."
	@if command -v mockgen >/dev/null 2>&1; then \
		cd backend && go generate ./...; \
	else \
		echo "  [SKIP] mockgen not installed — run: go install go.uber.org/mock/mockgen@latest"; \
	fi

validate-api: ## Validate OpenAPI specification
	@echo "==> Validating all OpenAPI specs..."
	@set -e; \
		specs="$$(find docs/api docs/openapi -type f \( -name '*.yaml' -o -name '*.yml' \) -print | sort)"; \
		if [ -z "$$specs" ]; then \
			echo "  [ERROR] no OpenAPI specifications found"; \
			exit 1; \
		fi; \
		for spec in $$specs; do \
			echo "  -> $$spec"; \
			npx --yes @redocly/cli lint "$$spec"; \
		done
	@python3 scripts/generate-watheeq-api-docs.py --check
	@mkdir -p .tmp
	@$(GO) run -C backend ./cmd/watheeq-openapi > .tmp/watheeq-openapi.generated.json
	@npx --yes @redocly/cli lint .tmp/watheeq-openapi.generated.json
	@$(GO) test -C backend ./internal/lex/apidocs

proto-gen: ## Generate protobuf Go code from .proto files
	@echo "==> Generating protobuf code..."
	@find backend/proto -name '*.proto' -print0 2>/dev/null | xargs -0 -r protoc \
		--go_out=backend --go_opt=paths=source_relative \
		--go-grpc_out=backend --go-grpc_opt=paths=source_relative \
		-I backend/proto
	@echo "==> Done."

# ---------------------------------------------------------------------------
# Docker — Local Development
# ---------------------------------------------------------------------------
docker-up: ## Start all local dependencies (PostgreSQL, Redis, Kafka, MinIO)
	$(DC) up -d
	@echo "==> Waiting for services to be healthy..."
	@$(DC) ps

docker-down: ## Stop all local dependencies
	$(DC) down

docker-clean: ## Stop and remove all volumes (WARNING: destroys data)
	$(DC) down -v

docker-wait: ## Wait for all Docker services to be healthy
	@echo "==> Waiting for services to be healthy..."
	@timeout=60; elapsed=0; \
	while [ $$elapsed -lt $$timeout ]; do \
		healthy=$$($(DC) ps --format json 2>/dev/null | grep -c '"healthy"' || echo 0); \
		total=$$($(DC) ps -q 2>/dev/null | wc -l | tr -d ' '); \
		echo "  $$healthy/$$total services healthy ($$elapsed""s)"; \
		if [ "$$healthy" -ge "$$total" ] && [ "$$total" -gt 0 ]; then \
			echo "==> All services healthy!"; \
			exit 0; \
		fi; \
		sleep 5; \
		elapsed=$$((elapsed + 5)); \
	done; \
	echo "==> WARNING: Timed out waiting for healthy services."; \
	$(DC) ps; \
	exit 1

docker-test-up: ## Start test dependencies
	$(DC_TEST) up -d
	@echo "==> Test dependencies starting..."

docker-test-down: ## Stop test dependencies
	$(DC_TEST) down -v

# ---------------------------------------------------------------------------
# Docker — Build Images
# ---------------------------------------------------------------------------
docker-build: ## Build Docker images for all services
	@echo "==> Building Docker images..."
	@for svc in $(SERVICES); do \
		echo "  -> clario360/$$svc"; \
		docker build -f deploy/docker/Dockerfile.backend \
			--build-arg SERVICE=$$svc \
			-t clario360/$$svc:latest \
			backend/; \
	done
	@echo "  -> clario360/frontend"
	@docker build -f deploy/docker/Dockerfile.frontend \
		-t clario360/frontend:latest \
		frontend/
	@echo "==> Done."

docker-build-%: ## Build Docker image for a specific service
	docker build -f deploy/docker/Dockerfile.backend \
		--build-arg SERVICE=$* \
		-t clario360/$*:latest \
		backend/

# ---------------------------------------------------------------------------
# Frontend
# ---------------------------------------------------------------------------
frontend-install: ## Install frontend dependencies
	cd frontend && npm install

frontend-dev: ## Start frontend dev server
	cd frontend && npm run dev

frontend-build: ## Build frontend for production
	cd frontend && npm run build

# ---------------------------------------------------------------------------
# Helm
# ---------------------------------------------------------------------------
helm-lint: ## Lint Helm chart
	@if [ -d "$(HELM_CHART)" ]; then \
		helm lint $(HELM_CHART) $(HELM_DUMMY_SECRET_ARGS) $(HELM_LINT_ARGS); \
	else \
		echo "  [SKIP] Helm chart not found at $(HELM_CHART)"; \
	fi

helm-template: ## Render Helm templates locally
	@if [ -d "$(HELM_CHART)" ]; then \
		helm template clario360 $(HELM_CHART) $(HELM_DUMMY_SECRET_ARGS) $(HELM_TEMPLATE_ARGS); \
	else \
		echo "  [SKIP] Helm chart not found at $(HELM_CHART)"; \
	fi

# ---------------------------------------------------------------------------
# Clean
# ---------------------------------------------------------------------------
clean: ## Remove build artifacts
	rm -rf $(BINARY_DIR)
	rm -f backend/coverage.out backend/coverage.html

# ---------------------------------------------------------------------------
# SIEM (SIEM-01)
# ---------------------------------------------------------------------------
siem-build: ## Build the siem-service binary into backend/bin/
	@mkdir -p $(BINARY_DIR)
	GOWORK=off $(GO) build -C backend -ldflags="-s -w \
		-X github.com/clario360/platform/internal/siem/internal/buildinfo.Version=$$(git describe --tags --always 2>/dev/null || echo dev) \
		-X github.com/clario360/platform/internal/siem/internal/buildinfo.Commit=$$(git rev-parse --short HEAD 2>/dev/null || echo unknown) \
		-X github.com/clario360/platform/internal/siem/internal/buildinfo.BuildTime=$$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
		-o bin/siem-service ./cmd/siem-service

siem-run: siem-build ## Build and run siem-service locally
	./backend/bin/siem-service

siem-test: ## Unit-test the siem packages with -race
	GOWORK=off $(GO) test -C backend -race -count=1 ./internal/siem/... ./cmd/siem-service/...

siem-test-integration: ## Run siem integration tests (requires Docker)
	SIEM_INTEGRATION=1 GOWORK=off $(GO) test -C backend -race -count=1 -tags=integration ./cmd/siem-service/...

siem-lint: ## go vet on the siem packages
	GOWORK=off $(GO) vet -C backend ./internal/siem/... ./cmd/siem-service/...

siem-clean: ## Remove siem-service binary
	rm -f backend/bin/siem-service

.PHONY: siem-up siem-down siem-logs
siem-up: ## Start the SIEM data-plane (opensearch + minio-siem + vault-dev + dashboards)
	COMPOSE_PROFILES=dev docker compose up -d opensearch minio-siem siem-store-init vault-dev opensearch-dashboards
	@echo "Waiting for healthchecks..."
	@for i in 1 2 3 4 5 6 7 8 9 10 11 12; do \
		sleep 5; \
		docker compose ps --format json | grep -q '"Health":"healthy"' && break; \
	done
	docker compose ps opensearch minio-siem vault-dev

siem-down: ## Stop the SIEM data-plane (preserves volumes)
	docker compose stop opensearch opensearch-dashboards minio-siem siem-store-init vault-dev

siem-logs: ## Tail siem-service + data-plane logs
	docker compose logs -f --tail=100 opensearch minio-siem vault-dev siem-service

# ---------------------------------------------------------------------------
# ClarioDR (DataStream / DR — WP-7 capture agent + control plane)
# ---------------------------------------------------------------------------
dr-agent-build: ## Build the clario-dr-agent binary into backend/bin/
	@mkdir -p $(BINARY_DIR)
	GOWORK=off $(GO) build -C backend -o bin/clario-dr-agent ./cmd/clario-dr-agent

dr-agent-build-static: ## Build a STATIC, air-gap-friendly clario-dr-agent (CGO_ENABLED=0)
	@mkdir -p $(BINARY_DIR)
	CGO_ENABLED=0 GOWORK=off $(GO) build -C backend -ldflags="-s -w" -o bin/clario-dr-agent ./cmd/clario-dr-agent
	@file backend/bin/clario-dr-agent || true

dr-agent-image: ## Build the clario-dr-agent reference container image
	docker build -f deploy/docker/Dockerfile.clario-dr-agent -t $(DR_AGENT_IMAGE) .

dr-test: ## Unit-test the DR + datastream-core packages with -race
	GOWORK=off $(GO) test -C backend -race -count=1 ./internal/dr/... ./internal/datastream/... ./cmd/clario-dr-agent/... ./cmd/clario-dr-service/...

dr-test-integration: ## Run DR integration tests (requires Docker / testcontainers)
	GOWORK=off $(GO) test -C backend -count=1 -tags=integration ./internal/dr/...

dr-worm-integration: ## Run WORM object-lock enforcement integration tests (ephemeral MinIO, GOVERNANCE only; requires Docker)
	GOWORK=off $(GO) test -C backend -count=1 -tags=integration -timeout=15m ./internal/dr/worm/...

dr-agent-acceptance: ## Run clario-dr-agent + DataStream Postgres acceptance tests (requires Docker / testcontainers)
	GOWORK=off $(GO) test -C backend -race -count=1 -tags=integration -p=1 -timeout=20m ./cmd/clario-dr-agent/... ./internal/dr/agent ./internal/datastream/core

dr-lint: ## go vet the DR + datastream-core packages
	GOWORK=off $(GO) vet -C backend ./internal/dr/... ./internal/datastream/... ./cmd/clario-dr-agent/... ./cmd/clario-dr-service/...

.PHONY: siem-pki-bootstrap
siem-pki-bootstrap: ## Bootstrap Vault PKI mounts + root CA for SIEM-03 (idempotent)
	@echo "Applying SIEM Vault policy..."
	@VAULT_ADDR=$${VAULT_ADDR:-http://localhost:8200} VAULT_TOKEN=$${VAULT_TOKEN:-siem-dev-root-token-do-not-use-in-prod} \
	  vault policy write siem-service deploy/vault/siem-service.hcl
	@echo "Ensuring PKI root mount + root CA..."
	@VAULT_ADDR=$${VAULT_ADDR:-http://localhost:8200} VAULT_TOKEN=$${VAULT_TOKEN:-siem-dev-root-token-do-not-use-in-prod} \
	  vault secrets list -format=json | grep -q '"pki-siem-root/"' || \
	  VAULT_ADDR=$${VAULT_ADDR:-http://localhost:8200} VAULT_TOKEN=$${VAULT_TOKEN:-siem-dev-root-token-do-not-use-in-prod} \
	  vault secrets enable -path=pki-siem-root -default-lease-ttl=87600h -max-lease-ttl=87600h pki
	@VAULT_ADDR=$${VAULT_ADDR:-http://localhost:8200} VAULT_TOKEN=$${VAULT_TOKEN:-siem-dev-root-token-do-not-use-in-prod} \
	  vault read pki-siem-root/ca/pem >/dev/null 2>&1 || \
	  VAULT_ADDR=$${VAULT_ADDR:-http://localhost:8200} VAULT_TOKEN=$${VAULT_TOKEN:-siem-dev-root-token-do-not-use-in-prod} \
	  vault write -field=certificate pki-siem-root/root/generate/internal \
	    common_name="Clario360 SIEM Root CA" ttl=87600h key_type=ec key_bits=256 >/dev/null
	@echo "Ensuring enrollment-JWT signing key..."
	@VAULT_ADDR=$${VAULT_ADDR:-http://localhost:8200} VAULT_TOKEN=$${VAULT_TOKEN:-siem-dev-root-token-do-not-use-in-prod} \
	  vault read transit/keys/siem-enrollment-jwt >/dev/null 2>&1 || \
	  VAULT_ADDR=$${VAULT_ADDR:-http://localhost:8200} VAULT_TOKEN=$${VAULT_TOKEN:-siem-dev-root-token-do-not-use-in-prod} \
	  vault write -f transit/keys/siem-enrollment-jwt type=ed25519
	@echo "SIEM-03 PKI bootstrap complete."
