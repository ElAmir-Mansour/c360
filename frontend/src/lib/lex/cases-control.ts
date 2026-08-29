/**
 * Typed client for the Case & Investigation Control Panel.
 *
 * The backend assembles this consolidated read model and authorizes it with BOTH
 * `lex:case:view` and `lex:investigation:view`. Keeping its summary DTOs here
 * prevents dashboard consumers from pretending the rows are full case or
 * investigation aggregates.
 */

import { fetchSuiteData } from '@/lib/suite-api';
import type { components } from '@/types/watheeq-api.generated';

const CASES_CONTROL_ENDPOINT = '/api/v1/lex/dashboard/cases-control';

export type CasesControlCountBucket =
  components['schemas']['CaseControlCountBucket'];
export type CasesControlRecentCase =
  components['schemas']['CaseControlRecentCase'];
export type CasesControlActiveInvestigation =
  components['schemas']['CaseControlActiveInvestigation'];
export type CasesControlRecentInvestigation =
  components['schemas']['CaseControlRecentInvestigation'];
export type CasesControlDashboard =
  components['schemas']['CaseControlDashboard'];

export const casesControlApi = {
  getDashboard: (): Promise<CasesControlDashboard> =>
    fetchSuiteData<CasesControlDashboard>(CASES_CONTROL_ENDPOINT),
};
