import { apiPost } from '@/lib/api';
import { API_ENDPOINTS, ROUTES } from '@/lib/constants';
import type { ApiError } from '@/types/api';
import type { User } from '@/types/models';

type VerificationUser = Pick<User, 'email' | 'tenant_id' | 'status' | 'email_verified'>;

export interface EmailVerificationTarget {
  email: string;
  tenantId?: string | null;
}

export function needsEmailVerification(user: VerificationUser | null | undefined): boolean {
  if (!user) return false;
  return user.email_verified === false || user.status === 'pending_verification';
}

export function getEmailVerificationUrl(target: EmailVerificationTarget): string {
  const params = new URLSearchParams();
  if (target.email) params.set('email', target.email);
  if (target.tenantId) {
    params.set('tenant_id', target.tenantId);
    params.set('tenantId', target.tenantId);
  }
  const query = params.toString();
  return query ? `${ROUTES.VERIFY_EMAIL}?${query}` : ROUTES.VERIFY_EMAIL;
}

export async function requestEmailVerificationCode(
  target: EmailVerificationTarget,
): Promise<void> {
  await apiPost(API_ENDPOINTS.ONBOARDING_RESEND_OTP, {
    email: target.email,
  });
}

export function isPendingEmailVerificationError(error: ApiError): boolean {
  const code = error.code.toLowerCase();
  const message = error.message.toLowerCase();
  return (
    code.includes('pending_verification') ||
    code.includes('email_verification') ||
    code.includes('email_not_verified') ||
    message.includes('pending_verification') ||
    message.includes('email verification') ||
    message.includes('email not verified') ||
    message.includes('verify your email')
  );
}
