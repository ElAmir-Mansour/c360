import { describe, expect, it } from 'vitest';
import type { User } from '@/types/models';
import { entityUserOptions } from './org-entity-user-picker';

function user(overrides: Partial<User> & Pick<User, 'id' | 'email'>): User {
  return {
    tenant_id: 'tenant-1',
    first_name: '',
    last_name: '',
    status: 'active',
    mfa_enabled: false,
    last_login_at: null,
    roles: [],
    created_at: '2026-07-13T00:00:00Z',
    updated_at: '2026-07-13T00:00:00Z',
    ...overrides,
  };
}

describe('entityUserOptions', () => {
  it('shows only active, non-excluded entity users and searches names or email', () => {
    const users = [
      user({
        id: 'active-1',
        email: 'amina@example.test',
        first_name: 'Amina',
        last_name: 'Counsel',
      }),
      user({
        id: 'active-2',
        email: 'bader@example.test',
        full_name: 'Bader Legal',
      }),
      user({
        id: 'inactive',
        email: 'inactive@example.test',
        status: 'inactive',
      }),
    ];

    expect(entityUserOptions(users, 'amina').map((option) => option.value)).toEqual(['active-1']);
    expect(entityUserOptions(users, 'example.test', ['active-1']).map((option) => option.value)).toEqual(['active-2']);
  });
});
