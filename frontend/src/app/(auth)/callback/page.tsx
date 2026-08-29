"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, ShieldCheck, Workflow, Zap } from "lucide-react";

import {
  AuthActionStrip,
  AuthInsightGrid,
  AuthLoadingState,
  AuthPageIntro,
  type AuthInsightItem,
} from "@/components/auth/auth-page-primitives";
import { Alert, AlertDescription } from "@/components/ui/alert";
import api from "@/lib/api";
import { setAccessToken } from "@/lib/auth";
import { ROUTES } from "@/lib/constants";
import { safeRedirect } from "@/lib/safe-redirect";
import { useT } from "@/components/providers/locale-provider";

export default function OAuthCallbackPage() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  const callbackInsights: AuthInsightItem[] = [
    {
      icon: ShieldCheck,
      label: t("auth.callback.insightExchangeLabel"),
      value: t("auth.callback.insightExchangeValue"),
      detail: t("auth.callback.insightExchangeDetail"),
    },
    {
      icon: Zap,
      label: t("auth.callback.insightHandoffLabel"),
      value: t("auth.callback.insightHandoffValue"),
      detail: t("auth.callback.insightHandoffDetail"),
    },
    {
      icon: Workflow,
      label: t("auth.callback.insightFailureLabel"),
      value: t("auth.callback.insightFailureValue"),
      detail: t("auth.callback.insightFailureDetail"),
    },
  ];

  useEffect(() => {
    const code = searchParams?.get("code");
    const state = searchParams?.get("state");
    const errorParam = searchParams?.get("error");
    const errorDescription = searchParams?.get("error_description");

    if (errorParam) {
      setError(errorDescription ?? errorParam);
      return;
    }

    if (!code || !state) {
      setError(t("auth.callback.missingParams"));
      return;
    }

    let cancelled = false;

    async function handleCallback() {
      try {
        const stateData = JSON.parse(atob(state as string));
        const provider = stateData.provider ?? "unknown";

        const { data } = await api.get<{ access_token: string; redirect_to?: string }>(
          `/api/v1/auth/oauth/${provider}/callback`,
          { params: { code, state } },
        );

        if (!cancelled) {
          if (data.access_token) {
            setAccessToken(data.access_token);
          }
          // (#9) Never navigate to an attacker-controlled target embedded in the
          // OAuth state. Only same-origin relative paths survive safeRedirect();
          // anything else falls back to the dashboard.
          router.push(safeRedirect(stateData.redirect_to, ROUTES.DASHBOARD));
        }
      } catch {
        if (!cancelled) {
          setError(t("auth.callback.authFailed"));
        }
      }
    }

    void handleCallback();

    return () => {
      cancelled = true;
    };
  }, [searchParams, router]);

  if (error) {
    return (
      <div className="space-y-8">
        <AuthPageIntro
          badge={t("auth.callback.errorBadge")}
          badgeIcon={AlertCircle}
          title={t("auth.callback.errorTitle")}
          description={t("auth.callback.errorDescription")}
          statusLabel={t("auth.callback.errorStatusLabel")}
          statusValue={t("auth.callback.errorStatusValue")}
        />

        <AuthInsightGrid items={callbackInsights} />

        <Alert
          variant="destructive"
          className="border-error-100 bg-error-50 text-error-700 [&>svg]:text-error-500"
        >
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>

        <AuthActionStrip
          description={t("auth.callback.errorActionDescription")}
          href={ROUTES.LOGIN}
          cta={t("auth.callback.backToLogin")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <AuthPageIntro
        badge={t("auth.callback.progressBadge")}
        badgeIcon={ShieldCheck}
        title={t("auth.callback.progressTitle")}
        description={t("auth.callback.progressDescription")}
        statusLabel={t("auth.callback.progressStatusLabel")}
        statusValue={t("auth.callback.progressStatusValue")}
      />

      <AuthInsightGrid items={callbackInsights} />

      <AuthLoadingState
        label={t("auth.callback.progressLoadingLabel")}
        detail={t("auth.callback.progressLoadingDetail")}
      />

      <div className="text-center">
        <Link
          href={ROUTES.LOGIN}
          className="text-sm font-medium text-foreground/55 hover:text-foreground hover:underline"
        >
          {t("auth.callback.returnToLogin")}
        </Link>
      </div>
    </div>
  );
}
