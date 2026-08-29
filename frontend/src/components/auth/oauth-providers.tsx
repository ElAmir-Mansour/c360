"use client";

import { useSearchParams } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { useOAuthProviders, getOAuthAuthorizeUrl } from "@/hooks/use-oauth";
import { buildOAuthState, withOAuthState } from "@/lib/oauth-state";
import { safeRedirect } from "@/lib/safe-redirect";
import { cn } from "@/lib/utils";
import { useT } from "@/components/providers/locale-provider";

interface OAuthProvidersProps {
  className?: string;
}

/** Vendor brand colors for provider glyphs (fixed by each vendor's brand guide). */
const BRAND_COLORS: {
  googleBlue: string;
  googleGreen: string;
  googleYellow: string;
  googleRed: string;
  msRed: string;
  msBlue: string;
  msGreen: string;
  msYellow: string;
} = {
  googleBlue: '#4285F4',
  googleGreen: '#34A853',
  googleYellow: '#FBBC05',
  googleRed: '#EA4335',
  msRed: '#F25022',
  msBlue: '#00A4EF',
  msGreen: '#7FBA00',
  msYellow: '#FFB900',
};

const PROVIDER_ICONS: Record<string, React.FC<{ className?: string }>> = {
  google: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill={BRAND_COLORS.googleBlue}/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill={BRAND_COLORS.googleGreen}/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill={BRAND_COLORS.googleYellow}/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill={BRAND_COLORS.googleRed}/>
    </svg>
  ),
  github: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844a9.59 9.59 0 0 1 2.504.337c1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2z"/>
    </svg>
  ),
  microsoft: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path fill={BRAND_COLORS.msRed} d="M1 1h10v10H1z"/>
      <path fill={BRAND_COLORS.msBlue} d="M1 13h10v10H1z"/>
      <path fill={BRAND_COLORS.msGreen} d="M13 1h10v10H13z"/>
      <path fill={BRAND_COLORS.msYellow} d="M13 13h10v10H13z"/>
    </svg>
  ),
  saml: ({ className }) => (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 1a5 5 0 0 1 5 5v2a5 5 0 0 1-10 0V6a5 5 0 0 1 5-5zM7 6v2a5 5 0 0 0 10 0V6a5 5 0 0 0-10 0zm-3 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v5a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-5zm3 0v5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-5H7z"/>
    </svg>
  ),
};

export function OAuthProviders({ className }: OAuthProvidersProps) {
  const t = useT();
  const { data: providers, isLoading } = useOAuthProviders();
  const searchParams = useSearchParams();

  // (#9) Honor the real post-login target the same way login-form.tsx does,
  // instead of hardcoding "/dashboard". The chosen target is threaded into the
  // OAuth `state` so the callback can route the user back where they intended.
  // The raw query value is attacker-controllable, so it is sanitized through
  // safeRedirect() before being embedded in the state — only same-origin
  // relative paths survive; anything else falls back to the dashboard.
  const rawRedirect =
    searchParams?.get("redirect") ?? searchParams?.get("return_to") ?? "/dashboard";
  const redirectTo = safeRedirect(rawRedirect, "/dashboard");

  const enabledProviders = providers?.filter((p) => p.enabled) ?? [];

  if (isLoading) {
    return (
      <div className={cn("flex justify-center py-4", className)}>
        <Spinner size="sm" />
      </div>
    );
  }

  if (enabledProviders.length === 0) {
    return null;
  }

  const handleOAuthLogin = (provider: string) => {
    // (#12) The shared state payload carries the trusted-device id (omitted on
    // SSR / storage-blocked) and the sanitized post-login target.
    const state = buildOAuthState(provider, redirectTo);
    window.location.href = withOAuthState(getOAuthAuthorizeUrl(provider), state);
  };

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-primary/15" />
        <span className="text-overline font-semibold uppercase tracking-caps-xwide text-primary/65">
          {t('auth.oauth.orContinueWith')}
        </span>
        <span className="h-px flex-1 bg-primary/15" />
      </div>

      <div className={cn("grid gap-2", enabledProviders.length > 1 && "sm:grid-cols-2")}>
        {enabledProviders.map((provider) => {
          const Icon = PROVIDER_ICONS[provider.provider];
          return (
            <Button
              key={provider.provider}
              variant="outline"
              type="button"
              className="group h-10 w-full justify-start rounded-2xl border-primary/20 bg-white/[0.035] px-3 text-[13px] text-foreground shadow-sm transition-all hover:border-primary/40 hover:bg-primary/[0.08] hover:text-primary"
              onClick={() => handleOAuthLogin(provider.provider)}
            >
              {Icon ? (
                <span className="me-2.5 flex h-6 w-6 items-center justify-center rounded-lg bg-primary/12 text-foreground/70 transition-colors group-hover:bg-primary/15 group-hover:text-primary">
                  <Icon className="h-3.5 w-3.5" />
                </span>
              ) : null}
              <span className="font-medium">{provider.display_name}</span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
