package credential

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rs/zerolog"

	siemcrypto "github.com/clario360/platform/internal/siem/store/crypto"
	"github.com/clario360/platform/internal/vault"
)

// transitKeyForTenant is the Vault Transit KEK name used to wrap each tenant's
// DEK for LLM-credential encryption. It is distinct from the siem/dr key
// namespaces so LLM-credential DEKs never share a KEK with other subsystems.
func transitKeyForTenant(tenantID uuid.UUID) string {
	return "llm-tenant-" + tenantID.String()
}

// BuildResolver wires the full per-tenant LLM-credential chain from a database
// pool and the process Vault configuration (SIEM_VAULT_* env vars):
//
//	Vault client -> Transit -> DEKManager -> SecretCrypto -> Store -> Service
//
// The returned *Service is BOTH the management service (Set/Rotate/Delete/
// GetStatus) and the provider.TenantCredentialResolver injected into the shared
// Manager.
//
// It is NIL-SAFE for back-compat: if pool is nil OR Vault is not configured
// (SIEM_VAULT_ADDR / SIEM_VAULT_TOKEN absent), it returns (nil, nil, nil). The
// caller then leaves the Manager credential-unaware (env-only behavior),
// exactly as before this feature existed.
//
// On success it also returns a cleanup func that closes the Vault client and
// DEK manager; the caller should defer it.
func BuildResolver(ctx context.Context, pool *pgxpool.Pool, emit OutboxEmitter, logger zerolog.Logger) (svc *Service, cleanup func(), err error) {
	if pool == nil {
		return nil, nil, nil
	}

	vaultCfg, cfgErr := vault.ConfigFromEnv()
	if cfgErr != nil {
		// Vault not configured (or misconfigured) -> stay env-only. This is not a
		// fatal error: per-tenant credentials are simply unavailable.
		logger.Info().Err(cfgErr).Msg("vault not configured; per-tenant llm credentials disabled (env-only)")
		return nil, nil, nil
	}

	vaultClient, vcErr := vault.NewClient(ctx, vaultCfg)
	if vcErr != nil {
		return nil, nil, fmt.Errorf("credential: vault client: %w", vcErr)
	}

	dekMgr, dekErr := siemcrypto.NewDEKManager(siemcrypto.DEKManagerConfig{
		TransitKeyForTenant: transitKeyForTenant,
	}, siemcrypto.DEKManagerDeps{
		Pool:    pool,
		Transit: siemcrypto.NewTransit(vaultClient),
	})
	if dekErr != nil {
		_ = vaultClient.Close()
		return nil, nil, fmt.Errorf("credential: dek manager: %w", dekErr)
	}

	sc, scErr := siemcrypto.NewSecretCrypto(dekMgr)
	if scErr != nil {
		_ = dekMgr.Close()
		_ = vaultClient.Close()
		return nil, nil, fmt.Errorf("credential: secret crypto: %w", scErr)
	}

	service, svcErr := NewService(NewStore(pool), sc, emit)
	if svcErr != nil {
		_ = dekMgr.Close()
		_ = vaultClient.Close()
		return nil, nil, fmt.Errorf("credential: service: %w", svcErr)
	}

	cleanup = func() {
		_ = dekMgr.Close()
		_ = vaultClient.Close()
	}
	logger.Info().Msg("per-tenant llm credential resolver enabled (vault-backed)")
	return service, cleanup, nil
}
