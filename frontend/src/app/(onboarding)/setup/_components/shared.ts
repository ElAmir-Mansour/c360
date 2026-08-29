'use client';

import { z } from 'zod';

export const wizardDraftKey = 'clario360:onboarding-wizard';

/**
 * Suite accent gradients that have no shared design token. Kept as a typed
 * local palette so the raw hex literals live in one place rather than being
 * scattered inline across the SUITES data. Rendered colors are unchanged.
 */
const SUITE_ACCENTS = {
  data: 'from-[#155e75] to-[#0ea5b7]',
  siem: 'from-[#991b1b] to-[#e11d48]',
  datastream: 'from-[#065f46] to-[#10b981]',
  migrate: 'from-brand-teal-700 to-brand-primary-500',
  acta: 'from-[#7c2d12] to-[#ea580c]',
  lex: 'from-[#6b21a8] to-[#9333ea]',
  visus: 'from-[#9a3412] to-[#d97706]',
} as const satisfies Record<string, string>;

export const DEFAULT_PLAN_KEY = 'trial';
export const DEFAULT_PLAN_SEATS = 5;
export const DEFAULT_SUITE_SELECTION = ['cyber', 'data', 'visus'] as const;

export const organizationSchema = z.object({
  organization_name: z.string().min(2).max(100),
  industry: z.string().min(1),
  country: z.string().length(2),
  city: z.string().max(120).optional().or(z.literal('')),
  organization_size: z.string().min(1),
});

export const brandingSchema = z.object({
  primary_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  accent_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});

export type OrganizationFormValues = z.infer<typeof organizationSchema>;
export type BrandingFormValues = z.infer<typeof brandingSchema>;

export type WizardProgress = {
  tenant_id: string;
  current_step: number;
  steps_completed: number[];
  wizard_completed: boolean;
  email_verified: boolean;
  organization_name?: string | null;
  industry?: string | null;
  country: string;
  city?: string | null;
  organization_size?: string | null;
  logo_file_id?: string | null;
  primary_color?: string | null;
  accent_color?: string | null;
  active_suites: string[];
  plan_key?: string | null;
  seats?: number | null;
  provisioning_status: 'pending' | 'provisioning' | 'completed' | 'failed';
  provisioning_error?: string | null;
};

export type OnboardingProduct = {
  id: string;
  name: string;
  description: string;
  entitlement_key?: string;
};

export type SuiteDefinition = {
  id: string;
  title: string;
  description: string;
  accent: string;
  entitlement_key?: string;
};

export type OnboardingPlan = {
  key: string;
  name: string;
  description?: string;
  self_serve?: boolean;
  default?: boolean;
  seat_limit: number;
  trial_days?: number;
  grace_days?: number;
  included_suites?: string[];
  entitlement_keys?: string[];
};

export type OnboardingPlanCatalog = {
  plans: OnboardingPlan[];
  products?: OnboardingProduct[];
  default_plan_key?: string;
  default_seats?: number;
};

export type ProvisioningStep = {
  step_number: number;
  step_name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  error_message?: string | null;
};

export type ProvisioningStatus = {
  tenant_id: string;
  status: 'pending' | 'provisioning' | 'completed' | 'failed';
  error?: string | null;
  progress_pct: number;
  completed_steps: number;
  total_steps: number;
  steps: ProvisioningStep[];
};

export type RoleRecord = {
  id: string;
  name: string;
  slug: string;
};

export type InvitationDraft = {
  email: string;
  role_slug: string;
  message?: string;
};

export type WizardDraft = {
  organization?: OrganizationFormValues;
  branding?: BrandingFormValues;
  team?: InvitationDraft[];
  suites?: string[];
  plan_key?: string;
  seats?: number;
};

export const INDUSTRIES = [
  { value: 'financial', label: 'Financial Services' },
  { value: 'government', label: 'Government' },
  { value: 'healthcare', label: 'Healthcare' },
  { value: 'technology', label: 'Technology' },
  { value: 'energy', label: 'Energy' },
  { value: 'telecom', label: 'Telecom' },
  { value: 'education', label: 'Education' },
  { value: 'retail', label: 'Retail' },
  { value: 'manufacturing', label: 'Manufacturing' },
  { value: 'other', label: 'Other' },
] as const;

export const ORG_SIZES = [
  { value: '1-50', label: '1-50' },
  { value: '51-200', label: '51-200' },
  { value: '201-1000', label: '201-1000' },
  { value: '1000+', label: '1000+' },
] as const;

export const SUITES = [
  {
    id: 'cyber',
    title: 'Cybersecurity',
    description: 'Threat detection, asset management, SOC dashboards',
    accent: 'from-brand-primary-600 to-brand-bright',
  },
  {
    id: 'data',
    title: 'Data Intelligence',
    description: 'Data quality, pipeline orchestration, contradiction detection',
    accent: SUITE_ACCENTS.data,
  },
  {
    id: 'siem',
    title: 'SIEM',
    description: 'Security event collection, correlation, detection, and response',
    accent: SUITE_ACCENTS.siem,
  },
  {
    id: 'datastream',
    title: 'DataStream',
    description: 'Resilience, migration, synchronization, and data warehouse operations',
    accent: SUITE_ACCENTS.datastream,
  },
  {
    id: 'migrate',
    title: 'Cloud Migration',
    description: 'Portfolio assessment, move groups, waves, cutover governance, and migration evidence',
    accent: SUITE_ACCENTS.migrate,
  },
  {
    id: 'acta',
    title: 'Board Governance',
    description: 'Meeting automation, minutes, compliance tracking',
    accent: SUITE_ACCENTS.acta,
  },
  {
    id: 'lex',
    title: 'Legal Operations',
    description: 'Contract management, clause analysis, expiry monitoring',
    accent: SUITE_ACCENTS.lex,
  },
  {
    id: 'visus',
    title: 'Executive Intelligence',
    description: 'Cross-suite dashboards, KPIs, executive reports',
    accent: SUITE_ACCENTS.visus,
  },
] as const satisfies readonly SuiteDefinition[];

export const DEFAULT_ONBOARDING_PLAN_CATALOG: OnboardingPlanCatalog = {
  plans: [
    {
      key: DEFAULT_PLAN_KEY,
      name: 'Trial',
      description: '14-day self-serve trial with selected products and up to 5 users.',
      self_serve: true,
      default: true,
      seat_limit: DEFAULT_PLAN_SEATS,
      trial_days: 14,
      grace_days: 7,
      included_suites: SUITES.map((suite) => suite.id),
      entitlement_keys: [],
    },
  ],
  products: SUITES.map((suite) => ({
    id: suite.id,
    name: suite.title,
    description: suite.description,
  })),
  default_plan_key: DEFAULT_PLAN_KEY,
  default_seats: DEFAULT_PLAN_SEATS,
};

export const COUNTRY_OPTIONS = ['SA', 'AE', 'US', 'GB', 'NG', 'ZA', 'EG', 'KE', 'DE', 'FR'];

export function loadDraft(): WizardDraft {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const stored = window.localStorage.getItem(wizardDraftKey);
    return stored ? (JSON.parse(stored) as WizardDraft) : {};
  } catch {
    return {};
  }
}

export function saveDraft(nextDraft: WizardDraft): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.setItem(wizardDraftKey, JSON.stringify(nextDraft));
}

export function clearDraft(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.localStorage.removeItem(wizardDraftKey);
}
