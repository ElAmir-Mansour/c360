"use client";

import { useState } from "react";
import { Link2, Unlink, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { RelativeTime } from "@/components/shared/relative-time";
import {
  useOAuthProviders,
  useOAuthConnections,
  useUnlinkOAuth,
  getOAuthAuthorizeUrl,
} from "@/hooks/use-oauth";
import { useT } from "@/components/providers/locale-provider";
import type { OAuthConnection } from "@/types/oauth";

const PROVIDER_LABELS: Record<string, string> = {
  google: "Google",
  github: "GitHub",
  microsoft: "Microsoft",
  saml: "SAML SSO",
};

export function ConnectedAccounts() {
  const t = useT();
  const { data: providers, isLoading: providersLoading } = useOAuthProviders();
  const { data: connections, isLoading: connectionsLoading } = useOAuthConnections();
  const unlinkMutation = useUnlinkOAuth();
  const [unlinkProvider, setUnlinkProvider] = useState<OAuthConnection | null>(null);

  const isLoading = providersLoading || connectionsLoading;
  const enabledProviders = providers?.filter((p) => p.enabled) ?? [];
  const connectedProviders = new Set(connections?.map((c) => c.provider) ?? []);

  const handleConnect = (provider: string) => {
    const state = btoa(JSON.stringify({ provider, redirect_to: "/settings", action: "link" }));
    const url = `${getOAuthAuthorizeUrl(provider)}?state=${state}&action=link`;
    window.location.href = url;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Link2 className="h-5 w-5" />
          {t('auth.connected.title')}
        </CardTitle>
        <CardDescription>
          {t('auth.connected.description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {isLoading ? (
            Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-14 rounded" />
            ))
          ) : enabledProviders.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('auth.connected.noProviders')}
            </p>
          ) : (
            enabledProviders.map((provider) => {
              const connection = connections?.find((c) => c.provider === provider.provider);
              const isConnected = !!connection;

              return (
                <div
                  key={provider.provider}
                  className="flex items-center justify-between gap-4 rounded-lg border border-border p-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted">
                      <span className="text-xs font-bold uppercase">
                        {provider.provider.slice(0, 2)}
                      </span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">
                          {PROVIDER_LABELS[provider.provider] ?? provider.display_name}
                        </p>
                        {isConnected && (
                          <Badge variant="outline" className="text-xs">
                            {t('auth.connected.connected')}
                          </Badge>
                        )}
                      </div>
                      {connection && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {connection.provider_email}
                          {connection.last_login_at && (
                            <>
                              {t('auth.connected.lastUsed')}
                              <RelativeTime date={connection.last_login_at} />
                            </>
                          )}
                        </p>
                      )}
                    </div>
                  </div>

                  {isConnected ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setUnlinkProvider(connection)}
                    >
                      <Unlink className="me-1 h-3 w-3" />
                      {t('auth.connected.unlink')}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleConnect(provider.provider)}
                    >
                      <ExternalLink className="me-1 h-3 w-3" />
                      {t('auth.connected.connect')}
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </CardContent>

      {unlinkProvider && (
        <ConfirmDialog
          open={!!unlinkProvider}
          onOpenChange={(o) => !o && setUnlinkProvider(null)}
          title={t('auth.connected.unlinkTitle')}
          description={`${t('auth.connected.unlinkDescPrefix')} ${PROVIDER_LABELS[unlinkProvider.provider] ?? unlinkProvider.provider} (${unlinkProvider.provider_email})${t('auth.connected.unlinkDescSuffix')}`}
          confirmLabel={t('auth.connected.unlinkConfirmLabel')}
          variant="destructive"
          loading={unlinkMutation.isPending}
          onConfirm={async () => {
            await unlinkMutation.mutateAsync(unlinkProvider.provider);
          }}
        />
      )}
    </Card>
  );
}
