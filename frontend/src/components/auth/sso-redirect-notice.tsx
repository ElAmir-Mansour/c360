'use client';

import { ShieldCheck } from 'lucide-react';
import { useSearchParams } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { buildOAuthState, withOAuthState } from '@/lib/oauth-state';
import { useT } from '@/components/providers/locale-provider';
import type { SsoDiscovery } from '@/hooks/use-sso-discovery';

interface SsoRedirectNoticeProps {
  /**
   * The discovered enterprise SSO provider. When null/undefined the component
   * renders nothing — so callers can pass `useSsoDiscovery().discovery` directly
   * and the CTA appears/disappears as the email domain resolves.
   */
  discovery: SsoDiscovery | null | undefined;
  className?: string;
}

/**
 * Tiny presentational helper for SSO discovery (capability #7).
 *
 * Given a discovered provider, shows a "Your organization uses {provider} —
 * continue with SSO" CTA styled to match the OAuthProviders buttons. Clicking
 * it navigates to the provider's authorize URL (full-page redirect, as OAuth
 * sign-in does). Purely presentational: it does no fetching itself — pass it the
 * `discovery` value from `useSsoDiscovery()`.
 */
export function SsoRedirectNotice({ discovery, className }: SsoRedirectNoticeProps) {
  const t = useT();
  const searchParams = useSearchParams();
  if (!discovery) return null;

  const { provider, authorizeUrl } = discovery;
  const providerLabel = formatProviderLabel(provider);

  const handleContinue = () => {
    // Thread the same `state` the OAuth buttons send (sanitized post-login
    // target + trusted-device id) so SSO logins honor deep links and device
    // trust instead of dropping them at the provider hop. Discovered
    // enterprise authorize URLs that ALREADY carry a server-persisted `state`
    // pass through withOAuthState untouched — the server's CSRF state must
    // win, and a duplicate param risks IdP rejection.
    const rawRedirect =
      searchParams?.get('redirect') ?? searchParams?.get('return_to') ?? '/dashboard';
    window.location.href = withOAuthState(
      authorizeUrl,
      buildOAuthState(provider, rawRedirect),
    );
  };

  return (
    <div
      className={cn(
        'rounded-xl border border-primary/20 bg-primary/[0.05] p-3.5 shadow-sm',
        className,
      )}
    >
      <p className="text-[13px] leading-5 text-foreground/70">
        {t('auth.oauth.orgUsesPrefix')}{' '}
        <span className="font-semibold text-primary">{providerLabel}</span>{' '}
        {t('auth.oauth.orgUsesSuffix')}
      </p>
      <Button
        type="button"
        variant="outline"
        onClick={handleContinue}
        className="group mt-3 h-10 w-full justify-start rounded-xl border-primary/20 bg-card px-3 text-[13px] text-foreground shadow-sm transition-all hover:border-primary/40 hover:bg-primary/[0.05] hover:text-primary"
      >
        <span className="me-2.5 flex h-6 w-6 items-center justify-center rounded-md bg-secondary text-foreground/70 transition-colors group-hover:bg-card group-hover:text-primary">
          <ShieldCheck className="h-3.5 w-3.5" />
        </span>
        <span className="font-medium">{t('auth.oauth.continueWith').replace('{provider}', providerLabel)}</span>
      </Button>
    </div>
  );
}

/**
 * Best-effort humanizing of a raw provider identifier (e.g. "okta" -> "Okta",
 * "azure-ad" -> "Azure AD", "ping_federate" -> "Ping Federate"). Unknown values
 * fall back to title-casing so the CTA always reads sensibly.
 */
function formatProviderLabel(provider: string): string {
  const known: Record<string, string> = {
    okta: 'Okta',
    'azure-ad': 'Azure AD',
    azuread: 'Azure AD',
    entra: 'Microsoft Entra ID',
    onelogin: 'OneLogin',
    pingfederate: 'PingFederate',
    pingidentity: 'Ping Identity',
    auth0: 'Auth0',
    saml: 'SAML SSO',
    oidc: 'OIDC SSO',
    google: 'Google Workspace',
    jumpcloud: 'JumpCloud',
  };
  const key = provider.trim().toLowerCase();
  if (known[key]) return known[key];

  return key
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
