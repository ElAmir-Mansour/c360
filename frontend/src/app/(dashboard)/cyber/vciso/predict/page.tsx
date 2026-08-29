'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BrainCircuit, Loader2, RefreshCw, ShieldAlert, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';

import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';
import { ErrorState } from '@/components/common/error-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { apiGet, apiPost } from '@/lib/api';
import { API_ENDPOINTS } from '@/lib/constants';
import { parseApiError } from '@/lib/format';
import { prettyJson, readNumber, readString } from '@/lib/response-shape';
import { useVcisoChatLabels } from '../_lib/vciso-i18n';

type PredictionResponse = Record<string, unknown> & {
  prediction_type?: string;
  model_version?: string;
  generated_at?: string;
  confidence_score?: number;
  explanation_text?: string;
  items?: unknown[];
};

type AccuracyResponse = {
  generated_at: string;
  dashboard: Record<string, unknown>;
};

const MODEL_TYPES = [
  'alert_volume_forecast',
  'asset_risk_prediction',
  'vulnerability_exploit_prediction',
  'attack_technique_trend',
  'insider_threat_trajectory',
  'campaign_detection',
];

export default function VCISOPredictPage() {
  const t = useVcisoChatLabels().predict;
  const queryClient = useQueryClient();

  const forecastQuery = useQuery({
    queryKey: ['vciso-predict-forecast'],
    queryFn: () => apiGet<PredictionResponse>(API_ENDPOINTS.CYBER_VCISO_PREDICT_FORECAST, { forecast_type: 'alert_volume', time_horizon: '30' }),
  });
  const assetQuery = useQuery({
    queryKey: ['vciso-predict-assets'],
    queryFn: () => apiGet<PredictionResponse>(API_ENDPOINTS.CYBER_VCISO_PREDICT_ASSETS, { limit: 10 }),
  });
  const vulnerabilityQuery = useQuery({
    queryKey: ['vciso-predict-vulnerabilities'],
    queryFn: () => apiGet<PredictionResponse>(API_ENDPOINTS.CYBER_VCISO_PREDICT_VULNERABILITIES, { limit: 10, min_probability: 0.5 }),
  });
  const techniqueQuery = useQuery({
    queryKey: ['vciso-predict-techniques'],
    queryFn: () => apiGet<PredictionResponse>(API_ENDPOINTS.CYBER_VCISO_PREDICT_TECHNIQUES, { time_horizon: '30' }),
  });
  const insiderQuery = useQuery({
    queryKey: ['vciso-predict-insider-threats'],
    queryFn: () => apiGet<PredictionResponse>(API_ENDPOINTS.CYBER_VCISO_PREDICT_INSIDER_THREATS, { time_horizon: '30', threshold: 70 }),
  });
  const campaignQuery = useQuery({
    queryKey: ['vciso-predict-campaigns'],
    queryFn: () => apiGet<PredictionResponse>(API_ENDPOINTS.CYBER_VCISO_PREDICT_CAMPAIGNS, { time_horizon: '30' }),
  });
  const accuracyQuery = useQuery({
    queryKey: ['vciso-predict-accuracy'],
    queryFn: () => apiGet<AccuracyResponse>(API_ENDPOINTS.CYBER_VCISO_PREDICT_ACCURACY),
  });

  const retrainMutation = useMutation({
    mutationFn: (modelType: string) => apiPost(API_ENDPOINTS.CYBER_VCISO_PREDICT_RETRAIN(modelType), {}),
    onSuccess: (_, modelType) => {
      toast.success(t.retrainQueued(modelType.replace(/_/g, ' ')));
      void queryClient.invalidateQueries({ queryKey: ['vciso-predict-accuracy'] });
    },
    onError: (error) => toast.error(parseApiError(error)),
  });

  const panels = [
    { title: t.forecastTitle, description: t.forecastDesc, query: forecastQuery },
    { title: t.assetTitle, description: t.assetDesc, query: assetQuery },
    { title: t.vulnTitle, description: t.vulnDesc, query: vulnerabilityQuery },
    { title: t.techTitle, description: t.techDesc, query: techniqueQuery },
    { title: t.insiderTitle, description: t.insiderDesc, query: insiderQuery },
    { title: t.campaignTitle, description: t.campaignDesc, query: campaignQuery },
  ];

  const loadedPanels = panels.filter((panel) => panel.query.data).length;
  const averageConfidence = panels.reduce((sum, panel) => sum + readNumber(panel.query.data?.confidence_score, 0), 0) / Math.max(loadedPanels, 1);

  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-6">
        <PageHeader
          eyebrow={t.eyebrow}
          title={t.title}
          description={t.description}
        />

        <div className="grid gap-4 md:grid-cols-4">
          <MetricCard title={t.predictionModels} value={String(panels.length)} detail={t.loadedSuffix(loadedPanels)} />
          <MetricCard title={t.averageConfidence} value={`${Math.round(averageConfidence * 100)}%`} detail={t.acrossLoaded} />
          <MetricCard title={t.accuracyDashboard} value={accuracyQuery.data ? t.ready : t.loading} detail={accuracyQuery.data?.generated_at ? new Date(accuracyQuery.data.generated_at).toLocaleString() : t.awaitingTelemetry} />
          <MetricCard title={t.retrainControls} value={String(MODEL_TYPES.length)} detail={t.manualAdminTrigger} />
        </div>

        <div className="grid gap-4 xl:grid-cols-[1fr_0.85fr]">
          <div className="grid gap-4 lg:grid-cols-2">
            {panels.map((panel) => (
              <PredictionPanel
                key={panel.title}
                title={panel.title}
                description={panel.description}
                data={panel.query.data}
                error={panel.query.error}
                isLoading={panel.query.isLoading}
                onRetry={() => void panel.query.refetch()}
              />
            ))}
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BrainCircuit className="h-4 w-4" />
                  {t.accuracyTitle}
                </CardTitle>
                <CardDescription>{t.accuracyDesc}</CardDescription>
              </CardHeader>
              <CardContent>
                {accuracyQuery.error ? (
                  <ErrorState error={accuracyQuery.error} onRetry={() => void accuracyQuery.refetch()} />
                ) : (
                  <Textarea value={prettyJson(accuracyQuery.data?.dashboard ?? {})} readOnly className="min-h-[260px] font-mono text-xs" />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t.retrainTitle}</CardTitle>
                <CardDescription>{t.retrainDesc}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {MODEL_TYPES.map((modelType) => (
                  <div key={modelType} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <span className="text-sm font-medium capitalize">{modelType.replace(/_/g, ' ')}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => retrainMutation.mutate(modelType)}
                      disabled={retrainMutation.isPending}
                    >
                      {retrainMutation.isPending ? <Loader2 className="me-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="me-1.5 h-3.5 w-3.5" />}
                      {t.retrain}
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </PermissionRedirect>
  );
}

function PredictionPanel({
  title,
  description,
  data,
  error,
  isLoading,
  onRetry,
}: {
  title: string;
  description: string;
  data?: PredictionResponse;
  error: unknown;
  isLoading: boolean;
  onRetry: () => void;
}) {
  const t = useVcisoChatLabels().predict;
  const items = Array.isArray(data?.items) ? data.items : [];
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <TrendingUp className="h-5 w-5 text-primary" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <ErrorState error={error} onRetry={onRetry} />
        ) : isLoading ? (
          <p className="text-sm text-muted-foreground">{t.loadingPrediction}</p>
        ) : data ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{readString(data.prediction_type, title)}</Badge>
              <Badge variant="secondary">{t.confidenceBadge(Math.round(readNumber(data.confidence_score, 0) * 100))}</Badge>
              {data.model_version && <Badge variant="outline">{t.modelPrefix(data.model_version)}</Badge>}
            </div>
            {data.explanation_text && <p className="text-sm text-muted-foreground">{data.explanation_text}</p>}
            <div className="rounded-lg border bg-secondary/40 p-3">
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <ShieldAlert className="h-3.5 w-3.5" />
                {items.length > 0 ? t.rankedItems(items.length) : t.predictionPayload}
              </p>
              <Textarea value={prettyJson(items.length > 0 ? items.slice(0, 6) : data)} readOnly className="min-h-[160px] font-mono text-xs" />
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t.noPrediction}</p>
        )}
      </CardContent>
    </Card>
  );
}

function MetricCard({ title, value, detail }: { title: string; value: string; detail: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tracking-tight">{value}</p>
        <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}
