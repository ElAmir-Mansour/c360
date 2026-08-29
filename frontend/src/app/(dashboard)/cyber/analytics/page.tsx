'use client';

import { LineChart, Radar, Sparkles } from 'lucide-react';

import { PageHeader } from '@/components/common/page-header';
import { PermissionRedirect } from '@/components/common/permission-redirect';

import { useCyberCommonLabels } from '../_lib/cyber-i18n';
import { useCyberAnalyticsLabels } from './_lib/analytics-i18n';
import { ThreatLandscape } from './_components/threat-landscape';
import { ThreatForecast } from './_components/threat-forecast';
import { AlertVolumeForecast } from './_components/alert-volume-forecast';
import { TechniqueTrends } from './_components/technique-trends';
import { CampaignDetection } from './_components/campaign-detection';

export default function CyberAnalyticsPage() {
  const common = useCyberCommonLabels();
  const t = useCyberAnalyticsLabels();
  return (
    <PermissionRedirect permission="cyber:read">
      <div className="space-y-8">
        <PageHeader
          eyebrow={common.eyebrow}
          title={t.pageTitle}
          description={t.pageDescription}
          tags={[
            { label: t.tagPredictive, tone: 'info', icon: <Sparkles className="h-3.5 w-3.5" aria-hidden /> },
            { label: t.tagCampaign, tone: 'primary', icon: <Radar className="h-3.5 w-3.5" aria-hidden /> },
            { label: t.tagTechniqueTrends, tone: 'neutral', icon: <LineChart className="h-3.5 w-3.5" aria-hidden /> },
          ]}
        />

        {/* Section 1: Threat Landscape Overview */}
        <ThreatLandscape />

        {/* Section 2: Threat Forecast */}
        <ThreatForecast />

        {/* Section 3: Alert Volume Forecast */}
        <AlertVolumeForecast />

        {/* Section 4: Technique Trends */}
        <TechniqueTrends />

        {/* Section 5: Campaign Detection */}
        <CampaignDetection />
      </div>
    </PermissionRedirect>
  );
}
