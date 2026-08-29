package main

// integrations_wiring.go is the BRIDGE between the tenant-scoped DR integrations
// catalog (internal/dr/integrations) and the concrete vendor adapters the five
// builders landed in storageoffload / vmcapture / cybervault. The catalog package
// imports NONE of those adapter packages (to avoid an import cycle); this file —
// in package main, which already imports everything — is where the loop is
// CLOSED:
//
//   1. The integrations.Service is constructed with an AES-256-GCM envelope cipher
//      keyed from DR_INTEGRATIONS_ENC_KEY (base64 32 bytes). When the key is unset
//      the integrations API is DISABLED (not fatal): credentials cannot be sealed,
//      so the catalog simply does not run, and the rest of the DR service starts
//      normally. When the key is present the catalog is wired fully.
//
//   2. Each builder exported a stdlib connectivity probe that this file adapts to
//      an integrations.Connector (Vendor()+Test()) and registers on the service:
//        - storageoffload.ONTAPTestConnection   -> vendor "netapp_ontap"
//        - vmcapture.VSphereTestConnection       -> vendor "vmware_vsphere"
//        - cybervault.CloudVaultTestConnection   -> vendors aws_backup /
//          azure_backup / gcp_backup_dr (one probe, three vendor labels)
//
//   3. The *integrations.Router is returned for main to mount under /api/v1/dr and
//      the *integrations.Service is returned as an integrations.Resolver so the DR
//      factories (coverage.go) can fetch decrypted credentials at request time.
//
// ENV:
//   DR_INTEGRATIONS_ENC_KEY  base64-encoded 32-byte AES key (REQUIRED to enable the
//                            integrations API; unset => API disabled with a warning).

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/rs/zerolog"

	"github.com/clario360/platform/internal/database"
	"github.com/clario360/platform/internal/dr/cybervault"
	"github.com/clario360/platform/internal/dr/integrations"
	drrepo "github.com/clario360/platform/internal/dr/repository"
	"github.com/clario360/platform/internal/dr/storageoffload"
	"github.com/clario360/platform/internal/dr/vmcapture"
)

// integrationsPlane is the wired integrations catalog: the HTTP router to mount
// and the Resolver the DR factories consult. Either field may be nil when the
// encryption key is unset (the API is disabled); every consumer guards for nil.
type integrationsPlane struct {
	// router is the integrations HTTP surface; nil when the API is disabled.
	router *integrations.Router
	// resolver resolves the active integration + decrypted Config for a (tenant,
	// vendor) at request time; nil when the API is disabled, in which case the DR
	// factories keep their env-only behavior unchanged.
	resolver integrations.Resolver
}

// integrationsTenantRunner adapts the DR pool to the tenant-scoped transaction
// runner the integrations service expects (RLS SET LOCAL app.current_tenant_id),
// exactly like coverageTenantRunner does for vmcapture/storageoffload. It is a
// distinct type only because integrations.TenantRunner is its own (structurally
// identical) interface; the body is the same RLS-scoped transaction.
type integrationsTenantRunner struct{ pool *pgxpool.Pool }

func (r integrationsTenantRunner) RunWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(drrepo.DBTX) error) error {
	return database.RunWithTenant(ctx, r.pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

func (r integrationsTenantRunner) RunReadWithTenant(ctx context.Context, tenantID uuid.UUID, fn func(drrepo.DBTX) error) error {
	return database.RunReadWithTenant(ctx, r.pool, tenantID, func(tx pgx.Tx) error { return fn(tx) })
}

// configureIntegrationsPlane builds the integrations catalog service, registers
// the vendor connectors, and returns the router + resolver. When
// DR_INTEGRATIONS_ENC_KEY is unset (or invalid) it logs a clear warning and
// returns an empty plane (router and resolver both nil) so the rest of the DR
// service runs unchanged — the integrations API and registry-backed factory
// resolution are simply absent.
func configureIntegrationsPlane(
	db *pgxpool.Pool,
	metricsReg prometheus.Registerer,
	logger zerolog.Logger,
) *integrationsPlane {
	cipher, err := integrations.NewAESCipherFromEnv()
	if err != nil {
		logger.Warn().Err(err).
			Str("env", integrations.EncKeyEnv).
			Msg("dr integrations API disabled: set DR_INTEGRATIONS_ENC_KEY (base64 32-byte AES key) to enable external integration credential custody")
		return &integrationsPlane{}
	}

	runner := integrationsTenantRunner{pool: db}
	svc, err := integrations.NewService(integrations.ServiceConfig{
		Runner:  runner,
		Store:   integrations.NewStore(),
		Cipher:  cipher,
		Metrics: integrations.NewMetrics(metricsReg),
		Logger:  logger,
		// Durable, secret-free audit trail for every credential decryption
		// (ResolveActive / TestConnection), staged in the transactional outbox.
		Audit: newOutboxAuditSink(runner, logger),
	})
	if err != nil {
		// NewService only errors on a nil dependency, which cannot happen here; a
		// fatal is appropriate because it would be a programming error, not config.
		logger.Fatal().Err(err).Msg("failed to construct dr integrations service")
	}

	registerDRConnectors(svc, logger)

	router := integrations.NewRouter(svc, logger)
	logger.Info().Msg("dr integrations catalog wired (AES-256-GCM credential custody; netapp_ontap/vmware_vsphere/cloud-backup connectors registered)")
	return &integrationsPlane{router: router, resolver: svc}
}

// registerDRConnectors adapts each builder's exported stdlib connectivity probe
// to an integrations.Connector and registers it on the service. The probe
// functions live in the adapter packages (which do NOT import integrations); the
// adapter type below is the one-way bridge. A connector's Vendor() MUST equal the
// Integration.Vendor an operator stores (e.g. "netapp_ontap").
func registerDRConnectors(svc *integrations.Service, logger zerolog.Logger) {
	// storage_array: NetApp ONTAP. ONTAPTestConnection does GET /api/cluster and
	// returns nil on 2xx using the decrypted endpoint/username/token/CA.
	svc.RegisterConnector(integrations.StaticConnector{
		VendorName: storageoffload.ProviderNetAppONTAP, // "netapp_ontap"
		TestFunc: func(ctx context.Context, cfg integrations.Config) error {
			return storageoffload.ONTAPTestConnection(ctx, cfg.Endpoint, cfg.Username, cfg.Token, cfg.CACertPEM)
		},
	})

	// hypervisor: VMware vSphere/vCenter. VSphereTestConnection opens+deletes a
	// REST session (POST/DELETE /api/session) to prove credentials and TLS.
	svc.RegisterConnector(integrations.StaticConnector{
		VendorName: vmwareVSphereVendor, // "vmware_vsphere"
		TestFunc: func(ctx context.Context, cfg integrations.Config) error {
			return vmcapture.VSphereTestConnection(ctx, cfg.Endpoint, cfg.Username, cfg.Token, cfg.CACertPEM)
		},
	})

	// cloud_vault: one cloud-backup posture gateway probe (GET /healthz) registered
	// under each cloud-vault vendor label an operator may pick. CloudVaultTestConnection
	// takes (baseURL, token, caCertPEM): the integration Endpoint is the gateway URL.
	for _, vendor := range []string{
		string(cybervault.VaultProviderAWSBackup),   // "aws_backup"
		string(cybervault.VaultProviderAzureBackup), // "azure_backup"
		string(cybervault.VaultProviderGCPBackupDR), // "gcp_backup_dr"
	} {
		svc.RegisterConnector(integrations.StaticConnector{
			VendorName: vendor,
			TestFunc: func(ctx context.Context, cfg integrations.Config) error {
				return cybervault.CloudVaultTestConnection(ctx, cfg.Endpoint, cfg.Token, cfg.CACertPEM)
			},
		})
	}

	logger.Debug().Msg("dr integrations connectors registered: netapp_ontap, vmware_vsphere, aws_backup, azure_backup, gcp_backup_dr")
}

// vmwareVSphereVendor is the integration Vendor value for vCenter integrations.
// It is defined here (not in vmcapture) because vmcapture's BindingVMwareCBT
// constant is a binding-kind label ("vmware_cbt"), whereas the integration vendor
// is the product label an operator selects. The coverage binding factory maps a
// vmware_cbt BindingKind source to this vendor when resolving live credentials.
const vmwareVSphereVendor = "vmware_vsphere"

// Compile-time assertions: the bridge's connector adapters satisfy the catalog's
// Connector contract, and *integrations.Service satisfies Resolver (the package
// asserts this too; restated here so a signature drift breaks THIS file's build).
var (
	_ integrations.Connector = integrations.StaticConnector{}
	_ integrations.Resolver  = (*integrations.Service)(nil)
)
