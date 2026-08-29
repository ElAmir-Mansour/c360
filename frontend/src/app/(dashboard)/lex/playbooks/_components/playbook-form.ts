import type {
  LexClausePlaybook,
  LexClauseType,
  LexContractType,
  LexCreatePlaybookPayload,
  LexPlaybookClause,
  LexPlaybookStatus,
  LexPlaybookTemplate,
} from '@/types/suites';

export const CONTRACT_TYPES = [
  'service_agreement',
  'nda',
  'employment',
  'vendor',
  'license',
  'lease',
  'partnership',
  'consulting',
  'procurement',
  'sla',
  'mou',
  'amendment',
  'renewal',
  'other',
] as const satisfies readonly LexContractType[];

export const PLAYBOOK_STATUSES = [
  'active',
  'draft',
  'archived',
] as const satisfies readonly LexPlaybookStatus[];

export const CLAUSE_TYPES = [
  'indemnification',
  'termination',
  'limitation_of_liability',
  'confidentiality',
  'ip_ownership',
  'non_compete',
  'payment_terms',
  'warranty',
  'force_majeure',
  'dispute_resolution',
  'data_protection',
  'governing_law',
  'assignment',
  'insurance',
  'audit_rights',
  'sla',
  'auto_renewal',
  'representations',
  'non_solicitation',
  'other',
] as const satisfies readonly LexClauseType[];

export const DEFAULT_SIMILARITY_THRESHOLD = 0.75;

export interface PlaybookClauseDraft {
  clause_type: LexClauseType;
  title: string;
  standard_text: string;
  required: boolean;
  risk_weight: string;
  similarity_threshold: string;
}

export interface PlaybookFormValues {
  name: string;
  description: string;
  contract_type: LexContractType;
  status: LexPlaybookStatus;
  clauses: PlaybookClauseDraft[];
}

export function emptyClause(): PlaybookClauseDraft {
  return {
    clause_type: 'limitation_of_liability',
    title: '',
    standard_text: '',
    required: true,
    risk_weight: '1',
    similarity_threshold: String(DEFAULT_SIMILARITY_THRESHOLD),
  };
}

export function playbookDefaults(
  playbook?: LexClausePlaybook | null,
): PlaybookFormValues {
  if (playbook) {
    return {
      name: playbook.name,
      description: playbook.description ?? '',
      contract_type: normalizeContractType(playbook.contract_type),
      status: normalizeStatus(playbook.status),
      clauses:
        playbook.clauses.length > 0
          ? playbook.clauses.map((clause) => ({
              clause_type: normalizeClauseType(clause.clause_type),
              title: clause.title,
              standard_text: clause.standard_text,
              required: Boolean(clause.required),
              risk_weight: String(clause.risk_weight),
              similarity_threshold: String(clause.similarity_threshold),
            }))
          : [emptyClause()],
    };
  }

  return {
    name: '',
    description: '',
    contract_type: 'vendor',
    status: 'active',
    clauses: [emptyClause()],
  };
}

/**
 * Build a fresh CREATE-mode form state from a static playbook template
 * (WTQ-RSK-02 #7). Pure + side-effect free; mirrors the {@link playbookDefaults}
 * blank-create shape exactly (numeric clause fields rendered as strings for the
 * controlled number inputs) so a template-seeded create behaves identically to a
 * hand-keyed one. Always starts as a `draft` — a template clone is not yet an
 * approved, active standard. Falls back to a single {@link emptyClause} when the
 * template carries no clauses so the editor never renders empty.
 */
export function playbookDefaultsFromTemplate(
  template: LexPlaybookTemplate,
): PlaybookFormValues {
  return {
    name: template.name,
    description: template.description ?? '',
    contract_type: normalizeContractType(String(template.contract_type)),
    status: 'draft',
    clauses:
      template.clauses.length > 0
        ? template.clauses.map((clause) => ({
            clause_type: normalizeClauseType(String(clause.clause_type)),
            title: clause.title,
            standard_text: clause.standard_text,
            required: Boolean(clause.required),
            risk_weight: String(clause.risk_weight),
            similarity_threshold: String(clause.similarity_threshold),
          }))
        : [emptyClause()],
  };
}

export function validatePlaybookForm(
  values: PlaybookFormValues,
  errorMessages: {
    nameRequired: string;
    clauseRequired: string;
    clauseTitleRequired: (index: number) => string;
    clauseTextRequired: (index: number) => string;
    thresholdRange: (index: number) => string;
    riskWeightRange: (index: number) => string;
  },
): string[] {
  const errors: string[] = [];

  if (values.name.trim() === '') {
    errors.push(errorMessages.nameRequired);
  }

  const populatedClauses = values.clauses.filter(
    (clause) => clause.title.trim() !== '',
  );
  if (populatedClauses.length === 0) {
    errors.push(errorMessages.clauseRequired);
  }

  values.clauses.forEach((clause, index) => {
    const hasTitle = clause.title.trim() !== '';
    const hasText = clause.standard_text.trim() !== '';
    if (hasText && !hasTitle) {
      errors.push(errorMessages.clauseTitleRequired(index));
    }
    if (hasTitle && !hasText) {
      errors.push(errorMessages.clauseTextRequired(index));
    }

    if (hasTitle) {
      const threshold = Number.parseFloat(clause.similarity_threshold);
      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
        errors.push(errorMessages.thresholdRange(index));
      }
      const weight = Number.parseFloat(clause.risk_weight);
      if (!Number.isFinite(weight) || weight < 0) {
        errors.push(errorMessages.riskWeightRange(index));
      }
    }
  });

  return errors;
}

export function buildPlaybookPayload(
  values: PlaybookFormValues,
): LexCreatePlaybookPayload {
  return {
    name: values.name.trim(),
    description: values.description.trim(),
    contract_type: values.contract_type,
    status: values.status,
    clauses: buildPlaybookClauses(values.clauses),
    metadata: { source: 'watheeq_playbook_admin' },
  };
}

export function buildPlaybookClauses(
  clauses: PlaybookClauseDraft[],
): LexPlaybookClause[] {
  return clauses
    .filter((clause) => clause.title.trim() !== '')
    .map((clause) => ({
      clause_type: clause.clause_type,
      title: clause.title.trim(),
      standard_text: clause.standard_text.trim(),
      required: clause.required,
      risk_weight: parseNumber(clause.risk_weight, 1),
      similarity_threshold: clampThreshold(
        parseNumber(clause.similarity_threshold, DEFAULT_SIMILARITY_THRESHOLD),
      ),
    }));
}

export function formatToken(value: string): string {
  return value.replace(/_/g, ' ');
}

function parseNumber(value: string, fallback: number): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampThreshold(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function normalizeContractType(value: string): LexContractType {
  return (CONTRACT_TYPES as readonly string[]).includes(value)
    ? (value as LexContractType)
    : 'other';
}

function normalizeStatus(value: string): LexPlaybookStatus {
  return (PLAYBOOK_STATUSES as readonly string[]).includes(value)
    ? (value as LexPlaybookStatus)
    : 'draft';
}

function normalizeClauseType(value: string): LexClauseType {
  return (CLAUSE_TYPES as readonly string[]).includes(value)
    ? (value as LexClauseType)
    : 'other';
}
