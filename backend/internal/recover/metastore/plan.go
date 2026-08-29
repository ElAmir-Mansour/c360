package metastore

import (
	"fmt"
	"sort"
	"strings"

	"github.com/clario360/platform/internal/dr/runbookstudio"
)

// runbookNameFor builds the deterministic runbook name a populate produces for
// an application, so a re-populate of the same app updates a stable concept and
// the name reads meaningfully in Runbook Studio.
func runbookNameFor(app Application) string {
	return fmt.Sprintf("Recover: %s", app.Name)
}

// deriveImportSteps is the REAL population logic: it projects an application's
// recovery-relevant metadata into the ordered studio import steps that
// Runbook Studio materializes into an editable task DAG. The ordering encodes
// the recovery sequence the metadata implies:
//
//  1. A notify step that pages the application's incident/technical owners.
//  2. For each HARD dependency (sorted by app_key), a recover-dependency step —
//     a dependent application cannot come up before the things it hard-depends
//     on, so these precede the boot phases.
//  3. For mission-critical / tier-1 applications, an explicit approval gate
//     before any recovery boot (the tier's human gate).
//  4. For each recovery-target environment (sorted by key), a provision step
//     that brings the environment up in its cloud account/region.
//  5. A verification step confirming the application is healthy in the recovered
//     environment(s).
//
// Every step carries structured params bound to the REAL metadata values
// (app_key, rto target, owners, dependency keys, env/region/provider), so the
// materialized runbook is the human-readable projection of the application's
// metadata, not a generic template. The steps are returned as a linear sequence;
// runbookstudio.CreateRunbook chains them into a linear predecessor DAG
// preserving this order, which the operator can then re-wire freely.
func deriveImportSteps(app Application) []runbookstudio.ImportStep {
	var steps []runbookstudio.ImportStep

	// 1. Notify owners — manual comms to the people accountable for the app.
	steps = append(steps, runbookstudio.ImportStep{
		Key:             "notify_owners",
		Name:            fmt.Sprintf("Notify %s owners and stand up the recovery bridge", app.Name),
		TaskType:        runbookstudio.TaskTypeComms,
		Required:        true,
		Team:            "incident",
		Instructions:    notifyInstructions(app),
		PlannedDuration: 300,
		Params: map[string]any{
			"app_key":            app.AppKey,
			"rto_target_seconds": app.RTOTargetSeconds,
			"recovery_tier":      app.RecoveryTier,
			"owners":             ownerParams(app.Owners),
		},
	})

	// 2. Recover hard dependencies first (sorted for determinism).
	deps := append([]Dependency(nil), app.Dependencies...)
	sort.Slice(deps, func(i, j int) bool { return deps[i].DependsOnAppKey < deps[j].DependsOnAppKey })
	for _, d := range deps {
		if d.Criticality != DependencyHard {
			continue
		}
		steps = append(steps, runbookstudio.ImportStep{
			Key:             "recover_dependency:" + d.DependsOnAppKey,
			Name:            fmt.Sprintf("Confirm hard dependency %q is recovered", d.DependsOnAppKey),
			TaskType:        runbookstudio.TaskTypeManual,
			Required:        true,
			Team:            "platform",
			Instructions:    fmt.Sprintf("Verify that %q has completed recovery and is serving before continuing — %s hard-depends on it.", d.DependsOnAppKey, app.AppKey),
			PlannedDuration: 600,
			Params: map[string]any{
				"depends_on_app_key": d.DependsOnAppKey,
				"criticality":        d.Criticality,
			},
		})
	}

	// 3. Tier approval gate for mission-critical / tier-1 applications.
	if requiresApprovalGate(app.RecoveryTier) {
		steps = append(steps, runbookstudio.ImportStep{
			Key:             "approve_recovery",
			Name:            fmt.Sprintf("Approve recovery of %s (%s)", app.Name, app.RecoveryTier),
			TaskType:        runbookstudio.TaskTypeApprovalGate,
			Required:        true,
			Team:            "approver",
			Instructions:    fmt.Sprintf("%s is %s. An authorized approver must sign off before any recovery boot proceeds.", app.Name, app.RecoveryTier),
			PlannedDuration: 300,
			Params: map[string]any{
				"recovery_tier": app.RecoveryTier,
				"app_key":       app.AppKey,
			},
		})
	}

	// 4. Provision each recovery-target environment, sorted by key.
	envs := recoveryTargetEnvironments(app)
	for _, e := range envs {
		acct := cloudAccountForRegion(app.CloudAccounts, e.Region)
		steps = append(steps, runbookstudio.ImportStep{
			Key:             "provision_env:" + e.Key,
			Name:            fmt.Sprintf("Provision %s environment %q", e.Kind, e.Key),
			TaskType:        runbookstudio.TaskTypeManual,
			Required:        true,
			Team:            "platform",
			Instructions:    provisionInstructions(app, e, acct),
			PlannedDuration: 1800,
			Params: map[string]any{
				"env_key":  e.Key,
				"env_kind": e.Kind,
				"region":   e.Region,
				"provider": acctProvider(acct),
				"account":  acctRef(acct),
			},
		})
	}

	// 5. Verify application health in the recovered environment(s).
	steps = append(steps, runbookstudio.ImportStep{
		Key:             "verify_application",
		Name:            fmt.Sprintf("Verify %s is healthy in the recovered environment", app.Name),
		TaskType:        runbookstudio.TaskTypeManual,
		Required:        true,
		Team:            "technical",
		Instructions:    fmt.Sprintf("Run application health checks for %s and confirm it meets its %ds RTO target before declaring recovery complete.", app.Name, app.RTOTargetSeconds),
		PlannedDuration: 600,
		Params: map[string]any{
			"app_key":            app.AppKey,
			"rto_target_seconds": app.RTOTargetSeconds,
		},
	})

	return steps
}

// recoveryTargetEnvironments returns the application's recovery-target
// environments sorted by key. A populate over an application with none of these
// is rejected (ErrNoRecoveryTarget) by the caller.
func recoveryTargetEnvironments(app Application) []Environment {
	var envs []Environment
	for _, e := range app.Environments {
		if e.IsRecoveryTarget {
			envs = append(envs, e)
		}
	}
	sort.Slice(envs, func(i, j int) bool { return envs[i].Key < envs[j].Key })
	return envs
}

// cloudAccountForRegion returns the cloud account whose region matches the
// environment's region, falling back to the first account if none matches (an
// environment may not carry a region). Returns the zero value when the app has
// no cloud accounts.
func cloudAccountForRegion(accounts []CloudAccount, region string) CloudAccount {
	if len(accounts) == 0 {
		return CloudAccount{}
	}
	if region != "" {
		for _, a := range accounts {
			if a.Region == region {
				return a
			}
		}
	}
	// Deterministic fallback: the lexically-first account by provider+ref.
	sorted := append([]CloudAccount(nil), accounts...)
	sort.Slice(sorted, func(i, j int) bool {
		if sorted[i].Provider != sorted[j].Provider {
			return sorted[i].Provider < sorted[j].Provider
		}
		return sorted[i].AccountRef < sorted[j].AccountRef
	})
	return sorted[0]
}

func acctProvider(a CloudAccount) string { return a.Provider }
func acctRef(a CloudAccount) string      { return a.AccountRef }

func notifyInstructions(app Application) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Open the recovery bridge for %s and page its owners:", app.Name)
	for _, o := range app.Owners {
		fmt.Fprintf(&b, "\n  - %s: %s", o.Role, o.Name)
		if o.Contact != "" {
			fmt.Fprintf(&b, " (%s)", o.Contact)
		}
	}
	if len(app.Owners) == 0 {
		b.WriteString("\n  - (no owners registered in the Metastore — register owners before the next drill)")
	}
	return b.String()
}

func provisionInstructions(app Application, e Environment, acct CloudAccount) string {
	loc := e.Region
	if loc == "" {
		loc = "the target region"
	}
	if acct.Provider != "" {
		return fmt.Sprintf("Provision the %q environment for %s in %s (%s account %s) per the IaC DR plan.",
			e.Key, app.Name, loc, acct.Provider, acct.AccountRef)
	}
	return fmt.Sprintf("Provision the %q environment for %s in %s per the IaC DR plan.", e.Key, app.Name, loc)
}

func ownerParams(owners []Owner) []map[string]any {
	out := make([]map[string]any, 0, len(owners))
	for _, o := range owners {
		out = append(out, map[string]any{
			"role":    o.Role,
			"name":    o.Name,
			"contact": o.Contact,
		})
	}
	return out
}
