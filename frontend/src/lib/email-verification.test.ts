import { describe, expect, it } from 'vitest';

import {
  getEmailVerificationUrl,
  isPendingEmailVerificationError,
  needsEmailVerification,
} from './email-verification';
import type { ApiError } from '@/types/api';
import type { User } from '@/types/models';

function user(overrides: Partial<User>): User {
  return {
    id: 'user-1',
    tenant_id: 'tenant-1',
    email: 'person@example.com',
    first_name: 'Person',
    last_name: 'Example',
    status: 'active',
    mfa_enabled: false,
    last_login_at: null,
    roles: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('email verification helpers', () => {
  it('flags users with explicit unverified email', () => {
    expect(needsEmailVerification(user({ email_verified: false }))).toBe(true);
  });

  it('flags users in pending verification status', () => {
    expect(needsEmailVerification(user({ status: 'pending_verification' }))).toBe(true);
  });

  it('does not flag active users unless the backend says email is unverified', () => {
    expect(needsEmailVerification(user({ email_verified: true }))).toBe(false);
    expect(needsEmailVerification(user({}))).toBe(false);
  });

  it('builds a verification URL with email and tenant context', () => {
    expect(
      getEmailVerificationUrl({ email: 'person@example.com', tenantId: 'tenant-1' }),
    ).toBe('/verify?email=person%40example.com&tenant_id=tenant-1&tenantId=tenant-1');
  });

  it('detects partial-rollout pending verification API errors', () => {
    const error: ApiError = {
      status: 403,
      code: 'PENDING_VERIFICATION',
      message: 'pending_verification',
    };

    expect(isPendingEmailVerificationError(error)).toBe(true);
  });
});
