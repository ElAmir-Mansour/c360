'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import type { RecoverProductView } from '@/types/recover';
import {
  RECOVER_PRODUCTS_QUERY_KEY,
  fetchRecoverProducts,
} from '@/lib/recover/products';

/**
 * Live Recover product view for the current tenant.
 *
 * Entitlement is resolved server-side by the gateway/licensing engine and
 * returned per sub-solution; this hook surfaces that to client UI (sidebar
 * visibility, landing-page card state). It is gated on `dr:read` — a user
 * without DR read permission cannot reach any Recover surface, so we never fire
 * the request for them (avoids a guaranteed 401 and keeps the nav empty).
 */
export function useRecoverProducts(): UseQueryResult<RecoverProductView, Error> {
  const { hasPermission, isHydrated, isAuthenticated } = useAuth();
  const enabled = isHydrated && isAuthenticated && hasPermission('dr:read');

  return useQuery<RecoverProductView, Error>({
    queryKey: RECOVER_PRODUCTS_QUERY_KEY,
    queryFn: fetchRecoverProducts,
    enabled,
    // Entitlement changes are infrequent; cache briefly so the sidebar does not
    // refetch on every navigation but still reflects a plan change promptly.
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 1,
  });
}
