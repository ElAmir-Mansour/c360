import type { RespondCapability, RespondProduct } from '@/types/respond';
import type { RespondCapabilityReasonLabels } from '../_lib/respond-i18n';

export const RESPOND_CAPABILITY_GROUPS = {
  declaration: ['declaration'],
  triage: ['triage', 'severity-assessment', 'impact-assessment'],
  serviceLinkage: ['service-linkage', 'services', 'metastore-linkage'],
  mobilization: ['mobilization', 'roles', 'role-mobilization'],
  tasks: ['task-execution', 'tasks', 'task-led-response'],
  integrations: ['integrations', 'itsm-comms'],
  stakeholderUpdates: ['stakeholder-updates', 'stakeholder-communications'],
  approvals: ['approval-gates', 'approvals'],
  pirEvidence: ['pir-evidence', 'post-incident-review', 'evidence-export'],
} as const;

export type RespondCapabilityGroup = keyof typeof RESPOND_CAPABILITY_GROUPS;

export function findRespondCapability(
  product: RespondProduct | undefined,
  group: RespondCapabilityGroup,
): RespondCapability | undefined {
  const ids: readonly string[] = RESPOND_CAPABILITY_GROUPS[group];
  return product?.capabilities.find((capability) => ids.includes(capability.id));
}

export function isRespondCapabilityEnabled(
  product: RespondProduct | undefined,
  group: RespondCapabilityGroup,
): boolean {
  return Boolean(findRespondCapability(product, group)?.enabled);
}

export function respondCapabilityDisabledReason(
  product: RespondProduct | undefined,
  group: RespondCapabilityGroup,
  label: string,
  reasons: RespondCapabilityReasonLabels,
): string | undefined {
  if (!product) {
    return reasons.stateUnavailable;
  }
  const capability = findRespondCapability(product, group);
  if (!capability) {
    return reasons.requiresCapability(label);
  }
  if (!capability.enabled) {
    return (
      product.entitlement_reason ??
      capability.description ??
      reasons.disabledByEntitlement(label)
    );
  }
  return undefined;
}
