import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithQuery } from '@/__tests__/utils/render-with-query';
import type { DRProtectedSite, DRRecoveryTierProfile } from '@/types/clario-dr';
import { ObjectiveFitAdvisor } from './objective-fit-advisor';
import { RecoveryTierCatalog } from './recovery-tier-catalog';
import {
  buildRecommendationRequest,
  deriveRemediations,
  formatObjectiveDuration,
  normalizeRecommendation,
  normalizeTierProfile,
  objectiveFitVerdict,
} from './advisor-format';

/**
 * Recovery-tier & objective-fit advisor tests — assert the advisory surface
 * renders the REAL `DRObjectiveFit` (status + warnings) and the
 * `recovery_tier_recommendation` / recovery-tier catalog, with concrete
 * remediation derived from the real fields (strategy, requires_cyber_vault,
 * requires_clean_room, validation cadence, server warnings). Also asserts the
 * recommend-tier action is dr:write-gated (the page passes `canWrite`) and that
 * the pure derivation helpers read only real fields.
 */

// --- real-shaped fixtures ---------------------------------------------------
const notAchievableSite: DRProtectedSite = {
  id: 'site-1',
  tenant_id: 't1',
  name: 'Riyadh primary',
  kind: 'primary',
  primary_endpoint: 'https://riyadh.clario.internal',
  rto_objective_seconds: 1_800,
  rpo_objective_seconds: 30,
  objective_fit: {
    status: 'not_achievable',
    rto_objective_seconds: 1_800,
    rpo_objective_seconds: 30,
    warnings: ['RTO objective not achievable at current replication throughput.'],
  },
  recovery_tier_recommendation: {
    tier: 'tier-1',
    strategy: 'warm_standby',
    rto_objective_seconds: 1_800,
    rpo_objective_seconds: 30,
    validation_cadence_seconds: 3_600,
    requires_cyber_vault: true,
    requires_clean_room: true,
    capabilities: ['instant_recovery', 'clean_room'],
    notes: ['Pre-stage compute in the recovery region.'],
  },
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-14T00:00:00Z',
};

const metSite: DRProtectedSite = {
  id: 'site-2',
  tenant_id: 't1',
  name: 'Jeddah secondary',
  kind: 'recovery',
  primary_endpoint: 'https://jeddah.clario.internal',
  rto_objective_seconds: 14_400,
  rpo_objective_seconds: 900,
  objective_fit: {
    status: 'met',
    rto_objective_seconds: 14_400,
    rpo_objective_seconds: 900,
    warnings: [],
  },
  recovery_tier_recommendation: null,
  created_at: '2026-06-01T00:00:00Z',
  updated_at: '2026-06-14T00:00:00Z',
};

const recoveryTiers: DRRecoveryTierProfile[] = [
  {
    tier: 'tier-1',
    rto_seconds: 1_800,
    rpo_seconds: 30,
    recommended_strategy: 'warm_standby',
    minimum_validation_cadence_seconds: 3_600,
    requires_cyber_vault: true,
    requires_clean_room: true,
    capabilities: ['instant_recovery', 'clean_room'],
    notes: ['Warm standby with immutable cyber-vault copies.'],
  },
  {
    tier: 'tier-3',
    rto_seconds: 86_400,
    rpo_seconds: 86_400,
    recommended_strategy: 'backup_restore',
    minimum_validation_cadence_seconds: 604_800,
    requires_cyber_vault: false,
    requires_clean_room: false,
    capabilities: ['scheduled_backup'],
    notes: [],
  },
];

describe('ObjectiveFitAdvisor', () => {
  it('renders the objective-fit warning, tier recommendation, and derived remediation', () => {
    renderWithQuery(
      <ObjectiveFitAdvisor
        sites={[notAchievableSite]}
        recoveryTiers={recoveryTiers}
        latestRecommendation={null}
        canWrite
        loading={false}
        recommending={false}
        error={null}
        onRecommendTier={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    // Objective-fit verdict + the real server warning.
    expect(screen.getByText('Objectives not achievable')).toBeInTheDocument();
    expect(
      screen.getByText('RTO objective not achievable at current replication throughput.'),
    ).toBeInTheDocument();

    // Recommended tier with its real strategy + required flags.
    expect(screen.getByText('Recommended tier')).toBeInTheDocument();
    expect(screen.getAllByText('Tier 1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Warm standby').length).toBeGreaterThan(0);

    // Remediation derived from the REAL recommendation fields.
    expect(screen.getByText(/Provision an immutable cyber-vault copy/)).toBeInTheDocument();
    expect(screen.getByText(/Enable clean-room validation/)).toBeInTheDocument();
    expect(screen.getByText(/Validate recovery points at least every 1h/)).toBeInTheDocument();
    expect(screen.getByText('Pre-stage compute in the recovery region.')).toBeInTheDocument();
  });

  it('shows no-remediation copy when objectives are met with no warnings', () => {
    renderWithQuery(
      <ObjectiveFitAdvisor
        sites={[metSite]}
        recoveryTiers={recoveryTiers}
        latestRecommendation={null}
        canWrite
        loading={false}
        recommending={false}
        error={null}
        onRecommendTier={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText('Objectives met')).toBeInTheDocument();
    expect(
      screen.getByText('Objectives are met with no outstanding remediation.'),
    ).toBeInTheDocument();
  });

  it('fires onRecommendTier with the site when dr:write is granted', () => {
    const onRecommendTier = vi.fn();
    renderWithQuery(
      <ObjectiveFitAdvisor
        sites={[notAchievableSite]}
        recoveryTiers={recoveryTiers}
        latestRecommendation={null}
        canWrite
        loading={false}
        recommending={false}
        error={null}
        onRecommendTier={onRecommendTier}
        onRetry={vi.fn()}
      />,
    );

    const button = screen.getByRole('button', { name: /Recommend tier: Riyadh primary/ });
    expect(button).toBeEnabled();
    fireEvent.click(button);

    expect(onRecommendTier).toHaveBeenCalledTimes(1);
    expect(onRecommendTier).toHaveBeenCalledWith(notAchievableSite);
  });

  it('disables the recommend-tier control when dr:write is denied', () => {
    const onRecommendTier = vi.fn();
    renderWithQuery(
      <ObjectiveFitAdvisor
        sites={[notAchievableSite]}
        recoveryTiers={recoveryTiers}
        latestRecommendation={null}
        canWrite={false}
        loading={false}
        recommending={false}
        error={null}
        onRecommendTier={onRecommendTier}
        onRetry={vi.fn()}
      />,
    );

    const button = screen.getByRole('button', { name: /Recommend tier: Riyadh primary/ });
    expect(button).toBeDisabled();
  });

  it('renders the Arabic (RTL) surface when the active locale is ar', () => {
    renderWithQuery(
      <ObjectiveFitAdvisor
        sites={[notAchievableSite]}
        recoveryTiers={recoveryTiers}
        latestRecommendation={null}
        canWrite
        loading={false}
        recommending={false}
        error={null}
        onRecommendTier={vi.fn()}
        onRetry={vi.fn()}
      />,
      { locale: 'ar' },
    );

    // The advisor card title + recommended-tier label resolve to MSA.
    expect(screen.getByText('مستشار طبقة التعافي وملاءمة الأهداف')).toBeInTheDocument();
    expect(screen.getByText('الطبقة الموصى بها')).toBeInTheDocument();
    // The recommended-tier glossary terms (cyber vault / clean room) are Arabic.
    expect(screen.getByText('الخزنة السيبرانية')).toBeInTheDocument();

    // The recommend-tier control's accessible name is the Arabic action label
    // ("أوصِ بطبقة") plus the data-driven site name, and it is RTL-laid-out via a
    // logical margin utility (me-*) — no physical ml-/mr- in the icon spacing.
    const recommend = screen.getByRole('button', { name: /أوصِ بطبقة: Riyadh primary/ });
    expect(recommend).toBeEnabled();
    expect(recommend.querySelector('.me-1\\.5')).not.toBeNull();
  });
});

describe('RecoveryTierCatalog', () => {
  it('renders each tier profile with its strategy and isolation requirements and highlights the recommended tier', () => {
    renderWithQuery(
      <RecoveryTierCatalog
        recoveryTiers={recoveryTiers}
        highlightedTier="tier-1"
        loading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText('Tier 1')).toBeInTheDocument();
    expect(screen.getByText('Tier 3')).toBeInTheDocument();
    expect(screen.getByText('Warm standby')).toBeInTheDocument();
    expect(screen.getByText('Backup restore')).toBeInTheDocument();
    // The highlighted tier surfaces the "Recommended" marker.
    expect(screen.getByText('Recommended')).toBeInTheDocument();
  });
});

describe('advisor-format', () => {
  it('formats objective durations compactly', () => {
    expect(formatObjectiveDuration(30)).toBe('30s');
    expect(formatObjectiveDuration(900)).toBe('15m');
    expect(formatObjectiveDuration(3_600)).toBe('1h');
    expect(formatObjectiveDuration(5_400)).toBe('1h 30m');
    expect(formatObjectiveDuration(86_400)).toBe('1d');
    expect(formatObjectiveDuration(null)).toBe('n/a');
    expect(formatObjectiveDuration(-1)).toBe('n/a');
  });

  it('normalizes the objective-fit status onto a stable verdict', () => {
    expect(objectiveFitVerdict({ status: 'met', rto_objective_seconds: 1, rpo_objective_seconds: 1 })).toBe('met');
    expect(objectiveFitVerdict({ status: 'not_achievable', rto_objective_seconds: 1, rpo_objective_seconds: 1 })).toBe(
      'not_achievable',
    );
    expect(objectiveFitVerdict({ status: 'at_risk', rto_objective_seconds: 1, rpo_objective_seconds: 1 })).toBe('at_risk');
    expect(objectiveFitVerdict(null)).toBe('unknown');
  });

  it('builds the recommend request from real site objectives with conservative criticality flags', () => {
    expect(buildRecommendationRequest(notAchievableSite)).toEqual({
      rto_seconds: 1_800,
      rpo_seconds: 30,
      business_critical: true,
      mission_critical: true,
    });
    expect(buildRecommendationRequest(metSite)).toEqual({
      rto_seconds: 14_400,
      rpo_seconds: 900,
      business_critical: false,
      mission_critical: false,
    });
  });

  it('derives remediation only from real recommendation + objective-fit fields', () => {
    const tier = normalizeRecommendation(notAchievableSite.recovery_tier_recommendation);
    const steps = deriveRemediations(tier, notAchievableSite.objective_fit);
    const keys = steps.map((step) => step.key);
    expect(keys).toContain('cyber-vault');
    expect(keys).toContain('clean-room');
    expect(keys).toContain('validation-cadence');
    expect(keys).toContain('note-0');
    expect(keys).toContain('warning-0');

    // No tier + met objectives + no warnings => nothing to act on.
    expect(deriveRemediations(null, metSite.objective_fit)).toHaveLength(0);
  });

  it('normalizes a catalog tier profile into the shared remediation shape', () => {
    const tier = normalizeTierProfile(recoveryTiers[0]);
    expect(tier).toMatchObject({
      tier: 'tier-1',
      strategy: 'warm_standby',
      rtoSeconds: 1_800,
      rpoSeconds: 30,
      validationCadenceSeconds: 3_600,
      requiresCyberVault: true,
      requiresCleanRoom: true,
    });
  });
});
