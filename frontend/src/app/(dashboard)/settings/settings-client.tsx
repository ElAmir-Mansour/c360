"use client";

import { PageHeader } from "@/components/common/page-header";
import { ConnectedAccounts } from "@/components/auth/connected-accounts";
import { Skeleton } from "@/components/ui/skeleton";
import { ProfileForm } from "./_components/profile-form";
import { SignatureProfileSection } from "./_components/signature-profile-section";
import { PasswordChangeForm } from "./_components/password-change-form";
import { MFASection } from "./_components/mfa-section";
import { SessionsSection } from "./_components/sessions-section";
import { ApiKeysSection } from "./_components/api-keys-section";
import { useSettingsT } from "./_lib/settings-i18n";

/**
 * Interactive body of the Account Settings screen. Holds every client hook
 * (locale translator + the section forms with their own mutations/state).
 *
 * Streamed from the server `page.tsx` shell through a `<Suspense>` boundary so
 * the route can flush its static chrome + metadata first. See
 * `docs/frontend/rsc-shell-pattern.md`.
 */
export function SettingsClient() {
  const t = useSettingsT();
  return (
    <div className="w-full space-y-6">
      <PageHeader
        title={t.accountSettings}
        description={t.accountSettingsDesc}
        eyebrow={t.eyebrowAccount}
      />
      <ProfileForm />
      <SignatureProfileSection />
      <PasswordChangeForm />
      <MFASection />
      <ConnectedAccounts />
      <SessionsSection />
      <ApiKeysSection />
    </div>
  );
}

export function SettingsFallback() {
  const labels = useSettingsT();
  return (
    <div
      className="w-full space-y-6 animate-fade-in"
      role="status"
      aria-busy="true"
      aria-label={labels.loadingAccountSettings}
    >
      <div className="space-y-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton variant="form" rows={3} />
      <Skeleton variant="form" rows={2} />
      <Skeleton variant="form" rows={2} />
    </div>
  );
}
