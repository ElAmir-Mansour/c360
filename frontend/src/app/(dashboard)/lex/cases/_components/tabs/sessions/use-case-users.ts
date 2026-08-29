'use client';

/**
 * Tenant user directory for resolving attendee / actor user-ids to display
 * names. Fetches the active-user list once (cached 5 min) and exposes an
 * id → name resolver, mirroring the established Tasks-tab pattern.
 */

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { enterpriseApi, userDisplayName } from '@/lib/enterprise';
import type { UserDirectoryEntry } from '@/types/suites';

export function useCaseUsers() {
  const query = useQuery({
    queryKey: ['tenant-users-directory'],
    queryFn: () => enterpriseApi.users.list({ page: 1, per_page: 200 }),
    staleTime: 5 * 60_000,
  });

  const users: UserDirectoryEntry[] = useMemo(() => query.data?.data ?? [], [query.data]);
  const byId = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const nameOf = useCallback(
    (id: string): string => {
      const user = byId.get(id);
      return user ? userDisplayName(user) : id;
    },
    [byId],
  );

  const initialsOf = useCallback(
    (id: string): string => {
      const user = byId.get(id);
      if (!user) return '#';
      const a = user.first_name?.trim()?.[0] ?? '';
      const b = user.last_name?.trim()?.[0] ?? '';
      return (a + b).toUpperCase() || user.email.charAt(0).toUpperCase() || '#';
    },
    [byId],
  );

  return { users, byId, nameOf, initialsOf, loading: query.isLoading };
}
