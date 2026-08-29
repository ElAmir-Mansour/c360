import { expect, test, type Locator, type Page } from '@playwright/test';

const now = '2026-06-13T09:00:00Z';
const freshHeartbeat = new Date().toISOString();
const activeRecoveryPointID = 'rp-payments-20260613-0845';

const degradedPaymentStream = {
  stream_id: 'stream-payments-db-secondary',
  site_id: 'site-ruh-core',
  site_name: 'Riyadh Core',
  site_kind: 'recovery',
  status: 'streaming',
  health: 'degraded',
  applied_seq: 8815,
  source_lsn: '0/2B81240',
  applied_at: '2026-06-13T08:57:45Z',
  last_error: 'Network jitter above policy',
  rpo_seconds: 135,
  lag_seconds: 120,
  has_data: true,
  breaches_rpo: true,
  rpo_objective_seconds: 60,
  measured_at: now,
};

const healthyPaymentStream = {
  stream_id: 'stream-payments-db-primary',
  site_id: 'site-jed-primary',
  site_name: 'Jeddah Primary',
  site_kind: 'primary',
  status: 'streaming',
  health: 'healthy',
  applied_seq: 8821,
  source_lsn: '0/2B81290',
  applied_at: '2026-06-13T08:59:30Z',
  last_error: null,
  rpo_seconds: 25,
  lag_seconds: 10,
  has_data: true,
  breaches_rpo: false,
  rpo_objective_seconds: 60,
  measured_at: now,
};

const analyticsStream = {
  stream_id: 'stream-analytics-clean-room',
  site_id: 'site-dxb-clean-room',
  site_name: 'Dubai Clean Room',
  site_kind: 'clean_room',
  status: 'streaming',
  health: 'healthy',
  applied_seq: 4510,
  source_lsn: '0/11FA220',
  applied_at: '2026-06-13T08:59:10Z',
  last_error: null,
  rpo_seconds: 50,
  lag_seconds: 20,
  has_data: true,
  breaches_rpo: false,
  rpo_objective_seconds: 300,
  measured_at: now,
};

const paymentGroup = {
  group_id: 'grp-payments-core',
  name: 'Tier 0 Payments Core',
  health: 'warning',
  member_count: 2,
  stream_count: 2,
  replication_percent: 92,
  rpo_objective_seconds: 60,
  rto_objective_seconds: 900,
  worst_live_rpo: degradedPaymentStream,
  latest_recovery_point: {
    id: activeRecoveryPointID,
    marker_lsn: '0/2B81290',
    rpo_seconds: 42,
    validation_ratio: 1,
    is_validated: true,
    legal_hold: true,
    content_hash: 'sha256-payments-cyber-vault-abcdef1234567890',
    sealed_at: '2026-06-13T08:45:00Z',
    retention_until: '2027-06-13T08:45:00Z',
  },
  last_run: {
    id: 'fo-20260613-001',
    run_id: 'fo-20260613-001',
    tenant_id: 'tenant-dr',
    group_id: 'grp-payments-core',
    mode: 'live',
    status: 'AWAITING_APPROVAL',
    recovery_point_id: activeRecoveryPointID,
    rto_objective_seconds: 900,
    rto_actual_seconds: null,
    met_rto: null,
    initiated_by: 'dr-operator@clario.dev',
    approved_by: null,
    initiated_at: '2026-06-13T08:50:00Z',
    completed_at: null,
    last_error: null,
    updated_at: now,
  },
};

const analyticsGroup = {
  group_id: 'grp-analytics',
  name: 'Tier 2 Analytics Warehouse',
  health: 'healthy',
  member_count: 1,
  stream_count: 1,
  replication_percent: 99,
  rpo_objective_seconds: 300,
  rto_objective_seconds: 3600,
  worst_live_rpo: analyticsStream,
  latest_recovery_point: {
    id: 'rp-analytics-20260613-0830',
    marker_lsn: '0/11FA220',
    rpo_seconds: 50,
    validation_ratio: 1,
    is_validated: true,
    legal_hold: true,
    content_hash: 'sha256-analytics-cyber-vault-001122334455',
    sealed_at: '2026-06-13T08:30:00Z',
    retention_until: '2026-12-13T08:30:00Z',
  },
  last_run: {
    id: 'drill-20260612-003',
    run_id: 'drill-20260612-003',
    tenant_id: 'tenant-dr',
    group_id: 'grp-analytics',
    mode: 'drill',
    status: 'COMPLETED',
    recovery_point_id: 'rp-analytics-20260612-1200',
    rto_objective_seconds: 3600,
    rto_actual_seconds: 480,
    met_rto: true,
    initiated_by: 'dr-operator@clario.dev',
    approved_by: 'risk-owner@clario.dev',
    initiated_at: '2026-06-12T12:00:00Z',
    completed_at: '2026-06-12T12:08:00Z',
    last_error: null,
    updated_at: '2026-06-12T12:08:00Z',
  },
};

const failoverRuns = [
  paymentGroup.last_run,
  analyticsGroup.last_run,
];

const groupSummaries = {
  [paymentGroup.group_id]: {
    ...paymentGroup,
    generated_at: now,
    rpo_breaches: [degradedPaymentStream],
    members: [
      {
        group_id: paymentGroup.group_id,
        site_id: healthyPaymentStream.site_id,
        site_name: healthyPaymentStream.site_name,
        site_kind: healthyPaymentStream.site_kind,
        boot_order: 1,
        stream: healthyPaymentStream,
      },
      {
        group_id: paymentGroup.group_id,
        site_id: degradedPaymentStream.site_id,
        site_name: degradedPaymentStream.site_name,
        site_kind: degradedPaymentStream.site_kind,
        boot_order: 2,
        stream: degradedPaymentStream,
      },
    ],
    recent_runs: [paymentGroup.last_run],
  },
  [analyticsGroup.group_id]: {
    ...analyticsGroup,
    generated_at: now,
    rpo_breaches: [],
    members: [
      {
        group_id: analyticsGroup.group_id,
        site_id: analyticsStream.site_id,
        site_name: analyticsStream.site_name,
        site_kind: analyticsStream.site_kind,
        boot_order: 1,
        stream: analyticsStream,
      },
    ],
    recent_runs: [analyticsGroup.last_run],
  },
};

const breachPrediction = {
  id: 'pred-payments-primary',
  tenant_id: 'tenant-dr',
  stream_id: healthyPaymentStream.stream_id,
  group_label: paymentGroup.name,
  rpo_objective_seconds: 60,
  smoothed_lag_seconds: 48,
  lag_trend_slope: 0.42,
  throughput_trend_slope: -0.18,
  predicted_breach_seconds: 180,
  breach_forecast: true,
  throughput_collapse: false,
  sample_count: 18,
  forecast_at: now,
  updated_at: now,
};

const registryRunbook = {
  id: 'rbv-payments-004',
  runbook_id: 'rb-payments-core',
  tenant_id: 'tenant-dr',
  group_id: paymentGroup.group_id,
  version: 4,
  template_id: 'registry-tier0-v2',
  content_hash: 'sha256-registry-runbook-payments-v4',
  trigger: 'recovery_point',
  created_at: now,
  asset_snapshot: {
    group_id: paymentGroup.group_id,
    group_name: paymentGroup.name,
    rto_objective_seconds: paymentGroup.rto_objective_seconds,
    rpo_objective_seconds: paymentGroup.rpo_objective_seconds,
    network_profile: 'isolated',
    members: [
      {
        site_id: healthyPaymentStream.site_id,
        site_name: healthyPaymentStream.site_name,
        site_kind: healthyPaymentStream.site_kind,
        primary_endpoint: 'postgres://payments-db.primary:5432',
        boot_order: 1,
        network_profile: 'isolated',
        primary_cidr: '10.10.0.0/24',
        recovery_cidr: '10.70.0.0/24',
      },
      {
        site_id: degradedPaymentStream.site_id,
        site_name: degradedPaymentStream.site_name,
        site_kind: degradedPaymentStream.site_kind,
        primary_endpoint: 'https://payments-api.primary',
        boot_order: 2,
        network_profile: 'isolated',
        primary_cidr: '10.11.0.0/24',
        recovery_cidr: '10.71.0.0/24',
      },
    ],
    recovery_point: {
      id: activeRecoveryPointID,
      marker_lsn: '0/2B81290',
      rpo_seconds: 42,
      validation_ratio: 1,
      is_validated: true,
      legal_hold: true,
      sealed_at: '2026-06-13T08:45:00Z',
    },
    captured_at: now,
  },
  steps: [
    {
      key: 'pin-recovery-point',
      order: 1,
      kind: 'pin_recovery_point',
      gate: 'validate',
      title: 'Pin validated recovery point',
      description: 'Pin immutable point before gated failover.',
      params: { recovery_point_id: activeRecoveryPointID },
    },
    {
      key: 'boot-payments-db',
      order: 2,
      kind: 'boot_member',
      gate: 'execute',
      title: 'Boot payments database',
      description: 'Start database tier before API tier.',
      params: { site_id: healthyPaymentStream.site_id },
    },
    {
      key: 'attest-failover',
      order: 3,
      kind: 'attest',
      gate: 'attest',
      title: 'Emit failover attestation',
      description: 'Anchor gate-4 evidence into the ledger.',
      params: {},
    },
  ],
  diff: {
    added: ['boot-payments-api'],
    removed: [],
    reordered: [],
    changed: ['pin-recovery-point'],
  },
};

const regeneratedRegistryRunbook = {
  ...registryRunbook,
  id: 'rbv-payments-005',
  version: 5,
  trigger: 'manual',
  content_hash: 'sha256-registry-runbook-payments-v5',
  created_at: '2026-06-13T09:05:00Z',
  diff: {
    added: ['verify-boot-health'],
    removed: [],
    reordered: [],
    changed: ['attest-failover'],
  },
};

const copilotResult = {
  session_id: 'dr-copilot-session-001',
  message_id: 'dr-copilot-message-002',
  answer: 'Top DR failover risk: Riyadh Core is outside the RPO objective, but the latest clean recovery point is validated and WORM locked.',
  citations: [activeRecoveryPointID, 'sig-payments-entropy-001', 'rbv-payments-004'],
  guardrails: ['Operator approval is required before live execution.', 'Use isolated boot until cleanroom evidence is reviewed.'],
  tool_calls: [
    {
      id: 'tool-risk-001',
      name: 'dr_posture_lookup',
      arguments: { group_id: paymentGroup.group_id },
      success: true,
      result_summary: 'RPO breach and clean point evidence found.',
      latency_ms: 84,
    },
  ],
  proposed_action: {
    kind: 'approve_failover',
    summary: 'Approve failover only after risk-owner sign-off.',
    requires_approval: true,
    api_call: {
      method: 'POST',
      path: `/api/v1/dr/failover-runs/${paymentGroup.last_run.run_id}/approve`,
    },
    approval_call: {
      method: 'POST',
      path: `/api/v1/dr/failover-runs/${paymentGroup.last_run.run_id}/approve`,
    },
    plan: { gate: 'approve' },
    warnings: ['Approval must be tied to the validated recovery point.'],
  },
  provider: 'local',
  model: 'dr-copilot-v1',
  latency_ms: 420,
  iterations: 2,
};

const copilotTranscript = {
  session: {
    id: copilotResult.session_id,
    tenant_id: 'tenant-dr',
    user_id: 'user-dr',
    title: 'Payments DR risk review',
    provider: 'local',
    model: 'dr-copilot-v1',
    message_count: 2,
    created_at: '2026-06-13T09:01:00Z',
    updated_at: '2026-06-13T09:02:00Z',
  },
  messages: [
    {
      id: 'dr-copilot-message-001',
      session_id: copilotResult.session_id,
      tenant_id: 'tenant-dr',
      seq: 1,
      role: 'user',
      content: 'Explain failover risk for the current DR selection.',
      latency_ms: 0,
      created_at: '2026-06-13T09:01:00Z',
    },
    {
      id: copilotResult.message_id,
      session_id: copilotResult.session_id,
      tenant_id: 'tenant-dr',
      seq: 2,
      role: 'assistant',
      content: 'Confirm gate-2 approval evidence before promoting the recovery target.',
      tool_calls: copilotResult.tool_calls,
      proposed_action: copilotResult.proposed_action,
      latency_ms: 420,
      created_at: '2026-06-13T09:02:00Z',
    },
  ],
};

const drFixtures = {
  posture: {
    generated_at: now,
    overall_health: 'warning',
    site_count: 3,
    group_count: 2,
    stream_count: 3,
    recovery_point_count: 7,
    streams_by_status: { healthy: 2, degraded: 1 },
    worst_live_rpo: degradedPaymentStream,
    rpo_breaches: [degradedPaymentStream],
    attention: [
      {
        severity: 'warning',
        kind: 'rpo_breach',
        resource_type: 'stream',
        resource_id: degradedPaymentStream.stream_id,
        message: 'Payments DB replica is 2m 15s behind objective',
      },
    ],
    groups: [paymentGroup, analyticsGroup],
    recent_runs: failoverRuns,
  },
  replicationSummary: {
    generated_at: now,
    overall_health: 'warning',
    total_streams: 3,
    streams_by_status: { healthy: 2, degraded: 1 },
    worst_live_rpo: degradedPaymentStream,
    rpo_breaches: [degradedPaymentStream],
    streams: [healthyPaymentStream, degradedPaymentStream, analyticsStream],
  },
  failoverRuns,
  attestationLedger: [
    {
      id: 'ledger-0007',
      tenant_id: 'tenant-dr',
      seq: 7,
      entry_type: 'drill_attestation',
      subject_id: 'att-drill-20260612-003',
      payload: {
        run_id: 'drill-20260612-003',
        group_id: analyticsGroup.group_id,
        group_name: analyticsGroup.name,
        result: 'passed',
        rto_actual_seconds: 480,
        rpo_seconds: 50,
        report_object_key: 'cyber-vault://tenant-dr/attestations/drill-20260612-003.json',
        frameworks: ['SAMA BCM', 'NCA ECC'],
      },
      payload_hash: 'sha256-payload-0007',
      prev_hash: 'sha256-ledger-0006',
      entry_hash: 'sha256-ledger-0007',
      anchored_root: 'sha256-root-20260612',
      created_at: '2026-06-12T12:09:00Z',
    },
  ],
  bcmPacks: [
    {
      key: 'sama-bcm',
      standard: 'SAMA BCM',
      version: '2026',
      authority: 'SAMA',
      title: 'SAMA BCM Disaster Recovery Controls',
      description: 'Business continuity evidence pack for regulated DR.',
      controls: [],
    },
    {
      key: 'nca-ecc',
      standard: 'NCA ECC',
      version: '2024',
      authority: 'NCA',
      title: 'NCA Essential Cybersecurity Controls',
      description: 'Cybersecurity recovery readiness pack.',
      controls: [],
    },
  ],
  byokKeys: [
    {
      id: 'byok-key-v3',
      tenant_id: 'tenant-dr',
      key_version: 3,
      provider: 'AWS KMS',
      reference: 'arn:aws:kms:me-central-1:111122223333:key/cyber-vault-key-v3',
      state: 'active',
      created_at: '2026-01-01T00:00:00Z',
      activated_at: '2026-03-01T00:00:00Z',
      retired_at: null,
      updated_at: now,
    },
  ],
  byokCustodyLog: {
    intact: true,
    broken_seq: 0,
    merkle_root: 'sha256-byok-custody-root-20260613',
    entries: [
      {
        id: 'custody-0003',
        tenant_id: 'tenant-dr',
        seq: 3,
        action: 'activate_kek',
        kek_version: 3,
        dek_id: 'dek-payments-003',
        detail: 'Activated BYOK key v3 for cyber-vault envelopes.',
        prev_hash: 'sha256-custody-0002',
        entry_hash: 'sha256-custody-0003',
        created_at: now,
      },
    ],
  },
  rotatedByokKey: {
    id: 'byok-key-v4',
    tenant_id: 'tenant-dr',
    key_version: 4,
    provider: 'AWS KMS',
    reference: 'arn:aws:kms:me-central-1:111122223333:key/cyber-vault-key-v4',
    state: 'active',
    created_at: now,
    activated_at: now,
    retired_at: null,
    updated_at: now,
  },
  bcmAssessmentRun: {
    assessment: {
      id: 'bcm-assess-samaa-20260613',
      tenant_id: 'tenant-dr',
      group_id: paymentGroup.group_id,
      pack_key: 'sama-bcm',
      standard: 'SAMA BCM',
      pack_version: '2026',
      score: 88,
      compliant: true,
      total_controls: 8,
      satisfied: 7,
      partial: 1,
      failed: 0,
      created_by: 'dr-operator@clario.dev',
      created_at: now,
    },
    score: 88,
    compliant: true,
    controls: [],
    gaps: [
      {
        code: 'BCM-DR-02',
        title: 'Cyber-vault restore testing',
        verdict: 'partial',
        reason: 'Break-glass drill is nearing policy expiry.',
        mandatory: true,
      },
    ],
  },
  cyberVaults: {
    count: 1,
    vaults: [
      {
        id: 'vault-payments-immutable',
        tenant_id: 'tenant-dr',
        group_id: paymentGroup.group_id,
        provider: 's3_object_lock',
        name: 'Payments Immutable Cyber Vault',
        external_id: 'arn:aws:s3:::clario-payments-vault',
        posture: {
          id: 'vault-posture-payments',
          name: 'Payments Immutable Cyber Vault',
          provider: 's3_object_lock',
          primary_region: 'me-central-1',
          replica_regions: ['me-south-1'],
          immutability_enabled: true,
          vault_lock_enabled: true,
          encryption_enabled: true,
          customer_managed_key: true,
          approval: {
            require_restore_approval: true,
            restore_approvers: 2,
            require_destructive_approval: true,
            destructive_approvers: 2,
            separation_of_duties: true,
          },
          retention: { minimum_days: 365, required_minimum_days: 365 },
          isolation: {
            cross_account: true,
            disjoint_admins: true,
            source_admin_denied: true,
          },
          last_restore_test_at: '2026-06-10T04:00:00Z',
          last_restore_test_passed: true,
          restore_test_window_days: 30,
          break_glass_enabled: true,
          break_glass_mfa: true,
          break_glass_last_tested_at: '2026-06-01T04:00:00Z',
          break_glass_test_window_days: 45,
        },
        created_at: '2026-04-01T00:00:00Z',
        updated_at: now,
      },
    ],
  },
  cyberVaultAssessment: {
    ID: 'vault-assess-payments-20260613',
    TenantID: 'tenant-dr',
    GroupID: paymentGroup.group_id,
    VaultID: 'vault-payments-immutable',
    Provider: 's3_object_lock',
    Posture: {
      name: 'Payments Immutable Cyber Vault',
      provider: 's3_object_lock',
      primary_region: 'me-central-1',
      replica_regions: ['me-south-1'],
      immutability_enabled: true,
      vault_lock_enabled: true,
      encryption_enabled: true,
      customer_managed_key: true,
      approval: {
        require_restore_approval: true,
        restore_approvers: 2,
        require_destructive_approval: true,
        destructive_approvers: 2,
        separation_of_duties: true,
      },
      retention: { minimum_days: 365, required_minimum_days: 365 },
      isolation: {
        cross_account: true,
        disjoint_admins: true,
        source_admin_denied: true,
      },
      last_restore_test_passed: true,
      break_glass_enabled: true,
      break_glass_mfa: true,
    },
    Assessment: {
      vault_id: 'vault-payments-immutable',
      provider: 's3_object_lock',
      score: 91,
      verdict: 'satisfied',
      total_controls: 10,
      satisfied: 9,
      partial: 1,
      failed: 0,
      findings: [
        {
          code: 'VAULT-BREAKGLASS-AGE',
          title: 'Break-glass drill recency',
          verdict: 'partial',
          severity: 'warning',
          weight: 8,
          message: 'Break-glass MFA drill is inside policy but approaching the refresh window.',
          remediation: 'Schedule the next break-glass drill before policy expiry.',
        },
      ],
      evaluated_at: now,
    },
    Score: 91,
    Verdict: 'satisfied',
    EvaluatedAt: now,
    CreatedAt: now,
  },
  agents: [
    {
      id: 'agent-jed-primary',
      tenant_id: 'tenant-dr',
      site_id: healthyPaymentStream.site_id,
      status: 'active',
      mtls_thumbprint: 'sha256-agent-jed-primary-thumbprint',
      cert_serial: 'DR-AGENT-0001',
      cert_issued_at: '2026-03-01T00:00:00Z',
      cert_expires_at: '2027-03-01T00:00:00Z',
      cert_revoked_at: null,
      cert_revoked_reason: null,
      last_seen_at: freshHeartbeat,
      created_at: '2026-03-01T00:00:00Z',
    },
    {
      id: 'agent-ruh-core',
      tenant_id: 'tenant-dr',
      site_id: degradedPaymentStream.site_id,
      status: 'active',
      mtls_thumbprint: 'sha256-agent-ruh-core-thumbprint',
      cert_serial: 'DR-AGENT-0002',
      cert_issued_at: '2026-03-01T00:00:00Z',
      cert_expires_at: '2027-03-01T00:00:00Z',
      cert_revoked_at: null,
      cert_revoked_reason: null,
      last_seen_at: '2026-06-13T08:20:00Z',
      created_at: '2026-03-01T00:00:00Z',
    },
  ],
  assuranceControls: [
    { code: 'DR-001', title: 'Validated recovery point', weight: 20, fail_severity: 'critical' },
    { code: 'DR-002', title: 'Current agent heartbeat', weight: 15, fail_severity: 'warning' },
  ],
  assuranceLatest: {
    assessment: {
      id: 'assess-payments-001',
      tenant_id: 'tenant-dr',
      group_id: paymentGroup.group_id,
      profile_id: 'tier-0',
      workload_id: 'payments',
      score: 86,
      verdict: 'partial',
      total_checks: 6,
      satisfied: 5,
      partial: 1,
      failed: 0,
      created_by: 'dr-operator@clario.dev',
      created_at: now,
    },
    results: [],
    findings: [
      {
        code: 'DR-002',
        title: 'Agent heartbeat stale',
        verdict: 'partial',
        severity: 'warning',
        weight: 15,
        message: 'Riyadh Core agent is outside heartbeat policy.',
        recommendation: 'Validate agent service health before live failover.',
        evidence_refs: ['agent-ruh-core'],
      },
    ],
    recommendations: ['Validate agent service health before live failover.'],
  },
  drillSchedules: [
    {
      id: 'sched-payments-weekly',
      tenant_id: 'tenant-dr',
      group_id: paymentGroup.group_id,
      name: 'Weekly isolated payments drill',
      cron_expr: '0 2 * * 5',
      profile: 'isolated',
      rto_objective_seconds: 900,
      enabled: true,
      next_run: '2026-06-19T02:00:00Z',
      last_fired_at: '2026-06-12T02:00:00Z',
      created_at: '2026-04-01T00:00:00Z',
      updated_at: now,
    },
  ],
  drillResults: [
    {
      id: 'drill-result-payments-001',
      tenant_id: 'tenant-dr',
      group_id: paymentGroup.group_id,
      schedule_id: 'sched-payments-weekly',
      run_id: 'drill-payments-20260612',
      passed: true,
      rto_achieved_seconds: 540,
      rpo_achieved_seconds: 42,
      rto_objective_seconds: 900,
      recovery_point_id: activeRecoveryPointID,
      validation_ratio: 1,
      validation_outcome: 'validated',
      steps: [{ key: 'gate1.validate', title: 'Validate point', status: 'passed', duration_ms: 30000 }],
      asset_fingerprint: {
        members: { [healthyPaymentStream.site_id]: 1, [degradedPaymentStream.site_id]: 2 },
        topology_edges: ['site-jed-primary->site-ruh-core'],
      },
      observed_at: '2026-06-12T02:09:00Z',
      created_at: '2026-06-12T02:10:00Z',
    },
  ],
  failbackRuns: [
    {
      id: 'fb-payments-001',
      tenant_id: 'tenant-dr',
      group_id: paymentGroup.group_id,
      failover_run_id: 'fo-20260612-001',
      from_site: degradedPaymentStream.site_id,
      to_site: healthyPaymentStream.site_id,
      reverse_stream_id: 'stream-failback-payments',
      status: 'REVERSE_SYNCING',
      delta_bytes_remaining: 10485760,
      delta_seq_remaining: 25,
      converge_threshold_bytes: 1048576,
      source_lsn: '0/2B81240',
      applied_lsn: '0/2B80000',
      last_converged_at: null,
      cutover_window_open: false,
      initiated_by: 'dr-operator@clario.dev',
      approved_by: null,
      approved_at: null,
      new_direction: null,
      last_error: null,
      claimed_at: null,
      initiated_at: '2026-06-12T03:00:00Z',
      completed_at: null,
      updated_at: now,
    },
  ],
  gameDayScenarios: [
    {
      id: 'gameday-payments-lag',
      tenant_id: 'tenant-dr',
      group_id: paymentGroup.group_id,
      name: 'Payments lag signal exercise',
      description: 'Inject replication lag and assert alerting.',
      scope: 'drill',
      steps: [
        {
          action: 'induce_lag',
          target: degradedPaymentStream.stream_id,
          params: { seconds: 180 },
          expect: { signal: 'lag_alert', detect_within: '30s', recover_within: '2m' },
        },
      ],
      created_at: '2026-05-01T00:00:00Z',
      updated_at: now,
    },
  ],
  bootPlan: {
    group_id: paymentGroup.group_id,
    tiers: [
      [
        {
          id: 'boot-db',
          tenant_id: 'tenant-dr',
          group_id: paymentGroup.group_id,
          name: 'payments-db',
          kind: 'database',
          boot_action: 'http://recovery.local/boot/db',
          site_id: healthyPaymentStream.site_id,
          probe_kind: 'tcp',
          probe_target: 'payments-db:5432',
          probe_expect_status: 0,
          boot_timeout_seconds: 60,
          health_retries: 3,
          created_at: '2026-04-01T00:00:00Z',
          updated_at: now,
        },
      ],
      [
        {
          id: 'boot-api',
          tenant_id: 'tenant-dr',
          group_id: paymentGroup.group_id,
          name: 'payments-api',
          kind: 'api',
          boot_action: 'http://recovery.local/boot/api',
          site_id: degradedPaymentStream.site_id,
          probe_kind: 'http',
          probe_target: 'https://payments-api/health',
          probe_expect_status: 200,
          boot_timeout_seconds: 60,
          health_retries: 3,
          created_at: '2026-04-01T00:00:00Z',
          updated_at: now,
        },
      ],
    ],
    tier_names: [['payments-db'], ['payments-api']],
    tier_count: 2,
  },
  consistencyBarriers: [
    {
      id: 'barrier-payments-001',
      tenant_id: 'tenant-dr',
      group_id: paymentGroup.group_id,
      recovery_point_id: activeRecoveryPointID,
      consistency_level: 'application',
      provider: 'script',
      barrier_lsn: '0/2B81290',
      success: true,
      quiesced: true,
      thawed: true,
      detail: 'freeze/thaw completed',
      error: '',
      requested_by: 'dr-operator@clario.dev',
      quiesce_started_at: '2026-06-13T08:44:30Z',
      quiesce_finished_at: '2026-06-13T08:44:40Z',
      thaw_started_at: '2026-06-13T08:45:00Z',
      thaw_finished_at: '2026-06-13T08:45:05Z',
      created_at: '2026-06-13T08:45:05Z',
    },
  ],
  topology: {
    group_id: paymentGroup.group_id,
    nodes: [],
    edges: [],
    topo_order: ['node-jed-primary', 'node-ruh-core'],
  },
  topologySelection: {
    group_id: paymentGroup.group_id,
    selected: {
      node_id: 'node-ruh-core',
      site_id: degradedPaymentStream.site_id,
      site_name: degradedPaymentStream.site_name,
      role: 'target',
      edge_id: 'edge-jed-ruh',
      stream_id: degradedPaymentStream.stream_id,
      mode: 'async',
      priority: 1,
      health: 'degraded',
      eligible: true,
      lag_seconds: 120,
      applied_seq: 8815,
      reason: 'Best eligible standby by priority despite degraded RPO.',
    },
    ranking: [],
    evaluated_at: now,
  },
  recoveryPoints: [
    {
      id: activeRecoveryPointID,
      tenant_id: 'tenant-dr',
      group_id: paymentGroup.group_id,
      marker_lsn: '0/2B81290',
      rpo_seconds: 42,
      object_keys: {
        pg: 'worm://tenant-dr/recovery-points/rp-payments-20260613-0845/postgres.tar.zst',
        files: 'worm://tenant-dr/recovery-points/rp-payments-20260613-0845/files.delta',
      },
      content_hash: 'sha256-payments-cyber-vault-abcdef1234567890',
      validation_ratio: 1,
      is_validated: true,
      legal_hold: true,
      sealed_at: '2026-06-13T08:45:00Z',
      retention_until: '2027-06-13T08:45:00Z',
    },
    {
      id: 'rp-payments-20260613-0815',
      tenant_id: 'tenant-dr',
      group_id: paymentGroup.group_id,
      marker_lsn: '0/2B7FEE0',
      rpo_seconds: 55,
      object_keys: {
        pg: 'worm://tenant-dr/recovery-points/rp-payments-20260613-0815/postgres.tar.zst',
      },
      content_hash: 'sha256-payments-earlier-001122334455',
      validation_ratio: 0.98,
      is_validated: true,
      legal_hold: true,
      sealed_at: '2026-06-13T08:15:00Z',
      retention_until: '2027-06-13T08:15:00Z',
    },
  ],
  journalTimeline: {
    stream_id: healthyPaymentStream.stream_id,
    earliest_seq: 8700,
    earliest_lsn: '0/2B70000',
    earliest_ts: '2026-06-13T08:15:00Z',
    latest_seq: 8821,
    latest_lsn: '0/2B81290',
    latest_ts: '2026-06-13T08:59:30Z',
    recoverable: true,
    has_gaps: false,
    segments: [
      {
        id: 'seg-payments-8700-8760',
        tenant_id: 'tenant-dr',
        stream_id: healthyPaymentStream.stream_id,
        min_seq: 8700,
        max_seq: 8760,
        frame_count: 61,
        min_lsn: '0/2B70000',
        max_lsn: '0/2B78000',
        min_ts: '2026-06-13T08:15:00Z',
        max_ts: '2026-06-13T08:35:00Z',
        object_key: 'worm://tenant-dr/journal/stream-payments-db-primary/8700-8760.cdf',
        payload_bytes: 7340032,
        content_hash: 'sha256-journal-seg-8700',
        pruned: false,
        pruned_at: null,
        sealed_at: '2026-06-13T08:35:05Z',
      },
      {
        id: 'seg-payments-8761-8821',
        tenant_id: 'tenant-dr',
        stream_id: healthyPaymentStream.stream_id,
        min_seq: 8761,
        max_seq: 8821,
        frame_count: 61,
        min_lsn: '0/2B78001',
        max_lsn: '0/2B81290',
        min_ts: '2026-06-13T08:35:01Z',
        max_ts: '2026-06-13T08:59:30Z',
        object_key: 'worm://tenant-dr/journal/stream-payments-db-primary/8761-8821.cdf',
        payload_bytes: 8388608,
        content_hash: 'sha256-journal-seg-8821',
        pruned: false,
        pruned_at: null,
        sealed_at: '2026-06-13T08:59:35Z',
      },
    ],
    bookmarks: [
      {
        id: 'bm-pre-approval',
        tenant_id: 'tenant-dr',
        stream_id: healthyPaymentStream.stream_id,
        name: 'pre-approval checkpoint',
        kind: 'operator',
        at_seq: 8821,
        at_lsn: '0/2B81290',
        at_ts: '2026-06-13T08:59:30Z',
        note: 'Point before gate-2 approval.',
        created_by: 'dr-operator@clario.dev',
        created_at: now,
      },
    ],
  },
  ledgerVerification: {
    intact: true,
    entries_checked: 7,
    first_broken_seq: 0,
    reason: '',
    head_hash: 'sha256-ledger-0007',
  },
  ledgerProof: {
    seq: 7,
    leaf_index: 6,
    leaf_hash: 'sha256-ledger-0007',
    path: [
      { hash: 'sha256-ledger-0006', left: true },
      { hash: 'sha256-ledger-0005-0006', left: true },
    ],
    root: 'sha256-root-20260612',
    from_seq: 1,
    to_seq: 7,
  },
  ledgerCheckpoint: {
    id: 'checkpoint-20260613-001',
    tenant_id: 'tenant-dr',
    from_seq: 1,
    to_seq: 7,
    merkle_root: 'sha256-root-20260613',
    entry_count: 7,
    worm_object_key: 'worm://tenant-dr/attestation-ledger/checkpoints/20260613.json',
    worm_version_id: 'v-checkpoint-001',
    created_at: now,
  },
  agentEnrollmentToken: {
    jwt: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.dr-agent-enrollment.signature',
    jti: 'enroll-jti-agent-jed-primary',
    agent_id: 'agent-jed-primary',
    tenant_id: 'tenant-dr',
    site_id: healthyPaymentStream.site_id,
    purpose: 'enroll',
    expires_at: '2026-06-13T10:00:00Z',
  },
  copilotResult,
  copilotTranscript,
  predictions: [
    breachPrediction,
    {
      id: 'pred-analytics',
      tenant_id: 'tenant-dr',
      stream_id: analyticsStream.stream_id,
      group_label: analyticsGroup.name,
      rpo_objective_seconds: 300,
      smoothed_lag_seconds: 45,
      lag_trend_slope: -0.04,
      throughput_trend_slope: 0.03,
      predicted_breach_seconds: null,
      breach_forecast: false,
      throughput_collapse: false,
      sample_count: 12,
      forecast_at: now,
      updated_at: now,
    },
  ],
  streamForecast: {
    prediction: breachPrediction,
    samples: [
      {
        id: 'sample-payments-001',
        tenant_id: 'tenant-dr',
        stream_id: healthyPaymentStream.stream_id,
        observed_at: '2026-06-13T08:57:00Z',
        lag_seconds: 42,
        throughput_bps: 5242880,
        applied_seq: 8810,
        created_at: '2026-06-13T08:57:05Z',
      },
      {
        id: 'sample-payments-002',
        tenant_id: 'tenant-dr',
        stream_id: healthyPaymentStream.stream_id,
        observed_at: now,
        lag_seconds: 48,
        throughput_bps: 4194304,
        applied_seq: 8821,
        created_at: now,
      },
    ],
  },
  ransomwareSignals: [
    {
      id: 'sig-payments-entropy-001',
      tenant_id: 'tenant-dr',
      stream_id: healthyPaymentStream.stream_id,
      kind: 'entropy',
      severity: 'confirmed',
      observed: 0.92,
      baseline: 0.21,
      ratio: 4.38,
      threshold: 3,
      sample_seq: 8819,
      source_lsn: '0/2B81190',
      curated_recovery_point_id: activeRecoveryPointID,
      detail: 'Entropy spike isolated to attachment object store delta.',
      observed_at: '2026-06-13T08:58:00Z',
      created_at: '2026-06-13T08:58:05Z',
    },
    {
      id: 'sig-payments-delete-001',
      tenant_id: 'tenant-dr',
      stream_id: degradedPaymentStream.stream_id,
      kind: 'delete_burst',
      severity: 'warning',
      observed: 880,
      baseline: 120,
      ratio: 7.33,
      threshold: 5,
      sample_seq: 8815,
      source_lsn: '0/2B81240',
      curated_recovery_point_id: activeRecoveryPointID,
      detail: 'Delete burst requires cleanroom validation before promotion.',
      observed_at: '2026-06-13T08:56:00Z',
      created_at: '2026-06-13T08:56:08Z',
    },
  ],
  cleanRoomScan: {
    id: 'cleanroom-payments-001',
    tenant_id: 'tenant-dr',
    recovery_point_id: activeRecoveryPointID,
    group_id: paymentGroup.group_id,
    verdict: 'clean',
    scanner: 'clamav+yara',
    chunks_scanned: 42,
    bytes_scanned: 1879048192,
    detail: 'No malware signatures detected; integrity hashes matched sealed manifest.',
    findings: [
      {
        stream_id: healthyPaymentStream.stream_id,
        object_key: 'worm://tenant-dr/recovery-points/rp-payments-20260613-0845/postgres.tar.zst',
        sandbox_path: '/cleanroom/payments/postgres.tar.zst',
        bytes: 1073741824,
        sha256: 'sha256-cleanroom-postgres',
        integrity_ok: true,
        clean: true,
      },
    ],
    started_at: '2026-06-13T08:46:00Z',
    finished_at: '2026-06-13T08:49:00Z',
  },
  registryRunbook,
  registryVersions: [
    registryRunbook,
    {
      ...registryRunbook,
      id: 'rbv-payments-003',
      version: 3,
      trigger: 'membership',
      content_hash: 'sha256-registry-runbook-payments-v3',
      created_at: '2026-06-12T08:00:00Z',
      diff: null,
    },
  ],
  iacSnapshots: {
    count: 2,
    snapshots: [
      {
        id: 'iac-snap-payments-v2',
        tenant_id: 'tenant-dr',
        group_id: paymentGroup.group_id,
        name: 'prod-terraform-state-v2',
        source_kind: 'terraform_state',
        version: 2,
        content_hash: 'sha256-iac-payments-v2',
        resource_count: 3,
        metadata: { workspace: 'payments-prod' },
        created_at: now,
        resources: [
          {
            provider: 'aws',
            type: 'aws_db_instance',
            name: 'payments',
            address: 'aws_db_instance.payments',
            attributes: { engine: 'postgres' },
            depends_on: [],
            hash: 'hash-db-v2',
          },
          {
            provider: 'aws',
            type: 'aws_lb',
            name: 'payments',
            address: 'aws_lb.payments',
            attributes: { scheme: 'internal' },
            depends_on: [],
            hash: 'hash-lb-v2',
          },
          {
            provider: 'aws',
            type: 'aws_route53_record',
            name: 'payments',
            address: 'aws_route53_record.payments',
            attributes: { ttl: 30 },
            depends_on: ['aws_lb.payments'],
            hash: 'hash-dns-v2',
          },
        ],
      },
      {
        id: 'iac-snap-payments-v1',
        tenant_id: 'tenant-dr',
        group_id: paymentGroup.group_id,
        name: 'prod-terraform-state-v1',
        source_kind: 'terraform_state',
        version: 1,
        content_hash: 'sha256-iac-payments-v1',
        resource_count: 2,
        metadata: { workspace: 'payments-prod' },
        created_at: '2026-06-12T09:00:00Z',
        resources: [
          {
            provider: 'aws',
            type: 'aws_db_instance',
            name: 'payments',
            address: 'aws_db_instance.payments',
            attributes: { engine: 'postgres' },
            depends_on: [],
            hash: 'hash-db-v1',
          },
          {
            provider: 'aws',
            type: 'aws_lb',
            name: 'payments',
            address: 'aws_lb.payments',
            attributes: { scheme: 'internal' },
            depends_on: [],
            hash: 'hash-lb-v2',
          },
        ],
      },
    ],
  },
  storageVolumes: [
    {
      id: 'storage-vol-payments-attachments',
      tenant_id: 'tenant-dr',
      name: 'payments-attachments-volume',
      provider: 'netapp_ontap',
      array_endpoint: 'ontap://riyadh-array-1',
      source_location: '/vol/payments-attachments',
      site_id: degradedPaymentStream.site_id,
      retention_max_snapshots: 96,
      retention_max_age_seconds: 2_592_000,
      created_at: '2026-05-01T00:00:00Z',
      updated_at: now,
      snapshot_count: 2,
      replicated_snapshot_count: 1,
      failed_snapshot_count: 0,
      latest_snapshot: {
        id: 'storage-snap-payments-001',
        tenant_id: 'tenant-dr',
        volume_id: 'storage-vol-payments-attachments',
        parent_id: null,
        provider_handle: 'snapmirror://payments-001',
        kind: 'incremental',
        state: 'REPLICATED',
        manifest_hash: 'sha256-storage-snap-payments-001',
        size_bytes: 53687091200,
        changed_bytes: 536870912,
        file_count: 120450,
        replicated_target: 'ontap://jeddah-array-2',
        last_error: null,
        created_at: '2026-06-13T08:30:00Z',
        ready_at: '2026-06-13T08:32:00Z',
        replicated_at: '2026-06-13T08:35:00Z',
        expired_at: null,
        updated_at: '2026-06-13T08:35:00Z',
      },
    },
  ],
  workloadCaptures: [
    {
      id: 'capture-payments-db-vm',
      tenant_id: 'tenant-dr',
      stream_id: healthyPaymentStream.stream_id,
      name: 'payments-db-vm',
      source_kind: 'vm_disk',
      binding_kind: 'vmware_cbt',
      block_size_bytes: 1048576,
      config: { datastore: 'prod-payments' },
      enabled: true,
      epoch_count: 12,
      last_run_at: '2026-06-13T08:58:00Z',
      last_seq: 8821,
      created_at: '2026-05-01T00:00:00Z',
      updated_at: now,
    },
    {
      id: 'capture-payments-api-k8s',
      tenant_id: 'tenant-dr',
      stream_id: degradedPaymentStream.stream_id,
      name: 'payments-api-k8s',
      source_kind: 'k8s_workload',
      binding_kind: 'rest',
      block_size_bytes: 262144,
      config: { namespace: 'payments' },
      enabled: true,
      epoch_count: 7,
      last_run_at: '2026-06-13T08:50:00Z',
      last_seq: 8815,
      created_at: '2026-05-05T00:00:00Z',
      updated_at: now,
    },
  ],
  workloadEpochs: [
    {
      id: 'epoch-payments-db-012',
      tenant_id: 'tenant-dr',
      source_id: 'capture-payments-db-vm',
      stream_id: healthyPaymentStream.stream_id,
      epoch: 12,
      epoch_kind: 'incremental',
      from_seq: 8761,
      to_seq: 8821,
      frame_count: 61,
      changed_units: 512,
      total_units: 8192,
      payload_bytes: 268435456,
      content_hash: 'sha256-workload-epoch-payments-db-012',
      source_marker: 'vmware-cbt:disk-01:8821',
      set_summary: [],
      captured_at: '2026-06-13T08:58:00Z',
    },
  ],
  selfDRComponents: {
    required_components: ['postgres_control_db', 'object_worm_store', 'event_outbox_queue', 'vault_pki_secrets', 'config_iac'],
    sealing_enabled: true,
  },
  selfDRLatest: {
    assessment: {
      id: 'selfdr-assess-20260613',
      tenant_id: 'tenant-dr',
      profile_id: 'control-plane',
      verdict: 'ready',
      critical: 0,
      warning: 1,
      info: 1,
      findings: [
        {
          code: 'SELFDR-WORM-RETENTION',
          severity: 'warning',
          component_id: 'object-worm-store',
          component_kind: 'object_worm_store',
          message: 'WORM object store retention is below target for one evidence prefix.',
        },
      ],
      restore_plan: {
        profile_id: 'control-plane',
        waves: [
          {
            sequence: 1,
            components: [
              {
                id: 'postgres-control-db',
                name: 'Postgres control DB',
                kind: 'postgres_control_db',
                required: true,
                objective: { rto_seconds: 900, rpo_seconds: 300 },
                backup: {
                  available: true,
                  immutable: true,
                  encrypted: true,
                  location_id: 'jeddah-offline',
                  uri: 'worm://tenant-dr/selfdr/postgres-control-db.snapshot',
                  captured_at: now,
                  max_rpo_seconds: 120,
                },
                restore: {
                  passed: true,
                  tested_at: '2026-06-12T06:00:00Z',
                  location_id: 'jeddah-offline',
                  rto_seconds: 540,
                  rpo_seconds: 120,
                  notes: 'Restore rehearsal completed.',
                },
                recovery_locations: ['jeddah-offline'],
                metadata: {},
              },
            ],
          },
        ],
      },
      created_by: 'dr-operator@clario.dev',
      created_at: now,
    },
    artifacts: [
      {
        id: 'selfdr-artifact-postgres-001',
        tenant_id: 'tenant-dr',
        kind: 'control_plane_backup',
        component_id: 'postgres-control-db',
        component_kind: 'postgres_control_db',
        key: 'selfdr/postgres-control-db.snapshot',
        uri: 'worm://tenant-dr/selfdr/postgres-control-db.snapshot',
        version_id: 'v1',
        sha256: 'sha256-selfdr-postgres-backup',
        size_bytes: 2147483648,
        captured_at: now,
        retain_until: '2027-06-13T09:00:00Z',
        location_id: 'jeddah-offline',
        immutable: true,
        encrypted: true,
        evidence: {
          available: true,
          immutable: true,
          encrypted: true,
          location_id: 'jeddah-offline',
          uri: 'worm://tenant-dr/selfdr/postgres-control-db.snapshot',
          captured_at: now,
          max_rpo_seconds: 120,
        },
        created_by: 'dr-operator@clario.dev',
        created_at: now,
      },
    ],
  },
  selfDRArtifacts: [
    {
      id: 'selfdr-offline-bundle-20260613',
      tenant_id: 'tenant-dr',
      kind: 'offline_restore_bundle',
      key: 'selfdr/offline-bundle-20260613.tar.gz',
      uri: 'offline://tenant-dr/selfdr/bundle-20260613.tar.gz',
      version_id: 'bundle-v1',
      sha256: 'sha256-selfdr-offline-bundle-20260613',
      size_bytes: 10737418240,
      captured_at: now,
      retain_until: '2027-06-13T09:00:00Z',
      location_id: 'jeddah-offline',
      immutable: true,
      encrypted: true,
      evidence: {
        available: true,
        complete: true,
        location_id: 'jeddah-offline',
        generated_at: now,
      },
      created_by: 'dr-operator@clario.dev',
      created_at: now,
    },
  ],
  iacDiff: {
    base_snapshot_id: 'iac-snap-payments-v1',
    target_snapshot_id: 'iac-snap-payments-v2',
    added: [
      {
        key: { provider: 'aws', type: 'aws_route53_record', name: 'payments' },
        change: 'added',
        address: 'aws_route53_record.payments',
        old_hash: '',
        new_hash: 'hash-dns-v2',
        attributes: [],
      },
    ],
    removed: [],
    modified: [
      {
        key: { provider: 'aws', type: 'aws_db_instance', name: 'payments' },
        change: 'modified',
        address: 'aws_db_instance.payments',
        old_hash: 'hash-db-v1',
        new_hash: 'hash-db-v2',
        attributes: [],
      },
    ],
  },
  iacPlan: {
    snapshot_id: 'iac-snap-payments-v2',
    steps: [
      {
        order: 1,
        wave: 1,
        key: { provider: 'aws', type: 'aws_db_instance', name: 'payments' },
        address: 'aws_db_instance.payments',
        provider: 'aws',
        type: 'aws_db_instance',
        name: 'payments',
        depends_on: [],
      },
    ],
    waves: [
      [
        {
          order: 1,
          wave: 1,
          key: { provider: 'aws', type: 'aws_db_instance', name: 'payments' },
          address: 'aws_db_instance.payments',
          provider: 'aws',
          type: 'aws_db_instance',
          name: 'payments',
          depends_on: [],
        },
      ],
    ],
  },
  iacIngestedSnapshot: {
    id: 'iac-snap-payments-v3',
    tenant_id: 'tenant-dr',
    group_id: paymentGroup.group_id,
    name: 'grp-payments-core-operator-snapshot',
    source_kind: 'terraform_state',
    version: 3,
    content_hash: 'sha256-iac-payments-v3',
    resource_count: 4,
    metadata: { workspace: 'payments-prod', captured_by: 'operator' },
    created_at: now,
    resources: [],
  },
  requestedStorageSnapshot: {
    id: 'storage-snap-payments-operator-ready',
    tenant_id: 'tenant-dr',
    volume_id: 'storage-vol-payments-attachments',
    parent_id: 'storage-snap-payments-001',
    provider_handle: 'snapmirror://payments-operator-ready',
    kind: 'incremental',
    state: 'READY',
    manifest_hash: 'sha256-storage-snap-payments-operator-ready',
    size_bytes: 53687091200,
    changed_bytes: 671088640,
    file_count: 120512,
    replicated_target: null,
    last_error: null,
    created_at: now,
    ready_at: now,
    replicated_at: null,
    expired_at: null,
    updated_at: now,
  },
  replicatedStorageSnapshot: {
    id: 'storage-snap-payments-operator-ready',
    tenant_id: 'tenant-dr',
    volume_id: 'storage-vol-payments-attachments',
    parent_id: 'storage-snap-payments-001',
    provider_handle: 'snapmirror://payments-operator-ready',
    kind: 'incremental',
    state: 'REPLICATED',
    manifest_hash: 'sha256-storage-snap-payments-operator-ready',
    size_bytes: 53687091200,
    changed_bytes: 671088640,
    file_count: 120512,
    replicated_target: 'recovery-vault',
    last_error: null,
    created_at: now,
    ready_at: now,
    replicated_at: now,
    expired_at: null,
    updated_at: now,
  },
  workloadEpochRun: {
    id: 'epoch-payments-db-013',
    tenant_id: 'tenant-dr',
    source_id: 'capture-payments-db-vm',
    stream_id: healthyPaymentStream.stream_id,
    epoch: 13,
    epoch_kind: 'incremental',
    from_seq: 8822,
    to_seq: 8890,
    frame_count: 69,
    changed_units: 640,
    total_units: 8192,
    payload_bytes: 335544320,
    content_hash: 'sha256-workload-epoch-payments-db-013',
    source_marker: 'vmware-cbt:disk-01:8890',
    set_summary: [],
    captured_at: now,
  },
  selfDRAssess: {
    assessment: {
      id: 'selfdr-assess-operator-20260613',
      tenant_id: 'tenant-dr',
      profile_id: 'control-plane',
      verdict: 'ready',
      critical: 0,
      warning: 0,
      info: 1,
      findings: [
        {
          code: 'SELFDR-OPERATOR-CHECK',
          severity: 'info',
          component_id: 'postgres-control-db',
          component_kind: 'postgres_control_db',
          message: 'Operator-triggered Self-DR assessment completed.',
        },
      ],
      restore_plan: {
        profile_id: 'control-plane',
        waves: [],
      },
      created_by: 'dr-operator@clario.dev',
      created_at: now,
    },
    verdict: 'ready',
    findings: [
      {
        code: 'SELFDR-OPERATOR-CHECK',
        severity: 'info',
        component_id: 'postgres-control-db',
        component_kind: 'postgres_control_db',
        message: 'Operator-triggered Self-DR assessment completed.',
      },
    ],
    restore_plan: {
      profile_id: 'control-plane',
      waves: [],
    },
  },
  selfDRBackupArtifact: {
    id: 'selfdr-artifact-operator-backup',
    tenant_id: 'tenant-dr',
    kind: 'control_plane_backup',
    component_id: 'postgres-control-db',
    component_kind: 'postgres_control_db',
    key: 'selfdr/operator/postgres-control-db.snapshot',
    uri: 'worm://tenant-dr/selfdr/operator/postgres-control-db.snapshot',
    version_id: 'operator-v1',
    sha256: 'sha256-selfdr-operator-backup',
    size_bytes: 3221225472,
    captured_at: now,
    retain_until: '2027-06-13T09:00:00Z',
    location_id: 'operator-primary',
    immutable: true,
    encrypted: true,
    created_by: 'dr-operator@clario.dev',
    created_at: now,
  },
  selfDROfflineBundleArtifact: {
    id: 'selfdr-offline-bundle-operator',
    tenant_id: 'tenant-dr',
    kind: 'offline_restore_bundle',
    key: 'selfdr/operator/offline-bundle.tar.gz',
    uri: 'offline://tenant-dr/selfdr/operator/offline-bundle.tar.gz',
    version_id: 'operator-bundle-v1',
    sha256: 'sha256-selfdr-operator-offline-bundle',
    size_bytes: 12884901888,
    captured_at: now,
    retain_until: '2027-06-13T09:00:00Z',
    location_id: 'operator-offline',
    immutable: true,
    encrypted: true,
    created_by: 'dr-operator@clario.dev',
    created_at: now,
  },
};

const completedPaymentFailoverRun = {
  ...paymentGroup.last_run,
  run_id: 'fo-20260613-002',
  status: 'COMPLETED',
  rto_actual_seconds: 510,
  met_rto: true,
  approved_by: 'risk-owner@clario.dev',
  initiated_at: '2026-06-13T07:30:00Z',
  completed_at: '2026-06-13T07:38:30Z',
  updated_at: '2026-06-13T07:38:30Z',
};

const retiredByokKey = {
  ...drFixtures.byokKeys[0],
  id: 'byok-key-v2',
  key_version: 2,
  reference: 'arn:aws:kms:me-central-1:111122223333:key/retired-cyber-vault-key-v2',
  state: 'retired',
  activated_at: '2025-09-01T00:00:00Z',
  retired_at: '2026-03-01T00:00:00Z',
  updated_at: '2026-03-01T00:00:00Z',
};

const completedFailoverFixtures = {
  ...drFixtures,
  posture: {
    ...drFixtures.posture,
    overall_health: 'healthy',
    attention: [],
    groups: [
      {
        ...paymentGroup,
        health: 'healthy',
        replication_percent: 99,
        last_run: completedPaymentFailoverRun,
      },
      analyticsGroup,
    ],
    recent_runs: [completedPaymentFailoverRun],
  },
  failoverRuns: [completedPaymentFailoverRun],
  attestationLedger: [],
  byokKeys: [drFixtures.byokKeys[0], retiredByokKey],
};

type DRFixtureSet = Record<string, any>;

function requestBody(request: { postDataJSON: () => unknown }) {
  try {
    const value = request.postDataJSON();
    return value && typeof value === 'object' ? value as Record<string, any> : {};
  } catch {
    return {};
  }
}

async function mockClarioDrApi(page: Page, fixtures: DRFixtureSet = drFixtures, summaries: DRFixtureSet = groupSummaries) {
  await page.route('**/api/auth/session', async (route) => {
    const accessToken = createAccessToken();

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: accessToken,
        expires_at: '2099-01-01T00:00:00Z',
        tenant: {
          id: 'tenant-dr',
          name: 'Clario360 Test Tenant',
          slug: 'clario360-test',
          domain: null,
          status: 'active',
          subscription_tier: 'enterprise',
          settings: {},
          created_at: now,
          updated_at: now,
        },
        user: {
          id: 'user-dr',
          tenant_id: 'tenant-dr',
          email: 'dr-operator@clario.dev',
          first_name: 'DR',
          last_name: 'Operator',
          status: 'active',
          mfa_enabled: false,
          last_login_at: now,
          created_at: now,
          updated_at: now,
          roles: [
            {
              id: 'role-dr',
              tenant_id: 'tenant-dr',
              name: 'DR Operator',
              slug: 'dr-operator',
              description: 'Can inspect ClarioDR posture',
              permissions: ['dr:read', '*:read'],
              is_system: true,
              created_at: now,
              updated_at: now,
            },
          ],
        },
      }),
    });
  });

  await routeClarioDrEndpoints(page, fixtures, summaries);
}

async function routeClarioDrEndpoints(page: Page, fixtures: DRFixtureSet = drFixtures, summaries: DRFixtureSet = groupSummaries) {
  const createdAgents: DRFixtureSet[] = [];
  let mutableFailoverRuns = [...(fixtures.failoverRuns ?? [])];
  let mutableFailbackRuns = [...(fixtures.failbackRuns ?? [])];
  let mutableRegistryRunbook = fixtures.registryRunbook;
  let mutableRegistryVersions = [...(fixtures.registryVersions ?? [])];
  let mutableRecoveryPoints = [...(fixtures.recoveryPoints ?? [])];
  let mutableJournalBookmarks = [...(fixtures.journalTimeline?.bookmarks ?? [])];
  let mutableReplicationStreams = [...(fixtures.replicationSummary?.streams ?? [])];
  let mutableConsistencyBarriers = [...(fixtures.consistencyBarriers ?? [])];
  let mutableDrillSchedules = [...(fixtures.drillSchedules ?? [])];
  const mutableInstantSessions: Record<string, DRFixtureSet> = {};

  await page.route('**/api/v1/dr**', async (route) => {
    const request = route.request();

    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204 });
      return;
    }

    const url = new URL(request.url());
    const method = request.method().toUpperCase();
    const groupSummaryMatch = url.pathname.match(/\/api\/v1\/dr\/groups\/([^/]+)\/summary$/);
    const attestationProofMatch = url.pathname.match(/\/api\/v1\/dr\/attestation-ledger\/(\d+)\/proof$/);
    const agentEnrollmentMatch = url.pathname.match(/\/api\/v1\/dr\/agents\/([^/]+)\/enrollment-token$/);
    const failoverApproveMatch = url.pathname.match(/\/api\/v1\/dr\/failover-runs\/([^/]+)\/approve$/);
    const failoverCancelMatch = url.pathname.match(/\/api\/v1\/dr\/failover-runs\/([^/]+)\/cancel$/);
    const failbackAdvanceMatch = url.pathname.match(/\/api\/v1\/dr\/failback-runs\/([^/]+)\/advance$/);
    const failbackApproveCutbackMatch = url.pathname.match(/\/api\/v1\/dr\/failback-runs\/([^/]+)\/approve-cutback$/);
    const bcmAssessMatch = url.pathname.match(/\/api\/v1\/dr\/bcm\/packs\/([^/]+)\/assess$/);
    const cyberVaultEvaluateMatch = url.pathname.match(/\/api\/v1\/dr\/cyber-vaults\/([^/]+)\/evaluate$/);
    const iacDiffMatch = url.pathname.match(/\/api\/v1\/dr\/iac-snapshots\/([^/]+)\/diff$/);
    const iacPlanMatch = url.pathname.match(/\/api\/v1\/dr\/iac-snapshots\/([^/]+)\/reconstitution-plan$/);
    const storageSnapshotRequestMatch = url.pathname.match(/\/api\/v1\/dr\/storage-volumes\/([^/]+)\/snapshots$/);
    const storageSnapshotReplicateMatch = url.pathname.match(/\/api\/v1\/dr\/storage-snapshots\/([^/]+)\/replicate$/);
    const workloadCaptureRunMatch = url.pathname.match(/\/api\/v1\/dr\/workload-captures\/([^/]+)\/run$/);
    const recoveryPointValidateMatch = url.pathname.match(/\/api\/v1\/dr\/recovery-points\/([^/]+)\/validate$/);
    const recoveryPointInstantMatch = url.pathname.match(/\/api\/v1\/dr\/recovery-points\/([^/]+)\/instant-recovery$/);
    const groupRecoveryPointsMatch = url.pathname.match(/\/api\/v1\/dr\/groups\/([^/]+)\/recovery-points$/);
    const groupAppConsistentPointMatch = url.pathname.match(/\/api\/v1\/dr\/groups\/([^/]+)\/app-consistent-point$/);
    const groupJournalMaterializeMatch = url.pathname.match(/\/api\/v1\/dr\/groups\/([^/]+)\/journal\/materialize$/);
    const gameDayScenarioRunsMatch = url.pathname.match(/\/api\/v1\/dr\/gameday\/scenarios\/([^/]+)\/runs$/);
    const streamPauseMatch = url.pathname.match(/\/api\/v1\/dr\/streams\/([^/]+)\/pause$/);
    const streamResumeMatch = url.pathname.match(/\/api\/v1\/dr\/streams\/([^/]+)\/resume$/);
    const streamJournalBookmarksMatch = url.pathname.match(/\/api\/v1\/dr\/streams\/([^/]+)\/journal\/bookmarks$/);
    const streamJournalBookmarkMatch = url.pathname.match(/\/api\/v1\/dr\/streams\/([^/]+)\/journal\/bookmarks\/([^/]+)$/);
    const instantSessionMatch = url.pathname.match(/\/api\/v1\/dr\/instant-sessions\/([^/]+)$/);
    const instantSessionFinalizeMatch = url.pathname.match(/\/api\/v1\/dr\/instant-sessions\/([^/]+)\/finalize$/);
    let data: unknown;

    if (method === 'POST' && url.pathname.endsWith('/api/v1/dr/agents')) {
      const agent = {
        ...(fixtures.agents?.[0] ?? {}),
        id: 'agent-new-enrollment',
        site_id: null,
        status: 'pending',
        mtls_thumbprint: null,
        cert_serial: null,
        cert_issued_at: null,
        cert_expires_at: null,
        cert_revoked_at: null,
        cert_revoked_reason: null,
        last_seen_at: null,
        created_at: now,
      };
      createdAgents.push(agent);
      data = agent;
    } else if (method === 'POST' && agentEnrollmentMatch) {
      data = {
        ...fixtures.agentEnrollmentToken,
        agent_id: decodeURIComponent(agentEnrollmentMatch[1]),
      };
    } else if (method === 'GET' && attestationProofMatch) {
      data = {
        ...fixtures.ledgerProof,
        seq: Number(attestationProofMatch[1]),
      };
    } else if (method === 'POST' && url.pathname.endsWith('/api/v1/dr/attestation-ledger/anchor')) {
      data = fixtures.ledgerCheckpoint;
    } else if (method === 'POST' && url.pathname.endsWith('/api/v1/dr/failover-runs')) {
      const payload = requestBody(request);
      const run = {
        ...(fixtures.failoverRuns?.[0] ?? {}),
        id: 'fo-created-drill-001',
        run_id: 'fo-created-drill-001',
        group_id: payload.group_id ?? paymentGroup.group_id,
        mode: payload.mode ?? 'drill',
        status: 'INITIATED',
        recovery_point_id: payload.recovery_point_id ?? activeRecoveryPointID,
        rto_objective_seconds: payload.rto_objective_seconds ?? paymentGroup.rto_objective_seconds,
        approved_by: null,
        initiated_at: now,
        updated_at: now,
      };
      mutableFailoverRuns = [run, ...mutableFailoverRuns];
      data = run;
    } else if (method === 'POST' && failoverApproveMatch) {
      const runID = decodeURIComponent(failoverApproveMatch[1]);
      mutableFailoverRuns = mutableFailoverRuns.map((run) =>
        (run.id ?? run.run_id) === runID
          ? { ...run, id: runID, run_id: run.run_id ?? runID, status: 'APPROVED', approved_by: 'risk-owner@clario.dev', updated_at: now }
          : run,
      );
      data = mutableFailoverRuns.find((run) => (run.id ?? run.run_id) === runID) ?? { ...paymentGroup.last_run, id: runID, status: 'APPROVED' };
    } else if (method === 'POST' && failoverCancelMatch) {
      const runID = decodeURIComponent(failoverCancelMatch[1]);
      mutableFailoverRuns = mutableFailoverRuns.map((run) =>
        (run.id ?? run.run_id) === runID ? { ...run, id: runID, run_id: run.run_id ?? runID, status: 'CANCELLED', updated_at: now } : run,
      );
      data = mutableFailoverRuns.find((run) => (run.id ?? run.run_id) === runID) ?? { ...paymentGroup.last_run, id: runID, status: 'CANCELLED' };
    } else if (method === 'POST' && url.pathname.endsWith('/api/v1/dr/failback-runs')) {
      const payload = requestBody(request);
      const run = {
        ...(fixtures.failbackRuns?.[0] ?? {}),
        id: 'fb-created-001',
        group_id: payload.group_id ?? paymentGroup.group_id,
        failover_run_id: payload.failover_run_id ?? paymentGroup.last_run.run_id,
        from_site: payload.from_site ?? degradedPaymentStream.site_id,
        to_site: payload.to_site ?? healthyPaymentStream.site_id,
        status: 'PLANNED',
        initiated_at: now,
        updated_at: now,
      };
      mutableFailbackRuns = [run, ...mutableFailbackRuns];
      data = run;
    } else if (method === 'POST' && failbackAdvanceMatch) {
      const runID = decodeURIComponent(failbackAdvanceMatch[1]);
      mutableFailbackRuns = mutableFailbackRuns.map((run) =>
        run.id === runID
          ? {
              ...run,
              status: 'AWAITING_CUTBACK_APPROVAL',
              delta_bytes_remaining: 0,
              delta_seq_remaining: 0,
              cutover_window_open: true,
              last_converged_at: now,
              updated_at: now,
            }
          : run,
      );
      data = mutableFailbackRuns.find((run) => run.id === runID) ?? { ...(fixtures.failbackRuns?.[0] ?? {}), id: runID };
    } else if (method === 'POST' && failbackApproveCutbackMatch) {
      const runID = decodeURIComponent(failbackApproveCutbackMatch[1]);
      mutableFailbackRuns = mutableFailbackRuns.map((run) =>
        run.id === runID
          ? { ...run, status: 'CUTTING_BACK', approved_by: 'risk-owner@clario.dev', approved_at: now, updated_at: now }
          : run,
      );
      data = mutableFailbackRuns.find((run) => run.id === runID) ?? { ...(fixtures.failbackRuns?.[0] ?? {}), id: runID };
    } else if (method === 'POST' && url.pathname.match(/\/api\/v1\/dr\/groups\/[^/]+\/runbook\/regenerate$/)) {
      mutableRegistryRunbook = regeneratedRegistryRunbook;
      mutableRegistryVersions = [regeneratedRegistryRunbook, ...(fixtures.registryVersions ?? [])];
      data = {
        version: regeneratedRegistryRunbook,
        changed: true,
        diff: regeneratedRegistryRunbook.diff,
      };
    } else if (method === 'POST' && url.pathname.match(/\/api\/v1\/dr\/groups\/[^/]+\/boot-runs$/)) {
      data = {
        run: {
          id: 'boot-run-payments-001',
          tenant_id: 'tenant-dr',
          group_id: paymentGroup.group_id,
          status: 'STARTED',
          policy: 'isolated',
          total_tiers: 2,
          tiers_booted: 0,
          initiated_by: 'dr-operator@clario.dev',
          last_error: null,
          started_at: now,
          completed_at: null,
        },
        services: [],
      };
    } else if (method === 'POST' && recoveryPointValidateMatch) {
      const pointID = decodeURIComponent(recoveryPointValidateMatch[1]);
      mutableRecoveryPoints = mutableRecoveryPoints.map((point) =>
        point.id === pointID
          ? {
              ...point,
              validation_ratio: 1,
              is_validated: true,
              legal_hold: true,
              sealed_at: point.sealed_at ?? now,
              retention_until: point.retention_until ?? '2027-06-13T09:00:00Z',
            }
          : point,
      );
      data = mutableRecoveryPoints.find((point) => point.id === pointID) ?? {
        ...(fixtures.recoveryPoints?.[0] ?? {}),
        id: pointID,
        validation_ratio: 1,
        is_validated: true,
        legal_hold: true,
        sealed_at: now,
        retention_until: '2027-06-13T09:00:00Z',
      };
    } else if (method === 'POST' && groupRecoveryPointsMatch) {
      const groupID = decodeURIComponent(groupRecoveryPointsMatch[1]);
      const sealedPoint = {
        ...(mutableRecoveryPoints[0] ?? fixtures.recoveryPoints?.[0] ?? {}),
        id: 'rp-payments-20260613-0900',
        tenant_id: 'tenant-dr',
        group_id: groupID,
        marker_lsn: fixtures.journalTimeline?.latest_lsn ?? '0/2B81290',
        rpo_seconds: 10,
        object_keys: {
          pg: 'worm://tenant-dr/recovery-points/rp-payments-20260613-0900/postgres.tar.zst',
          files: 'worm://tenant-dr/recovery-points/rp-payments-20260613-0900/files.delta',
        },
        content_hash: 'sha256-payments-sealed-20260613-0900',
        validation_ratio: 1,
        is_validated: true,
        legal_hold: true,
        sealed_at: now,
        retention_until: requestBody(request).retention_until ?? '2027-06-13T09:00:00Z',
      };
      mutableRecoveryPoints = [sealedPoint, ...mutableRecoveryPoints.filter((point) => point.id !== sealedPoint.id)];
      data = sealedPoint;
    } else if (method === 'POST' && groupAppConsistentPointMatch) {
      const groupID = decodeURIComponent(groupAppConsistentPointMatch[1]);
      const payload = requestBody(request);
      const barrier = {
        id: 'barrier-payments-operator-001',
        tenant_id: 'tenant-dr',
        group_id: groupID,
        recovery_point_id: 'rp-payments-app-consistent-20260613-0900',
        consistency_level: 'application',
        provider: payload.provider ?? 'script',
        barrier_lsn: '0/2B81300',
        success: true,
        quiesced: true,
        thawed: true,
        detail: 'operator freeze/thaw completed',
        error: '',
        requested_by: 'dr-operator@clario.dev',
        quiesce_started_at: now,
        quiesce_finished_at: now,
        thaw_started_at: now,
        thaw_finished_at: now,
        created_at: now,
      };
      mutableConsistencyBarriers = [barrier, ...mutableConsistencyBarriers.filter((item) => item.id !== barrier.id)];
      data = barrier;
    } else if (method === 'POST' && groupJournalMaterializeMatch) {
      const groupID = decodeURIComponent(groupJournalMaterializeMatch[1]);
      const payload = requestBody(request);
      const materializedPoint = {
        ...(mutableRecoveryPoints[0] ?? fixtures.recoveryPoints?.[0] ?? {}),
        id: 'rp-payments-apit-20260613-085930',
        tenant_id: 'tenant-dr',
        group_id: groupID,
        marker_lsn: payload.lsn ?? fixtures.journalTimeline?.latest_lsn ?? '0/2B81290',
        rpo_seconds: 0,
        object_keys: {
          pg: 'worm://tenant-dr/recovery-points/rp-payments-apit-20260613-085930/postgres.tar.zst',
        },
        content_hash: 'sha256-payments-apit-materialized-20260613-085930',
        validation_ratio: 1,
        is_validated: true,
        legal_hold: true,
        sealed_at: now,
        retention_until: payload.retention_until ?? '2027-06-13T09:00:00Z',
      };
      mutableRecoveryPoints = [materializedPoint, ...mutableRecoveryPoints.filter((point) => point.id !== materializedPoint.id)];
      data = materializedPoint;
    } else if (method === 'POST' && streamJournalBookmarksMatch) {
      const streamID = decodeURIComponent(streamJournalBookmarksMatch[1]);
      const payload = requestBody(request);
      const bookmark = {
        id: `bm-${payload.at_seq ?? fixtures.journalTimeline?.latest_seq ?? 8821}`,
        tenant_id: 'tenant-dr',
        stream_id: streamID,
        name: payload.name ?? 'operator-bookmark-8821',
        kind: payload.kind ?? 'operator',
        at_seq: payload.at_seq ?? fixtures.journalTimeline?.latest_seq ?? 8821,
        at_lsn: payload.at_lsn ?? fixtures.journalTimeline?.latest_lsn ?? '0/2B81290',
        at_ts: payload.at_ts ?? fixtures.journalTimeline?.latest_ts ?? now,
        note: payload.note ?? 'Operator-created APIT bookmark from ClarioDR recovery workbench.',
        created_by: 'dr-operator@clario.dev',
        created_at: now,
      };
      mutableJournalBookmarks = [bookmark, ...mutableJournalBookmarks.filter((item) => item.id !== bookmark.id)];
      data = bookmark;
    } else if (method === 'DELETE' && streamJournalBookmarkMatch) {
      const bookmarkID = decodeURIComponent(streamJournalBookmarkMatch[2]);
      mutableJournalBookmarks = mutableJournalBookmarks.filter((bookmark) => bookmark.id !== bookmarkID);
      data = {};
    } else if (method === 'POST' && recoveryPointInstantMatch) {
      const pointID = decodeURIComponent(recoveryPointInstantMatch[1]);
      const session = {
        id: 'ir-payments-20260613-0900',
        tenant_id: 'tenant-dr',
        recovery_point_id: pointID,
        group_id: requestBody(request).group_id ?? paymentGroup.group_id,
        state: 'ready',
        chunks_total: 64,
        chunks_hydrated: 64,
        chunk_size: 67108864,
        overlay_location: 'cow://tenant-dr/instant/ir-payments-20260613-0900',
        finalized_location: null,
        last_error: null,
        started_at: now,
        ready_at: now,
        finalized_at: null,
        updated_at: now,
      };
      mutableInstantSessions[session.id] = session;
      data = session;
    } else if (method === 'GET' && instantSessionMatch) {
      const sessionID = decodeURIComponent(instantSessionMatch[1]);
      const session = mutableInstantSessions[sessionID] ?? {
        id: sessionID,
        tenant_id: 'tenant-dr',
        recovery_point_id: activeRecoveryPointID,
        group_id: paymentGroup.group_id,
        state: 'ready',
        chunks_total: 64,
        chunks_hydrated: 64,
        chunk_size: 67108864,
        overlay_location: `cow://tenant-dr/instant/${sessionID}`,
        finalized_location: null,
        last_error: null,
        started_at: now,
        ready_at: now,
        finalized_at: null,
        updated_at: now,
      };
      mutableInstantSessions[sessionID] = session;
      data = { session, percent_complete: 100 };
    } else if (method === 'POST' && instantSessionFinalizeMatch) {
      const sessionID = decodeURIComponent(instantSessionFinalizeMatch[1]);
      const session = {
        ...(mutableInstantSessions[sessionID] ?? {}),
        id: sessionID,
        tenant_id: 'tenant-dr',
        recovery_point_id: mutableInstantSessions[sessionID]?.recovery_point_id ?? activeRecoveryPointID,
        group_id: mutableInstantSessions[sessionID]?.group_id ?? paymentGroup.group_id,
        state: 'finalized',
        chunks_total: mutableInstantSessions[sessionID]?.chunks_total ?? 64,
        chunks_hydrated: mutableInstantSessions[sessionID]?.chunks_total ?? 64,
        chunk_size: mutableInstantSessions[sessionID]?.chunk_size ?? 67108864,
        overlay_location: mutableInstantSessions[sessionID]?.overlay_location ?? `cow://tenant-dr/instant/${sessionID}`,
        finalized_location: 'worm://tenant-dr/instant-finalized/ir-payments-20260613-0900',
        last_error: null,
        started_at: mutableInstantSessions[sessionID]?.started_at ?? now,
        ready_at: mutableInstantSessions[sessionID]?.ready_at ?? now,
        finalized_at: now,
        updated_at: now,
      };
      mutableInstantSessions[sessionID] = session;
      data = session;
    } else if (method === 'POST' && streamPauseMatch) {
      const streamID = decodeURIComponent(streamPauseMatch[1]);
      mutableReplicationStreams = mutableReplicationStreams.map((stream) =>
        stream.stream_id === streamID ? { ...stream, status: 'paused', health: 'paused', updated_at: now } : stream,
      );
      data = {};
    } else if (method === 'POST' && streamResumeMatch) {
      const streamID = decodeURIComponent(streamResumeMatch[1]);
      mutableReplicationStreams = mutableReplicationStreams.map((stream) =>
        stream.stream_id === streamID ? { ...stream, status: 'streaming', health: 'healthy', updated_at: now, last_error: null } : stream,
      );
      data = {};
    } else if (method === 'POST' && url.pathname.endsWith('/api/v1/dr/drill-schedules')) {
      const payload = requestBody(request);
      const schedule = {
        id: 'sched-payments-operator-isolated',
        tenant_id: 'tenant-dr',
        group_id: payload.group_id ?? paymentGroup.group_id,
        name: payload.name ?? 'Tier 0 Payments Core isolated drill',
        cron_expr: payload.cron_expr ?? '0 2 * * 6',
        profile: payload.profile ?? 'isolated',
        rto_objective_seconds: payload.rto_objective_seconds ?? paymentGroup.rto_objective_seconds,
        enabled: payload.enabled ?? true,
        next_run: '2026-06-20T02:00:00Z',
        last_fired_at: null,
        created_at: now,
        updated_at: now,
      };
      mutableDrillSchedules = [schedule, ...mutableDrillSchedules.filter((item) => item.id !== schedule.id)];
      data = schedule;
    } else if (method === 'POST' && gameDayScenarioRunsMatch) {
      const scenarioID = decodeURIComponent(gameDayScenarioRunsMatch[1]);
      data = {
        run: {
          id: 'gameday-run-payments-lag-001',
          tenant_id: 'tenant-dr',
          scenario_id: scenarioID,
          group_id: paymentGroup.group_id,
          status: 'COMPLETED',
          safety_verdict: 'safe',
          score: 96,
          steps_total: 1,
          steps_passed: 1,
          all_faults_reverted: true,
          triggered_by: 'dr-operator@clario.dev',
          started_at: now,
          completed_at: now,
          created_at: now,
          updated_at: now,
        },
        steps: [
          {
            id: 'gameday-step-payments-lag-001',
            tenant_id: 'tenant-dr',
            run_id: 'gameday-run-payments-lag-001',
            step_index: 0,
            action: 'induce_lag',
            target: degradedPaymentStream.stream_id,
            observability: 'replication_lag_seconds',
            expected_signal: 'lag_alert',
            detect_within_ms: 30000,
            recover_within_ms: 120000,
            signal_observed: true,
            observed_signal: 'lag_alert',
            detection_latency_ms: 12000,
            recovery_latency_ms: 45000,
            fault_reverted: true,
            passed: true,
            detail: 'Lag alert observed and reverted inside policy.',
            started_at: now,
            finished_at: now,
          },
        ],
      };
    } else if (method === 'POST' && url.pathname.endsWith('/api/v1/dr/copilot/chat')) {
      data = fixtures.copilotResult;
    } else if (method === 'POST' && bcmAssessMatch) {
      data = {
        ...(fixtures.bcmAssessmentRun ?? {}),
        assessment: {
          ...(fixtures.bcmAssessmentRun?.assessment ?? {}),
          pack_key: decodeURIComponent(bcmAssessMatch[1]),
        },
      };
    } else if (method === 'POST' && url.pathname.endsWith('/api/v1/dr/byok/keys/rotate')) {
      data = fixtures.rotatedByokKey;
    } else if (method === 'POST' && cyberVaultEvaluateMatch) {
      data = {
        ...(fixtures.cyberVaultAssessment ?? {}),
        VaultID: decodeURIComponent(cyberVaultEvaluateMatch[1]),
      };
    } else if (method === 'POST' && url.pathname.endsWith('/api/v1/dr/iac-snapshots')) {
      data = fixtures.iacIngestedSnapshot;
    } else if (method === 'POST' && storageSnapshotRequestMatch) {
      data = {
        ...(fixtures.requestedStorageSnapshot ?? {}),
        volume_id: decodeURIComponent(storageSnapshotRequestMatch[1]),
      };
    } else if (method === 'POST' && storageSnapshotReplicateMatch) {
      data = {
        ...(fixtures.replicatedStorageSnapshot ?? {}),
        id: decodeURIComponent(storageSnapshotReplicateMatch[1]),
      };
    } else if (method === 'POST' && workloadCaptureRunMatch) {
      data = {
        ...(fixtures.workloadEpochRun ?? {}),
        source_id: decodeURIComponent(workloadCaptureRunMatch[1]),
      };
    } else if (method === 'POST' && url.pathname.endsWith('/api/v1/dr/selfdr/assess')) {
      data = fixtures.selfDRAssess;
    } else if (method === 'POST' && url.pathname.endsWith('/api/v1/dr/selfdr/backups')) {
      data = fixtures.selfDRBackupArtifact;
    } else if (method === 'POST' && url.pathname.endsWith('/api/v1/dr/selfdr/offline-bundle')) {
      data = fixtures.selfDROfflineBundleArtifact;
    } else if (method === 'GET' && url.pathname.match(/\/api\/v1\/dr\/copilot\/sessions\/[^/]+$/)) {
      data = fixtures.copilotTranscript;
    } else if (url.pathname.endsWith('/api/v1/dr/posture')) {
      data = fixtures.posture;
    } else if (url.pathname.endsWith('/api/v1/dr/replication/summary')) {
      data = {
        ...fixtures.replicationSummary,
        streams: mutableReplicationStreams,
      };
    } else if (url.pathname.endsWith('/api/v1/dr/failover-runs')) {
      data = mutableFailoverRuns;
    } else if (url.pathname.endsWith('/api/v1/dr/attestation-ledger')) {
      data = fixtures.attestationLedger;
    } else if (url.pathname.endsWith('/api/v1/dr/attestation-ledger/verify')) {
      data = fixtures.ledgerVerification;
    } else if (url.pathname.endsWith('/api/v1/dr/predictions')) {
      data = fixtures.predictions ?? [];
    } else if (url.pathname.match(/\/api\/v1\/dr\/streams\/[^/]+\/forecast$/)) {
      data = fixtures.streamForecast;
    } else if (url.pathname.endsWith('/api/v1/dr/ransomware/signals')) {
      data = fixtures.ransomwareSignals ?? [];
    } else if (url.pathname.match(/\/api\/v1\/dr\/ransomware\/streams\/[^/]+\/signals$/)) {
      data = (fixtures.ransomwareSignals ?? []).slice(0, 1);
    } else if (url.pathname.endsWith('/api/v1/dr/iac-snapshots')) {
      data = fixtures.iacSnapshots;
    } else if (method === 'GET' && iacDiffMatch) {
      data = {
        ...(fixtures.iacDiff ?? {}),
        target_snapshot_id: decodeURIComponent(iacDiffMatch[1]),
      };
    } else if (method === 'GET' && iacPlanMatch) {
      data = {
        ...(fixtures.iacPlan ?? {}),
        snapshot_id: decodeURIComponent(iacPlanMatch[1]),
      };
    } else if (url.pathname.endsWith('/api/v1/dr/storage-volumes')) {
      data = fixtures.storageVolumes ?? [];
    } else if (url.pathname.endsWith('/api/v1/dr/workload-captures')) {
      data = fixtures.workloadCaptures ?? [];
    } else if (url.pathname.match(/\/api\/v1\/dr\/workload-captures\/[^/]+\/epochs$/)) {
      data = fixtures.workloadEpochs ?? [];
    } else if (url.pathname.endsWith('/api/v1/dr/selfdr/components')) {
      data = fixtures.selfDRComponents;
    } else if (url.pathname.endsWith('/api/v1/dr/selfdr/assessments/latest')) {
      data = fixtures.selfDRLatest;
    } else if (url.pathname.endsWith('/api/v1/dr/selfdr/artifacts')) {
      data = fixtures.selfDRArtifacts ?? [];
    } else if (url.pathname.endsWith('/api/v1/dr/bcm/packs')) {
      data = fixtures.bcmPacks;
    } else if (url.pathname.endsWith('/api/v1/dr/byok/keys')) {
      data = fixtures.byokKeys;
    } else if (url.pathname.endsWith('/api/v1/dr/byok/keys/custody-log')) {
      data = fixtures.byokCustodyLog;
    } else if (url.pathname.endsWith('/api/v1/dr/cyber-vaults/assessments')) {
      data = { assessments: [fixtures.cyberVaultAssessment].filter(Boolean), count: fixtures.cyberVaultAssessment ? 1 : 0 };
    } else if (url.pathname.endsWith('/api/v1/dr/cyber-vaults')) {
      data = fixtures.cyberVaults ?? { vaults: [], count: 0 };
    } else if (method === 'GET' && url.pathname.endsWith('/api/v1/dr/agents')) {
      data = [...(fixtures.agents ?? []), ...createdAgents];
    } else if (url.pathname.endsWith('/api/v1/dr/assurance/controls')) {
      data = fixtures.assuranceControls ?? [];
    } else if (url.pathname.endsWith('/api/v1/dr/drill-schedules')) {
      data = mutableDrillSchedules;
    } else if (url.pathname.endsWith('/api/v1/dr/failback-runs')) {
      data = mutableFailbackRuns;
    } else if (url.pathname.endsWith('/api/v1/dr/gameday/scenarios')) {
      data = fixtures.gameDayScenarios ?? [];
    } else if (url.pathname.match(/\/api\/v1\/dr\/assurance\/groups\/[^/]+\/latest$/)) {
      data = fixtures.assuranceLatest;
    } else if (url.pathname.match(/\/api\/v1\/dr\/groups\/[^/]+\/boot-plan$/)) {
      data = fixtures.bootPlan;
    } else if (url.pathname.match(/\/api\/v1\/dr\/groups\/[^/]+\/consistency-barriers$/)) {
      data = mutableConsistencyBarriers;
    } else if (url.pathname.match(/\/api\/v1\/dr\/groups\/[^/]+\/drill-results$/)) {
      data = fixtures.drillResults ?? [];
    } else if (url.pathname.match(/\/api\/v1\/dr\/groups\/[^/]+\/topology\/failover-target$/)) {
      data = fixtures.topologySelection;
    } else if (url.pathname.match(/\/api\/v1\/dr\/groups\/[^/]+\/topology$/)) {
      data = fixtures.topology;
    } else if (method === 'GET' && groupRecoveryPointsMatch) {
      data = mutableRecoveryPoints;
    } else if (url.pathname.match(/\/api\/v1\/dr\/groups\/[^/]+\/runbook$/)) {
      data = mutableRegistryRunbook;
    } else if (url.pathname.match(/\/api\/v1\/dr\/groups\/[^/]+\/runbook\/versions$/)) {
      data = mutableRegistryVersions;
    } else if (url.pathname.match(/\/api\/v1\/dr\/streams\/[^/]+\/journal\/timeline$/)) {
      data = {
        ...fixtures.journalTimeline,
        bookmarks: mutableJournalBookmarks,
      };
    } else if (method === 'GET' && streamJournalBookmarksMatch) {
      data = mutableJournalBookmarks;
    } else if (url.pathname.match(/\/api\/v1\/dr\/recovery-points\/[^/]+\/cleanroom$/)) {
      data = fixtures.cleanRoomScan;
    } else if (groupSummaryMatch) {
      const groupID = decodeURIComponent(groupSummaryMatch[1]);
      data = summaries[groupID] ?? summaries[paymentGroup.group_id];
    } else {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: `Unhandled DR test endpoint: ${url.pathname}` }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data,
        meta: { total: Array.isArray(data) ? data.length : 1 },
      }),
    });
  });
}

function createAccessToken() {
  const payload = {
    sub: 'user-dr',
    email: 'dr-operator@clario.dev',
    tenant_id: 'tenant-dr',
    exp: 4_102_444_800,
    iat: 1_780_272_000,
    jti: 'dr-e2e-token',
    roles: ['dr-operator'],
    permissions: ['dr:read', '*:read'],
  };

  return [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'signature',
  ].join('.');
}

async function seedBrowserSession(page: Page) {
  await page.context().addCookies([
    {
      name: 'clario360_access',
      value: createAccessToken(),
      domain: 'localhost',
      path: '/',
      expires: 4_102_444_800,
      httpOnly: true,
      secure: false,
      sameSite: 'Strict',
    },
  ]);
}

async function expectVisibleText(scope: Locator, text: string | RegExp) {
  await expect(scope.getByText(text).first()).toBeVisible();
}

async function expectAttachedText(scope: Locator, text: string | RegExp) {
  await expect(scope.getByText(text).first()).toBeAttached();
}

async function clickAndWaitForDR(page: Page, trigger: Locator, path: string | RegExp, method = 'POST') {
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => {
      const url = new URL(candidate.url());
      const methodMatches = candidate.request().method().toUpperCase() === method.toUpperCase();
      const pathMatches = typeof path === 'string' ? url.pathname.endsWith(path) : path.test(url.pathname);
      return methodMatches && pathMatches;
    }),
    trigger.click(),
  ]);

  expect(response.ok()).toBeTruthy();
}

async function openTab(page: Page, name: string | RegExp) {
  await page.getByRole('tab', { name }).click();
}

test.describe('ClarioDR Page', () => {
  test.beforeEach(async ({ page }) => {
    await mockClarioDrApi(page);
    await seedBrowserSession(page);
    await page.goto('/dr');
  });

  test('renders dashboard posture with group readiness, recovery tiers, replication, and failover controls', async ({ page }) => {
    const main = page.locator('main#main');

    await expect(page).toHaveURL(/\/dr(?:[?#]|$)/);
    await expect(main).toBeVisible({ timeout: 15_000 });
    await expect(main.getByRole('heading', { name: 'ClarioDR Operations' })).toBeVisible();

    await expect(page.getByRole('tab', { name: 'Dashboard posture' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Protection groups' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Replication' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Recovery workbench' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Intelligence' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Coverage & self-DR' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Failover runs' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Evidence' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Sovereign readiness' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Resilience cockpit' })).toBeVisible();

    await expectVisibleText(main, 'Protected groups');
    await expectVisibleText(main, '2/2');
    await expectVisibleText(main, '3 protected sites, 7 recovery points');
    await expectVisibleText(main, 'Worst live RPO');
    await expectVisibleText(main, '2m 15s');
    await expectVisibleText(main, 'Replication streams');
    await expectVisibleText(main, '2/3');
    await expectVisibleText(main, '1 Degraded, 2 Healthy');
    await expectVisibleText(main, 'Readiness score');
    await expectVisibleText(main, '92%');

    await expectVisibleText(main, 'Protection group posture');
    await expectVisibleText(main, 'Tier 0 Payments Core');
    await expectVisibleText(main, 'Tier 2 Analytics Warehouse');
    await expectVisibleText(main, 'Payments DB replica is 2m 15s behind objective');

    await expectVisibleText(main, 'Four-gate failover');
    await expectVisibleText(main, 'Validate');
    await expectVisibleText(main, 'Approve');
    await expectVisibleText(main, 'Execute');
    await expectVisibleText(main, 'Attest');
    await expectVisibleText(main, 'live / AWAITING_APPROVAL');

    await main.getByRole('button', { name: 'Open runs' }).click();
    await expect(page.getByRole('tab', { name: 'Failover runs' })).toHaveAttribute('data-state', 'active');
    await expectVisibleText(main, 'Active run details');
    await expectVisibleText(main, 'Run log preview');
    await expectVisibleText(main, 'gate1.validate recovery-point pinned and RPO checked');
    await expectVisibleText(main, 'fo-20260613-001');
    await expectVisibleText(main, activeRecoveryPointID);
  });

  test('shows protection group detail with latest immutable recovery point and boot order', async ({ page }) => {
    const main = page.locator('main#main');

    await openTab(page, 'Protection groups');

    await expectVisibleText(main, 'Consistency sets grouped by recovery objective and boot order.');
    await expectVisibleText(main, 'Latest recovery point');
    await expectVisibleText(main, activeRecoveryPointID);
    await expectVisibleText(main, 'Validated');
    await expectVisibleText(main, 'WORM');
    await expectVisibleText(main, 'Boot order and member streams');
    await expectVisibleText(main, 'Jeddah Primary');
    await expectVisibleText(main, 'Riyadh Core');

    await main.getByRole('button', { name: /Tier 2 Analytics Warehouse/ }).click();
    await expectVisibleText(main, 'rp-analytics-20260613-0830');
    await expectVisibleText(main, 'Dubai Clean Room');
  });

  test('shows replication transport health and live RPO breach detail', async ({ page }) => {
    const main = page.locator('main#main');

    await openTab(page, 'Replication');

    await expectVisibleText(main, 'Total streams');
    await expectVisibleText(main, 'Worst RPO');
    await expectVisibleText(main, 'RPO breaches');
    await expectVisibleText(main, 'Overall health');
    await expectVisibleText(main, 'Continuous data protection transport, live RPO, checkpoint age, and stream errors.');
    await expectVisibleText(main, 'stream-payments-db-primary');
    await expectVisibleText(main, 'stream-payments-db-secondary');
    await expectVisibleText(main, 'Network jitter above policy');
    await expectVisibleText(main, 'Dubai Clean Room');
    await expectVisibleText(main, 'Replication stream actions');

    await clickAndWaitForDR(
      page,
      main.getByRole('button', { name: /Pause replication stream Riyadh Core/ }),
      /\/api\/v1\/dr\/streams\/stream-payments-db-secondary\/pause$/,
    );
    await expectVisibleText(main, 'Latest pause');
    await expectVisibleText(main, 'stream-payments-db-secondary');

    await clickAndWaitForDR(
      page,
      main.getByRole('button', { name: /Resume replication stream Riyadh Core/ }),
      /\/api\/v1\/dr\/streams\/stream-payments-db-secondary\/resume$/,
    );
    await expectVisibleText(main, 'Latest resume');
  });

  test('shows recovery workbench for sealed points, APIT journal coverage, bookmarks, and ledger verification', async ({ page }) => {
    const main = page.locator('main#main');

    await openTab(page, 'Recovery workbench');

    await expectVisibleText(main, 'Recovery point catalog');
    await expectVisibleText(main, activeRecoveryPointID);
    await expectVisibleText(main, 'APIT journal timeline');
    await expectVisibleText(main, 'seg-payments-8761-8821');
    await expectVisibleText(main, 'pre-approval checkpoint');
    await expectVisibleText(main, 'Attestation ledger verification');
    await expectVisibleText(main, 'sha256-...-0007');
    await expectVisibleText(main, 'Recovery point actions');

    await clickAndWaitForDR(
      page,
      main.getByRole('button', { name: 'Validate latest point' }),
      /\/api\/v1\/dr\/recovery-points\/rp-payments-20260613-0845\/validate$/,
    );
    await expectVisibleText(main, 'Validation output');
    await expectVisibleText(main, 'validated');

    await clickAndWaitForDR(
      page,
      main.getByRole('button', { name: 'Seal latest point' }),
      /\/api\/v1\/dr\/groups\/grp-payments-core\/recovery-points$/,
    );
    await expectVisibleText(main, 'rp-payments-20260613-0900');

    await clickAndWaitForDR(
      page,
      main.getByRole('button', { name: 'Create APIT bookmark' }),
      /\/api\/v1\/dr\/streams\/stream-payments-db-primary\/journal\/bookmarks$/,
    );
    await expectVisibleText(main, 'operator-bookmark-8821');

    await clickAndWaitForDR(
      page,
      main.getByRole('button', { name: 'Delete APIT bookmark operator-bookmark-8821' }),
      /\/api\/v1\/dr\/streams\/stream-payments-db-primary\/journal\/bookmarks\/bm-8821$/,
      'DELETE',
    );
    await expectVisibleText(main, 'pre-approval checkpoint');

    await clickAndWaitForDR(
      page,
      main.getByRole('button', { name: 'Materialize journal point' }),
      /\/api\/v1\/dr\/groups\/grp-payments-core\/journal\/materialize$/,
    );
    await expectVisibleText(main, 'rp-payments-apit-20260613-085930');

    const instantProgress = page.waitForResponse((candidate) => {
      const url = new URL(candidate.url());
      return (
        candidate.request().method().toUpperCase() === 'GET' &&
        url.pathname.endsWith('/api/v1/dr/instant-sessions/ir-payments-20260613-0900')
      );
    });
    await clickAndWaitForDR(
      page,
      main.getByRole('button', { name: 'Start instant recovery', exact: true }),
      /\/api\/v1\/dr\/recovery-points\/rp-payments-apit-20260613-085930\/instant-recovery$/,
    );
    expect((await instantProgress).ok()).toBeTruthy();
    await expectVisibleText(main, '100% hydrated');

    await clickAndWaitForDR(
      page,
      main.getByRole('button', { name: 'Finalize instant recovery' }),
      /\/api\/v1\/dr\/instant-sessions\/ir-payments-20260613-0900\/finalize$/,
    );
    await expectVisibleText(main, 'finalized');

    await main.getByRole('button', { name: 'Stage failover from validated point' }).click();
    await expect(page.getByRole('tab', { name: 'Failover runs' })).toHaveAttribute('data-state', 'active');
    await expectVisibleText(main, 'Run log preview');
  });

  test('runs recovery execution actions for failover, failback, and isolated boot', async ({ page }) => {
    const main = page.locator('main#main');

    await openTab(page, 'Failover runs');

    await expectVisibleText(main, 'Recovery execution actions');
    await expectVisibleText(main, 'Execution readiness');
    await expectVisibleText(main, 'Boot plan order');
    await expectVisibleText(main, 'payments-db');
    await main.getByRole('button', { name: /Approve failover/ }).click();
    await expectVisibleText(main, 'approved');
    await main.getByRole('button', { name: /Advance failback/ }).click();
    await expectVisibleText(main, 'awaiting cutback approval');
    await main.getByRole('button', { name: /Approve cutback/ }).click();
    await expectVisibleText(main, 'cutting back');
    await main.getByRole('button', { name: /Start isolated boot/ }).click();
    await expectVisibleText(main, 'Boot plan order');
  });

  test('shows intelligence plane for predictions, ransomware signals, cleanroom, registry runbooks, and copilot guardrails', async ({ page }) => {
    const main = page.locator('main#main');

    await openTab(page, 'Intelligence');

    await expectVisibleText(main, 'Predictive RPO forecast');
    await expectVisibleText(main, 'Ransomware early warning');
    await expectVisibleText(main, 'Entropy spike isolated to attachment object store delta.');
    await expectVisibleText(main, 'Cleanroom validation');
    await expectVisibleText(main, 'No malware signatures detected; integrity hashes matched sealed manifest.');
    await expectVisibleText(main, 'Registry-generated runbook');
    await expectVisibleText(main, 'Pin validated recovery point');
    await expectVisibleText(main, 'Copilot guardrails');
    await expectVisibleText(main, 'Copilot commands');
    await expectVisibleText(main, 'Latest copilot answer');
    await main.getByRole('button', { name: /Explain failover risk/ }).click();
    await expectVisibleText(main, /Top DR failover risk/);
    await expectVisibleText(main, 'dr_posture_lookup');
    await main.getByRole('button', { name: /Load transcript/ }).click();
    await expectVisibleText(main, 'Confirm gate-2 approval evidence before promoting the recovery target.');
    await main.getByRole('button', { name: 'Regenerate' }).click();
    await expectVisibleText(main, 'runbook v5');
  });

  test('shows coverage and self-DR plane for IaC, workload captures, storage offload, and offline bundles', async ({ page }) => {
    const main = page.locator('main#main');

    await openTab(page, 'Coverage & self-DR');

    await expectVisibleText(main, 'IaC coverage and diff readiness');
    await expectVisibleText(main, 'prod-terraform-state-v2');
    await expectVisibleText(main, 'VM and Kubernetes captures');
    await expectVisibleText(main, 'payments-db-vm');
    await expectVisibleText(main, 'Storage offload volumes');
    await expectVisibleText(main, 'payments-attachments-volume');
    await expectVisibleText(main, 'Self-DR readiness');
    await expectVisibleText(main, 'WORM object store retention is below target for one evidence prefix.');
    await expectVisibleText(main, 'Self-DR restore plan');
    await expectVisibleText(main, 'Postgres control DB');
    await expectVisibleText(main, 'selfdr/offline-bundle-20260613.tar.gz');

    await expectVisibleText(main, 'IaC operator actions');
    await clickAndWaitForDR(page, main.getByRole('button', { name: /^Load drift diff:/ }), /\/api\/v1\/dr\/iac-snapshots\/[^/]+\/diff$/, 'GET');
    await expectAttachedText(main, 'aws_route53_record.payments');
    await clickAndWaitForDR(page, main.getByRole('button', { name: /^Build plan:/ }), /\/api\/v1\/dr\/iac-snapshots\/[^/]+\/reconstitution-plan$/, 'GET');
    await expectAttachedText(main, 'aws_db_instance.payments');
    await clickAndWaitForDR(page, main.getByRole('button', { name: /^Ingest IaC:/ }), '/api/v1/dr/iac-snapshots');

    await expectVisibleText(main, 'Storage and workload actions');
    await clickAndWaitForDR(
      page,
      main.getByRole('button', { name: 'Request snapshot for payments-attachments-volume' }),
      /\/api\/v1\/dr\/storage-volumes\/[^/]+\/snapshots$/,
    );
    await clickAndWaitForDR(
      page,
      main.getByRole('button', { name: /^Replicate latest snapshot:/ }),
      /\/api\/v1\/dr\/storage-snapshots\/[^/]+\/replicate$/,
    );
    await expectVisibleText(main, 'recovery-vault');
    await clickAndWaitForDR(
      page,
      main.getByRole('button', { name: /^Run workload capture:/ }),
      /\/api\/v1\/dr\/workload-captures\/[^/]+\/run$/,
    );

    await expectVisibleText(main, 'Self-DR operator actions');
    await clickAndWaitForDR(page, main.getByRole('button', { name: /^Assess Self-DR:/ }), '/api/v1/dr/selfdr/assess');
    await clickAndWaitForDR(page, main.getByRole('button', { name: /^Capture backup:/ }), '/api/v1/dr/selfdr/backups');
    await clickAndWaitForDR(page, main.getByRole('button', { name: /^Generate bundle:/ }), '/api/v1/dr/selfdr/offline-bundle');
  });

  test('shows cyber-vault evidence and sovereign recovery readiness controls', async ({ page }) => {
    const main = page.locator('main#main');

    await openTab(page, 'Evidence');
    await expectVisibleText(main, 'Evidence posture');
    await expectVisibleText(main, 'WORM locked');
    await expectVisibleText(main, 'Hash chain');
    await expectVisibleText(main, 'Latest attestation');
    await expectVisibleText(main, 'att-drill-20260612-003');
    await expectVisibleText(main, 'cyber-vault://tenant-dr/attestations/drill-20260612-003.json');
    await expectVisibleText(main, 'Gate-4 attestation ledger');
    await expectVisibleText(main, 'Immutable evidence retention');
    await expectVisibleText(main, 'Attestation ledger');
    await expectVisibleText(main, 'Anchor readiness');
    await main.getByRole('button', { name: 'Proof' }).first().click();
    await expectVisibleText(main, 'sha256-root-20260612');
    await main.getByRole('button', { name: 'Anchor ledger' }).click();
    await expectVisibleText(main, 'sha256-...60613');
    await expectVisibleText(main, 'worm://tenant-dr/attestation-ledger/checkpoints/20260613.json');

    await openTab(page, 'Sovereign readiness');
    await expectVisibleText(main, 'Residency, immutable recovery, encryption custody, and air-gap posture.');
    await expectVisibleText(main, 'Regulator ready');
    await expectVisibleText(main, 'Data residency');
    await expectVisibleText(main, 'sovereign controls active');
    await expectVisibleText(main, 'Recovery points');
    await expectVisibleText(main, '1 WORM items');
    await expectVisibleText(main, 'Key custody');
    await expectVisibleText(main, 'AWS KMS key v3');
    await expectVisibleText(main, 'Air gap');
    await expectVisibleText(main, 'sama-bcm:2026');
    await expectVisibleText(main, 'BCM compliance packs');
    await expectVisibleText(main, 'BYOK key custody');
    await expectVisibleText(main, 'SAMA BCM 2026');
    await expectVisibleText(main, 'NCA ECC 2024');
    await expectVisibleText(main, 'Sovereign readiness actions');
    await expectVisibleText(main, 'BYOK custody chain');
    await expectVisibleText(main, 'Cyber-vault evidence');
    await expectVisibleText(main, 'Payments Immutable Cyber Vault');
    await expectVisibleText(main, 'Break-glass MFA drill is inside policy but approaching the refresh window.');
    await clickAndWaitForDR(page, main.getByRole('button', { name: 'Assess BCM pack' }), /\/api\/v1\/dr\/bcm\/packs\/[^/]+\/assess$/);
    await expectVisibleText(main, 'BCM-DR-02');
    await clickAndWaitForDR(page, main.getByRole('button', { name: 'Rotate BYOK key' }), '/api/v1/dr/byok/keys/rotate');
    await expectVisibleText(main, 'v4');
    await clickAndWaitForDR(page, main.getByRole('button', { name: 'Evaluate cyber vault' }), /\/api\/v1\/dr\/cyber-vaults\/[^/]+\/evaluate$/);
  });

  test('derives gate-4 evidence from completed failover runs and active BYOK custody', async ({ page }) => {
    await page.unroute('**/api/v1/dr**');
    await routeClarioDrEndpoints(page, completedFailoverFixtures);
    await page.reload();

    await expect(page.locator('main#main').getByRole('heading', { name: 'ClarioDR Operations' })).toBeVisible();

    await openTab(page, 'Failover runs');
    let panel = page.getByRole('tabpanel');
    await expectVisibleText(panel, 'live / COMPLETED');
    await expect(panel.getByText('Done')).toHaveCount(4);
    await expectVisibleText(panel, 'gate1.validate recovery-point pinned and RPO checked');
    await expectVisibleText(panel, 'gate2.approve approver=risk-owner@clario.dev');
    await expectVisibleText(panel, 'gate3.execute boot-order started');
    await expectVisibleText(panel, 'gate4.attest rto=8m 30s met=true');

    await openTab(page, 'Evidence');
    panel = page.getByRole('tabpanel');
    await expectVisibleText(panel, 'Evidence library');
    await expectVisibleText(panel, completedPaymentFailoverRun.run_id);
    await expectVisibleText(panel, 'failover attestation');
    await expectVisibleText(panel, 'indexed evidence');
    await expectVisibleText(panel, 'Gate-4 attestation ledger');

    await openTab(page, 'Sovereign readiness');
    panel = page.getByRole('tabpanel');
    await expectVisibleText(panel, 'AWS KMS key v3');
    await expectVisibleText(panel, drFixtures.byokKeys[0].reference);
    await expect(panel.getByText(retiredByokKey.reference)).toHaveCount(0);
  });

  test('shows resilience cockpit for agents, assurance, drills, failback, topology, and game-day safety', async ({ page }) => {
    const main = page.locator('main#main');

    await openTab(page, 'Resilience cockpit');

    await expectVisibleText(main, 'Agent enrollment');
    await expectVisibleText(main, 'Agent fleet');
    await expectVisibleText(main, 'agent-jed-primary');
    await expectVisibleText(main, 'agent-ruh-core');
    await expectVisibleText(main, 'Assurance controls');
    await expectVisibleText(main, 'Agent heartbeat stale');
    await expectVisibleText(main, 'Weekly isolated payments drill');
    await expectVisibleText(main, 'drill-payments-20260612');
    await expectVisibleText(main, 'Topology and boot DAG');
    await expectVisibleText(main, 'payments-api');
    await expectVisibleText(main, 'fb-payments-001');
    await expectVisibleText(main, 'Payments lag signal exercise');
    await expectVisibleText(main, /script \/ application/);
    await expectVisibleText(main, 'Resilience actions');
    await clickAndWaitForDR(
      page,
      main.getByRole('button', { name: 'Trigger app-consistent point' }),
      /\/api\/v1\/dr\/groups\/grp-payments-core\/app-consistent-point$/,
    );
    await expectVisibleText(main, 'App-consistent barrier output');
    await expectVisibleText(main, /script sealed point/);
    await clickAndWaitForDR(
      page,
      main.getByRole('button', { name: 'Create isolated drill' }),
      '/api/v1/dr/drill-schedules',
    );
    await expectVisibleText(main, 'Drill schedule output');
    await expectVisibleText(main, 'Tier 0 Payments Core isolated drill');
    await clickAndWaitForDR(
      page,
      main.getByRole('button', { name: 'Run game-day scenario Payments lag signal exercise' }),
      /\/api\/v1\/dr\/gameday\/scenarios\/gameday-payments-lag\/runs$/,
    );
    await expectVisibleText(main, 'Game-day scorecard output');
    await expectVisibleText(main, 'score 96 / 1/1 passed / all faults reverted');
    await main.getByRole('button', { name: 'Select agent agent-jed-primary' }).click();
    await main.getByRole('button', { name: 'Mint enrollment token' }).click();
    await expectVisibleText(main, 'enroll-j...rimary');
    await main.getByRole('button', { name: 'Create agent' }).click();
    await expectVisibleText(main, 'agent-new-enrollment');
  });

  test('keeps ClarioDR operations visible and navigable on mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();

    const main = page.locator('main#main');
    await expect(main.getByRole('heading', { name: 'ClarioDR Operations' })).toBeVisible();
    await expectVisibleText(main, 'Protected groups');
    await expectVisibleText(main, 'Four-gate failover');

    await openTab(page, 'Sovereign readiness');
    await expectVisibleText(main, 'Sovereign readiness');
    await expectVisibleText(main, 'Regulator ready');

    const hasHorizontalPageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(hasHorizontalPageOverflow).toBe(false);
  });
});
