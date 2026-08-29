'use client';

import { useAuthStore } from '@/stores/auth-store';
import type { SuiteName } from '@/types/models';

/**
 * Typed hook wrapping the auth store.
 * Provides stable references and convenient permission helpers.
 */
export function useAuth() {
  const user = useAuthStore((s) => s.user);
  const tenant = useAuthStore((s) => s.tenant);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const error = useAuthStore((s) => s.error);
  const sessionExpired = useAuthStore((s) => s.sessionExpired);
  const permissionsVersion = useAuthStore((s) => s.permissionsVersion);
  const lastSignIn = useAuthStore((s) => s.lastSignIn);

  const login = useAuthStore((s) => s.login);
  const loginWithPasskey = useAuthStore((s) => s.loginWithPasskey);
  const verifyMFA = useAuthStore((s) => s.verifyMFA);
  const logout = useAuthStore((s) => s.logout);
  const refreshSession = useAuthStore((s) => s.refreshSession);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const updateAvatar = useAuthStore((s) => s.updateAvatar);
  const removeAvatar = useAuthStore((s) => s.removeAvatar);
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const hasAnyPermission = useAuthStore((s) => s.hasAnyPermission);
  const hasAllPermissions = useAuthStore((s) => s.hasAllPermissions);
  const hasSuiteAccess = useAuthStore((s) => s.hasSuiteAccess);
  const clearError = useAuthStore((s) => s.clearError);
  const setSessionExpired = useAuthStore((s) => s.setSessionExpired);

  return {
    user,
    tenant,
    isAuthenticated,
    isLoading,
    isHydrated,
    error,
    sessionExpired,
    permissionsVersion,
    lastSignIn,
    login,
    loginWithPasskey,
    verifyMFA,
    logout,
    refreshSession,
    updateProfile,
    updateAvatar,
    removeAvatar,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    hasSuiteAccess,
    clearError,
    setSessionExpired,
  };
}
