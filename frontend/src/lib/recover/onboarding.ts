import { apiDelete, apiPost } from '@/lib/api';
import { unwrapRecoverEnvelope } from '@/lib/recover/envelope';
import type {
  RecoverOnboardResult,
  RecoverRemoveDemoResult,
  RecoverSubSolutionSlug,
} from '@/types/recover';

/** Endpoints for the Recover onboarding surface (Prompt 9). */
export const RECOVER_ONBOARDING_ACTIVATE_ENDPOINT = '/api/recover/onboarding/activate';
export const RECOVER_ONBOARDING_DEMO_DATA_ENDPOINT = '/api/recover/onboarding/demo-data';

/**
 * Activates the selected Recover sub-solutions for the tenant and seeds demo
 * content for each (the backend writes the activation via the Prompt 1 model and
 * seeds real applications + runbooks). Returns the per-sub-solution seed result;
 * the endpoint wraps it in a suiteapi `{ data }` envelope which apiPost does NOT
 * strip, so we unwrap it here.
 *
 * Requires `dr:admin`; the backend enforces it server-side.
 */
export async function activateRecoverSubSolutions(
  subSolutions: RecoverSubSolutionSlug[],
): Promise<RecoverOnboardResult> {
  return unwrapRecoverEnvelope<RecoverOnboardResult>(
    await apiPost<unknown>(RECOVER_ONBOARDING_ACTIVATE_ENDPOINT, {
      sub_solutions: subSolutions,
    }),
  );
}

/**
 * Removes ALL demo content the onboarding flow seeded for the tenant. Idempotent:
 * a tenant with no demo content yields a zero result. Requires `dr:admin`.
 */
export async function removeRecoverDemoData(): Promise<RecoverRemoveDemoResult> {
  return unwrapRecoverEnvelope<RecoverRemoveDemoResult>(
    await apiDelete<unknown>(RECOVER_ONBOARDING_DEMO_DATA_ENDPOINT),
  );
}
