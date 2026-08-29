import type { WatheeqDomain } from './types';
import { domain as intakeServiceDesk } from './intake-service-desk';
import { domain as casesLitigation } from './cases-litigation';
import { domain as consultationsInvestigations } from './consultations-investigations';
import { domain as contractsClm } from './contracts-clm';
import { domain as clauseLibraryKnowledge } from './clause-library-knowledge';
import { domain as approvalsDoa } from './approvals-doa';
import { domain as rolesAccessSod } from './roles-access-sod';
import { domain as eSignatureIntegrations } from './e-signature-integrations';
import { domain as reportingAiGovernance } from './reporting-ai-governance';

/**
 * The nine Watheeq capability domains, in the same order as the "Inside Watheeq"
 * module cards on the app page. Each is a drill-down page at
 * /{suite}/watheeq/{slug}.
 */
export const WATHEEQ_DOMAINS: readonly WatheeqDomain[] = [
  intakeServiceDesk,
  casesLitigation,
  consultationsInvestigations,
  contractsClm,
  clauseLibraryKnowledge,
  approvalsDoa,
  rolesAccessSod,
  eSignatureIntegrations,
  reportingAiGovernance,
];

export const WATHEEQ_DOMAIN_SLUGS: readonly string[] = WATHEEQ_DOMAINS.map(
  (d) => d.slug,
);

export function getWatheeqDomain(slug: string): WatheeqDomain | undefined {
  return WATHEEQ_DOMAINS.find((d) => d.slug === slug);
}

export type { WatheeqDomain, WatheeqCapability, WatheeqCapStatus, Bilingual } from './types';
